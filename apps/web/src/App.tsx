import { useEffect, useState } from "react";
import { LogOut, ShieldCheck, UserRound } from "lucide-react";
import {
  googleLink,
  googleSignIn,
  useCurrentUser,
  useGuestLogin,
  useLogout,
} from "./lib/auth.js";

/**
 * Minimal shell for Step 2 — it exists only to exercise the auth flow end to
 * end (guest login, Google sign-in, guest -> Google conversion, logout).
 * The real three-tab workspace UI comes in later steps.
 */
export function App() {
  const { data: user, isLoading } = useCurrentUser();
  const guestLogin = useGuestLogin();
  const logout = useLogout();
  const banner = useAuthRedirectBanner();

  if (isLoading) {
    return <Centered>Loading…</Centered>;
  }

  return (
    <Centered>
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">Plane and Curves</h1>
        <p className="mt-1 text-sm text-slate-500">Plan it. Do it. Keep it together.</p>

        {banner && (
          <p
            className={`mt-4 rounded-lg px-3 py-2 text-sm ${
              banner.kind === "error"
                ? "bg-rose-50 text-rose-700"
                : "bg-emerald-50 text-emerald-700"
            }`}
          >
            {banner.message}
          </p>
        )}

        {!user ? (
          <div className="mt-6 space-y-3">
            <button
              onClick={googleSignIn}
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-hover"
            >
              Sign in with Google
            </button>
            <button
              onClick={() => guestLogin.mutate()}
              disabled={guestLogin.isPending}
              className="w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            >
              {guestLogin.isPending ? "Setting up…" : "Continue as guest"}
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-3">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="h-10 w-10 rounded-full" />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
                  <UserRound className="h-5 w-5 text-slate-500" />
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate text-xs text-slate-500">
                  {user.isGuest ? "Guest account" : user.email}
                </p>
              </div>
            </div>

            {user.isGuest && (
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-600">
                  You&apos;re a guest. Sign in with Google to save your work — your
                  workspaces and tasks carry over.
                </p>
                <button
                  onClick={googleLink}
                  className="mt-2 w-full rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white transition hover:bg-accent-hover"
                >
                  Sign in with Google to save your work
                </button>
              </div>
            )}

            <div className="flex items-center gap-2 text-xs text-slate-400">
              <ShieldCheck className="h-4 w-4" />
              Session active
            </div>

            <button
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        )}
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-full items-center justify-center p-6">{children}</div>;
}

/** Read the ?auth=… params the OAuth callback redirects back with, then clean the URL. */
function useAuthRedirectBanner() {
  const [banner, setBanner] = useState<{ kind: "ok" | "error"; message: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const auth = params.get("auth");
    if (!auth) return;

    if (auth === "success") {
      setBanner({ kind: "ok", message: "Signed in successfully." });
    } else if (auth === "error") {
      const code = params.get("code");
      setBanner({
        kind: "error",
        message:
          code === "GOOGLE_ACCOUNT_ALREADY_LINKED"
            ? "That Google account is already connected to another user."
            : "Sign-in was cancelled or failed. Please try again.",
      });
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  return banner;
}
