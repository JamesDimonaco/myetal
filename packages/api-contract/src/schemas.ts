/**
 * Curated, human-friendly aliases over the generated component schemas.
 *
 * The generated file (`./generated/schema`) is the machine truth; this module
 * is the ergonomic front door. Import domain types from here (or from the
 * package root) rather than reaching into `components['schemas'][...]` at every
 * call site.
 *
 * Names here are the *canonical Pydantic names* (e.g. `TagOut`, `ShareItemCreate`)
 * — the same names the backend uses. The per-app `types/*` shims map any legacy
 * local aliases (`Tag`, `ShareItemInput`, …) onto these during migration.
 */
import type { components, paths } from './generated/schema';

export type { paths, components };

/** All generated response/request object schemas, keyed by Pydantic class name. */
export type Schemas = components['schemas'];

// --- Shares domain -------------------------------------------------------
export type ShareType = Schemas['ShareType'];
export type ItemKind = Schemas['ItemKind'];
export type TagOut = Schemas['TagOut'];
export type ShareItemResponse = Schemas['ShareItemResponse'];
export type ShareItemCreate = Schemas['ShareItemCreate'];
export type ShareCreate = Schemas['ShareCreate'];
export type ShareUpdate = Schemas['ShareUpdate'];
export type ShareResponse = Schemas['ShareResponse'];
export type PublicShareResponse = Schemas['PublicShareResponse'];
export type RelatedShareOut = Schemas['RelatedShareOut'];
export type SimilarShareOut = Schemas['SimilarShareOut'];
export type PdfUploadUrlResponse = Schemas['PdfUploadUrlResponse'];
export type ShareSearchResult = Schemas['ShareSearchResult'];
export type ShareSearchResponse = Schemas['ShareSearchResponse'];
export type BrowseShareResult = Schemas['BrowseShareResult'];
export type BrowseResponse = Schemas['BrowseResponse'];
export type UserPublicOut = Schemas['UserPublicOut'];

// --- Paper search (Crossref / OpenAlex lookup) ------------------------------
export type PaperMetadata = Schemas['PaperMetadata'];
export type OpenAccessInfo = Schemas['OpenAccessInfo'];
export type TopicInfo = Schemas['TopicInfo'];
export type PaperSearchResult = Schemas['PaperSearchResult'];
export type PaperSearchResponse = Schemas['PaperSearchResponse'];

// --- Works library (/me/works) ----------------------------------------------
export type PaperOut = Schemas['PaperOut'];
export type PaperSource = Schemas['PaperSource'];
export type UserPaperAddedVia = Schemas['UserPaperAddedVia'];
export type WorkResponse = Schemas['WorkResponse'];
export type AddWorkRequest = Schemas['AddWorkRequest'];
export type OrcidSyncResponse = Schemas['OrcidSyncResponse'];

// --- Reports (user-submitted + admin queue) ---------------------------------
export type ShareReportReason = Schemas['ShareReportReason'];
export type ShareReportStatus = Schemas['ShareReportStatus'];
export type ReportSubmit = Schemas['ReportSubmit'];
export type ReportSubmitResponse = Schemas['ReportSubmitResponse'];
export type ReportOut = Schemas['ReportOut'];
export type ReportAction = Schemas['ReportAction'];

// --- Calling user (/me) -----------------------------------------------------
export type UserResponse = Schemas['UserResponse'];
