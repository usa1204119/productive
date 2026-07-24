import { useEffect, useState } from "react";
import { googleSignIn, useGuestLogin } from "../lib/auth.js";

/** Signed-out screen: Google Sign-In or one-click guest. */
export function LoginCard() {
  const guestLogin = useGuestLogin();
  const banner = useAuthRedirectBanner();

  return (
    <div className="flex min-h-full items-center justify-center p-6">
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
      </div>
    </div>
  );
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
