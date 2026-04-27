export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type?: string;
}

export interface UserResponse {
  id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
}

/** GET /auth/me/sessions — list of refresh-token rows (= signed-in devices). */
export interface SessionResponse {
  id: string;
  issued_at: string;
  expires_at: string;
  revoked: boolean;
}
