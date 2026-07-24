import { useEffect, useState } from "react";
import type { WorkspaceDto } from "@plane-and-curves/shared";

const TABS = [
  { id: "whiteboard", label: "Whiteboard" },
  { id: "tasks", label: "To do tasks" },
  { id: "documents", label: "Documents" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** Workspace header + three tabs. Tab selection is remembered per workspace. */
export function WorkspaceView({ workspace }: { workspace: WorkspaceDto }) {
  const storageKey = `pac.tab.${workspace.id}`;
  const [tab, setTab] = useState<TabId>(
    () => (localStorage.getItem(storageKey) as TabId) ?? "whiteboard",
  );

  // Restore the remembered tab whenever the workspace changes.
  useEffect(() => {
    setTab((localStorage.getItem(storageKey) as TabId) ?? "whiteboard");
  }, [storageKey]);

  const choose = (id: TabId) => {
    setTab(id);
    localStorage.setItem(storageKey, id);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="px-8 pt-6">
        <h1 className="text-lg font-semibold text-slate-800">{workspace.name}</h1>
        <div className="mt-4 flex gap-6 border-b border-slate-200">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => choose(t.id)}
              className={`-mb-px border-b-2 pb-2 text-sm font-medium transition ${
                tab === t.id
                  ? "border-accent text-accent"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8">
        <Placeholder tab={tab} />
      </div>
    </div>
  );
}

function Placeholder({ tab }: { tab: TabId }) {
  const copy: Record<TabId, string> = {
    whiteboard: "The Excalidraw whiteboard arrives in Step 4.",
    tasks: "The tasks list arrives in Step 5.",
    documents: "Documents (Google Drive) arrive in Step 6.",
  };
  return (
    <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/50">
      <p className="text-sm text-slate-400">{copy[tab]}</p>
    </div>
  );
}
