import { lazy, Suspense, useState } from "react";
import type { UserDto, WorkspaceDto } from "@plane-and-curves/shared";
import type { BoardFocusRequest } from "./WhiteboardTab.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { useCurrentWorkspace } from "../lib/currentWorkspace.js";

// Excalidraw is intentionally isolated in the Whiteboard chunk; users opening
// Tasks or Documents should not download the large canvas runtime up front.
const WhiteboardTab = lazy(() =>
  import("./WhiteboardTab.js").then((m) => ({ default: m.WhiteboardTab })),
);
const TasksTab = lazy(() => import("./TasksTab.js").then((m) => ({ default: m.TasksTab })));
const DocumentsTab = lazy(() =>
  import("./DocumentsTab.js").then((m) => ({ default: m.DocumentsTab })),
);

/**
 * Renders the active workspace section full-height. The tab selector lives in
 * the top navbar (shared via the workspace context), so this is just the panel.
 */
export function WorkspaceView({ workspace, user }: { workspace: WorkspaceDto; user: UserDto }) {
  const { tab, setTab } = useCurrentWorkspace();
  const [focus, setFocus] = useState<BoardFocusRequest | null>(null);

  // "View on board" from a task: remember the target board, request focus on the
  // source element, then switch to the whiteboard tab. Tasks stay decoupled from
  // Excalidraw — this only passes IDs; the Whiteboard tab performs the zoom/select.
  const viewOnBoard = (boardId: string, elementId: string | null) => {
    localStorage.setItem(`pac.board.${workspace.id}`, boardId);
    setFocus(elementId ? { boardId, elementId } : null);
    setTab("whiteboard");
  };

  return (
    <div
      id={`workspace-panel-${tab}`}
      role="tabpanel"
      aria-label={`${workspace.name} — ${tab}`}
      className="h-full min-h-0"
    >
      {/*
        The whiteboard stays MOUNTED across tab switches (only hidden) so Excalidraw
        keeps its in-progress scene. Unmounting it on every tab change re-seeds the
        canvas from a possibly-stale query cache (initialData is read once at mount),
        which is what dropped unsaved edits when leaving and returning to the tab.
        Its own ErrorBoundary/Suspense isolate its (lazy) load and any crash from
        Tasks/Documents.
      */}
      <div hidden={tab !== "whiteboard"} className="h-full min-h-0">
        <ErrorBoundary>
          <Suspense fallback={<PanelLoading />}>
            <WhiteboardTab
              workspace={workspace}
              active={tab === "whiteboard"}
              focus={focus}
              onFocusHandled={() => setFocus(null)}
            />
          </Suspense>
        </ErrorBoundary>
      </div>
      {tab !== "whiteboard" && (
        <ErrorBoundary>
          <Suspense fallback={<PanelLoading />}>
            {tab === "tasks" && <TasksTab workspace={workspace} onViewOnBoard={viewOnBoard} />}
            {tab === "documents" && <DocumentsTab workspace={workspace} user={user} />}
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
}

function PanelLoading() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading…</div>
  );
}
