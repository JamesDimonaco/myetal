/**
 * Calling-user shape — JSON body of GET /me on the API side.
 *
 * Mirrors ``apps/api/src/myetal_api/schemas/user.py::UserResponse``.
 * Phase 3 dropped the legacy ``TokenPair`` / ``LoginInput`` /
 * ``RegisterInput`` / ``SessionResponse`` shapes — Better Auth's
 * client owns those concerns now.
 */
export interface UserResponse {
  id: string;
  email: string | null;
  name: string | null;
  /**
   * Soft email-verification flag (mirrors Better Auth's `emailVerified`
   * core column, exposed by `schemas/user.py::UserResponse`). Mobile uses
   * it to render an "unverified email" banner; web doesn't surface it
   * today but it's present in the wire shape, so the type must include
   * it to keep this interface honest. Removing it from the type would
   * make the field silently `undefined` for any future web consumer.
   */
  email_verified: boolean;
  avatar_url: string | null;
  is_admin: boolean;
  orcid_id: string | null;
  last_orcid_sync_at: string | null;
  created_at: string;
}
