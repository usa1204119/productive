import { OAuth2Client } from "google-auth-library";
import { AppError } from "../errors.js";
import { env } from "../env.js";

/**
 * Sign-in requests ONLY these scopes. Drive access is requested later,
 * incrementally, when the user first opens Documents — never here.
 */
export const SIGN_IN_SCOPES = ["openid", "email", "profile"] as const;

/**
 * The ONLY Drive scope this app ever requests. `drive.file` grants access to
 * just the files the app creates (plus files the user explicitly picks). Any
 * broader scope (`drive`, `drive.readonly`, `drive.metadata`, …) is restricted
 * and would force a paid annual security assessment — NEVER widen this.
 * A test asserts this value literally.
 */
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

function client(redirectUri: string): OAuth2Client {
  return new OAuth2Client({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri,
  });
}

/** OAuth client for the sign-in flow (identity only). */
export const signInClient = () => client(env.GOOGLE_OAUTH_REDIRECT_URI);

/** OAuth client for the incremental Drive-consent flow. */
export const driveClient = () => client(env.GOOGLE_DRIVE_REDIRECT_URI);

/**
 * Consent URL for incremental Drive authorization. offline + prompt=consent so
 * Google returns a refresh token we can store (encrypted) for transparent
 * access-token refresh later.
 */
export function buildDriveConsentUrl(state: string): string {
  return driveClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [DRIVE_FILE_SCOPE],
    include_granted_scopes: true,
    state,
  });
}

export interface DriveTokens {
  refreshToken: string;
  scope: string;
}

/** Exchange the Drive consent code; returns the refresh token + granted scope. */
export async function exchangeDriveCode(code: string): Promise<DriveTokens> {
  const { tokens } = await driveClient().getToken(code);
  if (!tokens.refresh_token) {
    // Without a refresh token we cannot maintain access — force re-consent.
    throw new AppError(400, "DRIVE_ERROR", "Google did not return a refresh token");
  }
  const grantedScopes = new Set((tokens.scope ?? "").split(/\s+/).filter(Boolean));
  if (!grantedScopes.has(DRIVE_FILE_SCOPE)) {
    throw new AppError(
      400,
      "DRIVE_ERROR",
      "Google Drive permission was not granted. Please try connecting again.",
    );
  }

  // Persist only the capability this connection is allowed to use. Google can
  // return identity scopes already granted to the OAuth client when incremental
  // consent is enabled; those are intentionally not part of this credential.
  return { refreshToken: tokens.refresh_token, scope: DRIVE_FILE_SCOPE };
}

/** A per-user OAuth client seeded with their refresh token (auto-refreshes access). */
export function createDriveAuthClient(refreshToken: string): OAuth2Client {
  const c = driveClient();
  c.setCredentials({ refresh_token: refreshToken });
  return c;
}

export interface GoogleIdentity {
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

/** Build the Google consent URL for sign-in. `state` guards against CSRF. */
export function buildSignInUrl(state: string): string {
  return signInClient().generateAuthUrl({
    access_type: "online",
    scope: [...SIGN_IN_SCOPES],
    include_granted_scopes: true,
    state,
    prompt: "select_account",
  });
}

/** Exchange the auth code and verify the ID token into a trusted identity. */
export async function exchangeSignInCode(code: string): Promise<GoogleIdentity> {
  const oauth = signInClient();
  const { tokens } = await oauth.getToken(code);
  if (!tokens.id_token) throw new AppError(400, "OAUTH_ERROR", "No ID token returned by Google");

  const ticket = await oauth.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new AppError(400, "OAUTH_ERROR", "Incomplete profile from Google");
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email,
    avatarUrl: payload.picture ?? null,
  };
}
