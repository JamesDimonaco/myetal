/**
 * PDF upload pipeline (PR-C). Three-step dance against R2:
 *   1. Presign — `POST /shares/{id}/items/upload-url` returns a multipart POST
 *      policy + a `file_key` we round-trip back on step 3.
 *   2. Upload — multipart POST directly to R2 via `expo-file-system`'s
 *      legacy `createUploadTask` so we can stream progress and cancel.
 *   3. Record — `POST /shares/{id}/items/record-pdf-upload` validates the
 *      PDF server-side (first 8 bytes, size, copyright_ack), generates the
 *      first-page thumbnail, and returns the new `ShareItem`.
 *
 * Why `legacy/createUploadTask`? expo-file-system v19 split into a new
 * file-handle API (no built-in HTTP) and a legacy module that retains
 * `uploadAsync` + `createUploadTask`. Only the legacy `createUploadTask`
 * supports an upload-progress callback and a `cancelAsync()` handle —
 * `uploadAsync` is fire-and-forget. We pick the legacy path for both, with
 * the new-style namespace re-exported as `LegacyFileSystem` so we don't shadow
 * any future migration to the v2 net API.
 */

import {
  createUploadTask,
  FileSystemUploadType,
  type FileSystemUploadResult,
  type UploadProgressData,
  type UploadTask,
} from 'expo-file-system/legacy';

import { api, ApiError } from './api';
import {
  PDF_GENERIC_ERR,
  PDF_NETWORK_ERR,
  PDF_TOO_LARGE_MSG,
} from './pdf-copy';
import type { ShareItem } from '@/types/share';

// ---------------------------------------------------------------------------
// API contract — backend agent ships these in parallel.
// ---------------------------------------------------------------------------

export interface PresignResponse {
  upload_url: string;
  fields: Record<string, string>;
  file_key: string;
  expires_at: string;
}

interface PresignRequest {
  filename: string;
  mime_type: string;
  size_bytes: number;
}

interface RecordPdfRequest {
  file_key: string;
  copyright_ack: true;
  title: string;
}

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

/** 25 MB hard cap (Q2). Mirrors the server-side `content-length-range`. */
export const PDF_MAX_BYTES = 25 * 1024 * 1024;
export const PDF_MIME = 'application/pdf';

/**
 * The state machine the UI subscribes to. `idle → requesting-presign →
 * uploading → recording → done | error`. Errors are recoverable — the picker
 * UI keeps the chosen file in state so the user can hit Retry without
 * re-picking.
 */
export type UploadStatus =
  | 'idle'
  | 'requesting-presign'
  | 'uploading'
  | 'recording'
  | 'done'
  | 'error';

export interface UploadProgress {
  status: UploadStatus;
  /** 0..1 during `uploading`; undefined otherwise. */
  uploadFraction?: number;
  bytesSent?: number;
  bytesTotal?: number;
  error?: string;
  /** Populated once the record call succeeds. */
  item?: ShareItem;
}

export interface UploadHandle {
  /** Best-effort cancel. iOS BACKGROUND sessions may continue; we still flip
   * local state to `idle` so the UI stops blocking. */
  cancel: () => Promise<void>;
}

export interface RunUploadParams {
  shareId: string;
  /** Local file URI from `DocumentPicker.getDocumentAsync` (`file://...`). */
  fileUri: string;
  filename: string;
  sizeBytes: number;
  title: string;
  /** Caller has already enforced `copyright_ack`; we pass `true` literally
   * to match the backend's discriminated input. */
  onProgress: (p: UploadProgress) => void;
}

// ---------------------------------------------------------------------------
// Implementation.
// ---------------------------------------------------------------------------

/**
 * Run one full upload cycle. Returns a handle exposing a best-effort cancel.
 * Resolves with the final `UploadProgress` (status `done` or `error`).
 *
 * Caller is responsible for retry — `runPdfUpload` does NOT retry internally
 * because the right retry strategy depends on which step failed (presign
 * 5-min expiry, R2 timeout, record-step thumbnail failure are all distinct
 * and the UI surfaces a manual "Try again" button rather than auto-bursting
 * the network). See M6 in the PR brief.
 */
