import { lazy, Suspense, useEffect, useState } from "react";
import type { UserDto, WorkspaceDto } from "@plane-and-curves/shared";

// Excalidraw is intentionally isolated in the Whiteboard chunk; users opening
// Tasks or Documents should not download the large canvas runtime up front.
const WhiteboardTab = lazy(() =>
  import("./WhiteboardTab.js").then((module) => ({
    default: module.WhiteboardTab,
  })),
);
const TasksTab = lazy(() =>
  import("./TasksTab.js").then((module) => ({ default: module.TasksTab })),
);
const DocumentsTab = lazy(() =>
  import("./DocumentsTab.js").then((module) => ({
    default: module.DocumentsTab,
  })),
);

const TABS = [
  { id: "whiteboard", label: "Whiteboard" },
  { id: "tasks", label: "To do tasks" },
  { id: "documents", label: "Documents" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** Workspace header + three tabs. Tab selection is remembered per workspace. */
export function WorkspaceView({
  workspace,
  user,
}: {
  workspace: WorkspaceDto;
  user: UserDto;
}) {
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
        <div
          className="mt-4 flex gap-6 border-b border-slate-200"
          role="tablist"
          aria-label="Workspace sections"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`workspace-tab-${t.id}`}
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`workspace-panel-${t.id}`}
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

      <div
        id={`workspace-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`workspace-tab-${tab}`}
        className="mt-4 min-h-0 flex-1"
      >
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              Loading workspace…
            </div>
          }
        >
          {tab === "whiteboard" && <WhiteboardTab workspace={workspace} />}
          {tab === "tasks" && (
            <TasksTab workspace={workspace} onViewOnBoard={viewOnBoard} />
          )}
          {tab === "documents" && (
            <DocumentsTab workspace={workspace} user={user} />
          )}
        </Suspense>
      </div>
    </div>
  );
}
