import { useState } from "react";
import type { AssignableWorkspaceRole } from "@plane-and-curves/shared";

export function InviteMemberForm({
  busy,
  onInvite,
}: {
  busy: boolean;
  onInvite: (email: string, role: AssignableWorkspaceRole) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableWorkspaceRole>("EDITOR");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;
    await onInvite(email.trim(), role);
    setEmail("");
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="rounded-xl bg-slate-50 p-3">
      <label htmlFor="invite-email" className="text-xs font-medium text-slate-600">Invite by email</label>
      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
        <input id="invite-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teammate@example.com" className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-accent" />
        <select aria-label="Invitation role" value={role} onChange={(event) => setRole(event.target.value as AssignableWorkspaceRole)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-accent">
          <option value="EDITOR">Editor</option>
          <option value="VIEWER">Viewer</option>
        </select>
        <button type="submit" disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60">{busy ? "Sending…" : "Send invite"}</button>
      </div>
    </form>
  );
}
