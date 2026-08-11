import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import type { AssignableWorkspaceRole, WorkspaceDto } from "@plane-and-curves/shared";
import {
  useInvitations,
  useInviteMember,
  useMembers,
  useRemoveMember,
  useResendInvitation,
  useRevokeInvitation,
  useUpdateMemberRole,
} from "../../lib/sharing.js";
import { InviteMemberForm } from "./InviteMemberForm.js";
import { MemberList } from "./MemberList.js";
import { PendingInvitationList } from "./PendingInvitationList.js";

export function ShareWorkspaceDialog({ workspace, onClose }: { workspace: WorkspaceDto; onClose: () => void }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const members = useMembers(workspace.id);
  const invitations = useInvitations(workspace.id);
  const invite = useInviteMember(workspace.id);
  const resend = useResendInvitation(workspace.id);
  const revoke = useRevokeInvitation(workspace.id);
  const updateRole = useUpdateMemberRole(workspace.id);
  const remove = useRemoveMember(workspace.id);
  const busy = invite.isPending || resend.isPending || revoke.isPending || updateRole.isPending || remove.isPending;

  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
      if (event.key !== "Tab") return;
      const elements = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href]') ?? [])];
      const first = elements[0];
      const last = elements.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); prior?.focus(); };
  }, [busy, onClose]);

  const reportError = (error: unknown) => setMessage({ kind: "error", text: error instanceof Error ? error.message : "The sharing action failed" });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div><h2 id={titleId} className="font-semibold text-slate-800">Share {workspace.name}</h2><p className="text-xs text-slate-400">You are the owner</p></div>
          <button ref={closeRef} type="button" onClick={onClose} disabled={busy} aria-label="Close sharing dialog" className="rounded p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </header>
        <div className="space-y-5 overflow-y-auto p-6">
          <InviteMemberForm busy={busy} onInvite={async (email, role) => { setMessage(null); try { await invite.mutateAsync({ email, role }); setMessage({ kind: "ok", text: "Invitation sent" }); } catch (error) { reportError(error); throw error; } }} />
          {message && <p role="status" className={`rounded-lg px-3 py-2 text-sm ${message.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{message.text}</p>}
          {members.isLoading ? <p className="text-sm text-slate-400">Loading members…</p> : members.isError ? <p className="text-sm text-rose-600">Could not load members.</p> : <MemberList members={members.data ?? []} busy={busy} onRoleChange={(memberId, role: AssignableWorkspaceRole) => updateRole.mutate({ memberId, role }, { onError: reportError })} onRemove={(id) => remove.mutate(id, { onError: reportError })} />}
          <PendingInvitationList invitations={invitations.data ?? []} busy={busy} onResend={(id) => resend.mutate(id, { onSuccess: () => setMessage({ kind: "ok", text: "Invitation resent" }), onError: reportError })} onRevoke={(id) => revoke.mutate(id, { onError: reportError })} />
        </div>
      </div>
    </div>
  );
}
