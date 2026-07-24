import { OAuth2Client } from "google-auth-library";
import { AppError } from "../errors.js";
import { env } from "../env.js";

/**
 * Sign-in requests ONLY these scopes. Drive access is requested later,
 * incrementally, when the user first opens Documents — never here.
 */
export const SIGN_IN_SCOPES = ["openid", "email", "profile"] as const;

function client(redirectUri: string): OAuth2Client {
  return new OAuth2Client({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri,
  });
}

/** OAuth client for the sign-in flow (identity only). */
export const signInClient = () => client(env.GOOGLE_OAUTH_REDIRECT_URI);

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
