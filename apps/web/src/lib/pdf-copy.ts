/**
 * Shared copy strings for the PDF upload flow.
 *
 * Single source of truth so web + mobile stay aligned. Mobile mirrors this
 * file at apps/mobile/lib/pdf-copy.ts (see PR-C feedback W3). When you change
 * a string here, change it there too.
 */

export const PDF_TOO_LARGE_MSG = (sizeBytes: number) =>
  `That PDF is ${(sizeBytes / 1024 / 1024).toFixed(1)} MB — the cap is 25 MB. Try compressing it (Preview / Acrobat → Reduce File Size).`;

export const PDF_NOT_VALID_MSG = "That doesn't look like a PDF. Pick a `.pdf` file.";
export const PDF_NETWORK_ERR = 'Network error during upload. Try again.';
export const PDF_GENERIC_ERR = 'Could not save the PDF. Try again.';

export const PDF_COPYRIGHT_LABEL =
  "I'm allowed to share this — I hold the copyright, or it's a preprint / open-access version my publisher permits.";

export const PDF_TRUST_NOTE =
  'Stored on Cloudflare R2. Public via your QR. Delete anytime from the share editor.';
