import type { WorkspaceInvitationDto } from "@plane-and-curves/shared";
import { RoleBadge } from "./RoleBadge.js";

export function PendingInvitationList({ invitations, busy, onResend, onRevoke }: {
  invitations: WorkspaceInvitationDto[];
  busy: boolean;
  onResend: (id: string) => void;
  onRevoke: (id: string) => void;
}) {
  if (!invitations.length) return null;
  return (
    <section aria-labelledby="pending-heading">
      <h3 id="pending-heading" className="text-xs font-semibold uppercase tracking-wide text-slate-400">Pending invitations</h3>
      <ul className="mt-2 divide-y divide-slate-100">
        {invitations.map((invite) => (
          <li key={invite.id} className="flex flex-wrap items-center gap-2 py-3 text-sm">
            <span className="min-w-0 flex-1 truncate text-slate-600">{invite.emailMasked}</span>
            <RoleBadge role={invite.role} />
            {invite.expired && <span className="text-xs text-amber-700">Expired</span>}
            <button type="button" disabled={busy} onClick={() => onResend(invite.id)} className="text-xs font-medium text-accent hover:text-accent-hover disabled:opacity-50">Resend</button>
            <button type="button" disabled={busy} onClick={() => onRevoke(invite.id)} className="text-xs font-medium text-rose-600 hover:text-rose-700 disabled:opacity-50">Revoke</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
