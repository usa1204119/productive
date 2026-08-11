import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { AssignableWorkspaceRole, WorkspaceMemberDto } from "@plane-and-curves/shared";
import { ConfirmDialog } from "../ConfirmDialog.js";
import { RoleBadge } from "./RoleBadge.js";

export function MemberList({ members, busy, onRoleChange, onRemove }: {
  members: WorkspaceMemberDto[];
  busy: boolean;
  onRoleChange: (memberId: string, role: AssignableWorkspaceRole) => void;
  onRemove: (memberId: string) => void;
}) {
  const [removeTarget, setRemoveTarget] = useState<WorkspaceMemberDto | null>(null);
  return (
    <section aria-labelledby="members-heading">
      <h3 id="members-heading" className="text-xs font-semibold uppercase tracking-wide text-slate-400">Members</h3>
      <ul className="mt-2 divide-y divide-slate-100">
        {members.map((member) => (
          <li key={member.id} className="flex items-center gap-3 py-3">
            {member.avatarUrl ? <img src={member.avatarUrl} alt="" className="h-8 w-8 rounded-full" /> : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">{member.displayName[0]?.toUpperCase()}</span>}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-700">{member.displayName}</p>
              <p className="truncate text-xs text-slate-400">{member.email ?? "No email"}</p>
              {member.aclSyncStatus === "FAILED" && <p className="text-[11px] text-amber-700">Drive access sync will retry</p>}
            </div>
            {member.isOwner ? <RoleBadge role="OWNER" /> : (
              <>
                <select aria-label={`Role for ${member.displayName}`} disabled={busy} value={member.role} onChange={(event) => onRoleChange(member.id, event.target.value as AssignableWorkspaceRole)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-accent">
                  <option value="EDITOR">Editor</option>
                  <option value="VIEWER">Viewer</option>
                </select>
                <button type="button" onClick={() => setRemoveTarget(member)} aria-label={`Remove ${member.displayName}`} className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
              </>
            )}
          </li>
        ))}
      </ul>
      {removeTarget && <ConfirmDialog title={`Remove ${removeTarget.displayName}?`} body="They will immediately lose access to this workspace. Drive permission cleanup continues safely in the background." confirmLabel="Remove member" destructive busy={busy} onCancel={() => setRemoveTarget(null)} onConfirm={() => { onRemove(removeTarget.id); setRemoveTarget(null); }} />}
    </section>
  );
}
