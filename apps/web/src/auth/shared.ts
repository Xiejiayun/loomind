export const LOGIN_ACTION = "google_login";

export interface AuthUser {
  id: string;
  email: string;
}

export interface Session {
  user: AuthUser | null;
  expiresAt: number | null;
}

export interface LoginChallenge {
  googleClientId: string;
  turnstileSiteKey: string;
  nonce: string;
}
