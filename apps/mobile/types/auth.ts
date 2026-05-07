/**
 * Mirrors backend Pydantic shapes (apps/api/src/myetal_api/schemas/auth.py
 * and user.py). Hand-written until the OpenAPI codegen pipeline lands.
 */

export interface AuthUser {
  id: string;
  name: string | null;
  email: string | null;
  is_admin: boolean;
  avatar_url: string | null;
  orcid_id: string | null;
  created_at: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
}
