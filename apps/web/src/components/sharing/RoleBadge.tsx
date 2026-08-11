import type { WorkspaceRoleDto } from "@plane-and-curves/shared";

export function RoleBadge({ role }: { role: WorkspaceRoleDto }) {
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
      {role[0]}{role.slice(1).toLowerCase()}
    </span>
  );
}
