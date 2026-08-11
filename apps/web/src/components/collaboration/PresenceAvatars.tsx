import type { PresenceEntry } from "@plane-and-curves/shared";

export function PresenceAvatars({ entries }: { entries: PresenceEntry[] }) {
  if (!entries.length) return null;
  return (
    <div className="hidden items-center -space-x-2 sm:flex" aria-label={`${entries.length} active collaborator${entries.length === 1 ? "" : "s"}`}>
      {entries.slice(0, 4).map((entry) =>
        entry.avatarUrl ? (
          <img key={entry.userId} src={entry.avatarUrl} alt={entry.displayName} title={`${entry.displayName} · ${entry.activeSection}`} className="h-7 w-7 rounded-full border-2 border-white" />
        ) : (
          <span key={entry.userId} title={`${entry.displayName} · ${entry.activeSection}`} className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-accent text-[10px] font-semibold text-white">
            {entry.displayName.slice(0, 1).toUpperCase()}
          </span>
        ),
      )}
      {entries.length > 4 && <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-[10px] text-slate-500">+{entries.length - 4}</span>}
    </div>
  );
}
