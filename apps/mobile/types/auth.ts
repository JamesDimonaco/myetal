/**
 * Mirrors backend Pydantic shapes (apps/api/src/myetal_api/schemas/user.py).
 * Hand-written until the OpenAPI codegen pipeline lands.
 *
 * Phase 4 (Better Auth cutover): TokenPair is gone — Better Auth's JWT
 * plugin replaces our hand-rolled access/refresh pair. The mobile client
 * fetches the JWT from `GET /api/auth/token` after sign-in/sign-up.
 */

export interface AuthUser {
  id: string;
  name: string | null;
  email: string | null;
  email_verified: boolean;
  is_admin: boolean;
  avatar_url: string | null;
  orcid_id: string | null;
  last_orcid_sync_at: string | null;
  created_at: string;
}
