import type { UserDto } from "@plane-and-curves/shared";
import { CheckCircle2, Loader2, Users } from "lucide-react";
import { ApiClientError } from "../lib/api.js";
import { googleLink, googleSignIn } from "../lib/auth.js";
import { useAcceptInvitation, useInvitationPreview } from "../lib/sharing.js";
import { RoleBadge } from "../components/sharing/RoleBadge.js";

export function InviteLandingPage({ token, user }: { token: string; user: UserDto | null }) {
  const preview = useInvitationPreview(token);
  const accept = useAcceptInvitation(token);

  const continueWithGoogle = () => {
    sessionStorage.setItem("pac.inviteReturn", window.location.pathname);
    if (user?.isGuest) googleLink();
    else googleSignIn();
  };

  const acceptInvite = () => {
    accept.mutate(undefined, {
      onSuccess: ({ workspaceId }) => {
        localStorage.setItem("pac.currentWorkspaceId", workspaceId);
        window.history.replaceState({}, "", "/");
        window.location.replace("/");
      },
    });
  };

  return (
    <main className="flex min-h-full items-center justify-center bg-slate-50 p-4">
      <section className="w-full max-w-lg rounded-2xl bg-white p-7 shadow-sm">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10"><Users className="h-6 w-6 text-accent" /></span>
        {preview.isLoading ? <p className="mt-5 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Checking invitation…</p> : preview.isError || !preview.data ? (
          <div className="mt-5"><h1 className="text-lg font-semibold text-slate-800">This invitation is unavailable</h1><p className="mt-2 text-sm text-slate-500">It may have expired, been revoked, or already been accepted.</p></div>
        ) : (
          <>
            <h1 className="mt-5 text-xl font-semibold text-slate-800">Join {preview.data.workspaceName}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">{preview.data.inviterName} invited <strong>{preview.data.emailMasked}</strong> as <RoleBadge role={preview.data.role} />.</p>
            {preview.data.expired ? <p className="mt-5 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">This invitation has expired. Ask the workspace owner to resend it.</p> : !user || user.isGuest ? (
              <button type="button" onClick={continueWithGoogle} className="mt-6 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover">{user?.isGuest ? "Convert guest account with Google" : "Continue with Google"}</button>
            ) : (
              <>
                <p className="mt-5 text-xs text-slate-400">Signed in as {user.email}</p>
                <button type="button" onClick={acceptInvite} disabled={accept.isPending} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60">{accept.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Accept invitation</button>
              </>
            )}
            {accept.isError && <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{accept.error instanceof ApiClientError && accept.error.code === "INVITATION_EMAIL_MISMATCH" ? "This invitation was sent to a different Google account." : accept.error.message}</p>}
          </>
        )}
      </section>
    </main>
  );
}