export function runPdfUpload(params: RunUploadParams): {
  promise: Promise<UploadProgress>;
  handle: UploadHandle;
} {
  let task: UploadTask | null = null;
  let cancelled = false;

  const handle: UploadHandle = {
    async cancel() {
      cancelled = true;
      try {
        await task?.cancelAsync();
      } catch {
        // Cancel-during-flight may throw if the task already settled —
        // swallow; the caller has already moved on visually.
      }
    },
  };

  const promise = (async (): Promise<UploadProgress> => {
    const { shareId, fileUri, filename, sizeBytes, title, onProgress } = params;

    // ---- guard: 25 MB cap ----
    if (sizeBytes > PDF_MAX_BYTES) {
      const err: UploadProgress = {
        status: 'error',
        error: PDF_TOO_LARGE_MSG(sizeBytes),
      };
      onProgress(err);
      return err;
    }

    // ---- step 1: presign ----
    onProgress({ status: 'requesting-presign' });
    let presign: PresignResponse;
    try {
      presign = await api<PresignResponse>(
        `/shares/${shareId}/items/upload-url`,
        {
          method: 'POST',
          json: {
            filename,
            mime_type: PDF_MIME,
            size_bytes: sizeBytes,
          } satisfies PresignRequest,
        },
      );
    } catch (e) {
      if (cancelled) return { status: 'idle' };
      const msg = e instanceof ApiError ? e.detail : PDF_GENERIC_ERR;
      const err: UploadProgress = { status: 'error', error: msg };
      onProgress(err);
      return err;
    }

    if (cancelled) return { status: 'idle' };

    // ---- step 2: upload to R2 with progress ----
    onProgress({
      status: 'uploading',
      uploadFraction: 0,
      bytesSent: 0,
      bytesTotal: sizeBytes,
    });

    let uploadResult: FileSystemUploadResult | undefined | null;
    try {
      task = createUploadTask(
        presign.upload_url,
        fileUri,
        {
          httpMethod: 'POST',
          uploadType: FileSystemUploadType.MULTIPART,
          fieldName: 'file',
          mimeType: PDF_MIME,
          parameters: presign.fields,
        },
        (data: UploadProgressData) => {
          if (cancelled) return;
          const total =
            data.totalBytesExpectedToSend > 0
              ? data.totalBytesExpectedToSend
              : sizeBytes;
          onProgress({
            status: 'uploading',
            uploadFraction: total > 0 ? data.totalBytesSent / total : 0,
            bytesSent: data.totalBytesSent,
            bytesTotal: total,
          });
        },
      );
      uploadResult = await task.uploadAsync();
    } catch (e) {
      if (cancelled) return { status: 'idle' };
      const msg = e instanceof Error ? e.message : PDF_NETWORK_ERR;
      const err: UploadProgress = { status: 'error', error: msg };
      onProgress(err);
      return err;
    }

    if (cancelled) return { status: 'idle' };

    if (!uploadResult || uploadResult.status < 200 || uploadResult.status >= 300) {
      const err: UploadProgress = {
        status: 'error',
        error: `Upload rejected (${uploadResult?.status ?? '?'}). Try again.`,
      };
      onProgress(err);
      return err;
    }

    // ---- step 3: record ----
    onProgress({ status: 'recording' });
    let item: ShareItem;
    try {
      item = await api<ShareItem>(
        `/shares/${shareId}/items/record-pdf-upload`,
        {
          method: 'POST',
          json: {
            file_key: presign.file_key,
            copyright_ack: true,
            title,
          } satisfies RecordPdfRequest,
        },
      );
    } catch (e) {
      if (cancelled) return { status: 'idle' };
      const msg = e instanceof ApiError ? e.detail : PDF_GENERIC_ERR;
      const err: UploadProgress = { status: 'error', error: msg };
      onProgress(err);
      return err;
    }

    const done: UploadProgress = { status: 'done', item };
    onProgress(done);
    return done;
  })();

  return { promise, handle };
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Strip `.pdf` (and any other extension) off a filename for the title default. */
export function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}

/** Format a byte count for display, e.g. 1572864 → "1.5 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : mb.toFixed(0)} MB`;
}
