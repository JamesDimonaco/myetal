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
  avatar_url: string | null;
  is_admin: boolean;
  orcid_id: string | null;
  last_orcid_sync_at: string | null;
  created_at: string;
}
