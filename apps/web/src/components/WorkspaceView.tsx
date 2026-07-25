import { lazy, Suspense, useEffect, useState } from "react";
import type { UserDto, WorkspaceDto } from "@plane-and-curves/shared";
import type { BoardFocusRequest } from "./WhiteboardTab.js";
import { ErrorBoundary } from "./ErrorBoundary.js";

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

  const [focus, setFocus] = useState<BoardFocusRequest | null>(null);

  const choose = (id: TabId) => {
    setTab(id);
    localStorage.setItem(storageKey, id);
  };

  // "View on board" from a task: remember the target board, request focus on the
  // source element, then switch tabs. Tasks stay decoupled from Excalidraw — this
  // only passes IDs; the Whiteboard tab performs the zoom/select.
  const viewOnBoard = (boardId: string, elementId: string | null) => {
    localStorage.setItem(`pac.board.${workspace.id}`, boardId);
    setFocus(elementId ? { boardId, elementId } : null);
    choose("whiteboard");
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-slate-200 px-6">
        <h1 className="shrink-0 truncate py-2.5 text-sm font-semibold text-slate-800">
          {workspace.name}
        </h1>
        <div className="flex gap-5" role="tablist" aria-label="Workspace sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`workspace-tab-${t.id}`}
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`workspace-panel-${t.id}`}
              onClick={() => choose(t.id)}
              className={`-mb-px border-b-2 py-2.5 text-sm font-medium transition ${
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
        className="min-h-0 flex-1"
      >
        <ErrorBoundary>
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                Loading…
              </div>
            }
          >
            {tab === "whiteboard" && (
              <WhiteboardTab
                workspace={workspace}
                focus={focus}
                onFocusHandled={() => setFocus(null)}
              />
            )}
            {tab === "tasks" && <TasksTab workspace={workspace} onViewOnBoard={viewOnBoard} />}
            {tab === "documents" && <DocumentsTab workspace={workspace} user={user} />}
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}
