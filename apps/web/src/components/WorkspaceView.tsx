import { useEffect, useState } from "react";
import type { WorkspaceDto } from "@plane-and-curves/shared";
import { WhiteboardTab } from "./WhiteboardTab.js";
import { TasksTab } from "./TasksTab.js";

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

  // "View on board" from a task: remember the target board, then switch tabs.
  // Tasks stay decoupled from Excalidraw — this only passes IDs and changes tab.
  const viewOnBoard = (boardId: string) => {
    localStorage.setItem(`pac.board.${workspace.id}`, boardId);
    choose("whiteboard");
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

      <div className="mt-4 min-h-0 flex-1">
        {tab === "whiteboard" && <WhiteboardTab workspace={workspace} />}
        {tab === "tasks" && <TasksTab workspace={workspace} onViewOnBoard={viewOnBoard} />}
        {tab === "documents" && (
          <div className="h-full overflow-auto p-8">
            <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/50">
              <p className="text-sm text-slate-400">Documents (Google Drive) arrive in Step 6.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
