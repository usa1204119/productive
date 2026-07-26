import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import { Check, ListPlus, Loader2, Plus, TriangleAlert } from "lucide-react";
import type { BoardElementInput, BoardSummaryDto, BridgeResultDto, WorkspaceDto } from "@plane-and-curves/shared";
import { useBoard, useBoards, useCreateBoard } from "../lib/boards.js";
import { useSceneSaver } from "../lib/useSceneSaver.js";
import { useCreateTasksFromSelection } from "../lib/bridge.js";
import type { SaveStatus } from "../lib/sceneSaver.js";

/** A request from the Tasks tab to open a board and focus a specific element. */
export interface BoardFocusRequest {
  boardId: string;
  elementId: string;
}

type ExcalidrawAPI = Parameters<
  NonNullable<ComponentProps<typeof Excalidraw>["excalidrawAPI"]>
>[0];

interface WhiteboardTabProps {
  workspace: WorkspaceDto;
  focus?: BoardFocusRequest | null;
  onFocusHandled?: () => void;
}

/** Whiteboard tab: the board switcher lives inside Excalidraw's top toolbar. */
export function WhiteboardTab({ workspace, focus, onFocusHandled }: WhiteboardTabProps) {
  const { data: boards = [], isLoading } = useBoards(workspace.id);
  const create = useCreateBoard(workspace.id);
  const [boardId, setBoardId] = useState<string | null>(null);

  const storageKey = `pac.board.${workspace.id}`;

  // Pick a board: a pending focus target wins, else remembered, else most recent.
  useEffect(() => {
    if (boards.length === 0) {
      setBoardId(null);
      return;
    }
    if (focus && boards.some((b) => b.id === focus.boardId)) {
      setBoardId(focus.boardId);
      return;
    }
    const remembered = localStorage.getItem(storageKey);
    const exists = boards.some((b) => b.id === remembered);
    setBoardId(exists ? remembered : boards[0]!.id);
  }, [boards, storageKey, focus]);

  const select = (id: string) => {
    setBoardId(id);
    localStorage.setItem(storageKey, id);
  };

  const onNewBoard = () => {
    create.mutate(`Board ${boards.length + 1}`, { onSuccess: (b) => select(b.id) });
  };

  if (isLoading) return <FullMessage>Loading boards…</FullMessage>;

  if (boards.length === 0) {
    return (
      <FullMessage>
        <div className="text-center">
          <p className="text-sm text-slate-500">No boards yet.</p>
          <button
            onClick={onNewBoard}
            disabled={create.isPending}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            {create.isPending ? "Creating…" : "New board"}
          </button>
        </div>
      </FullMessage>
    );
  }

  if (!boardId) return <FullMessage>Select a board.</FullMessage>;

  return (
    <BoardCanvas
      key={boardId}
      workspaceId={workspace.id}
      boardId={boardId}
      boards={boards}
      creating={create.isPending}
      onSelect={select}
      onNewBoard={onNewBoard}
      focus={focus && focus.boardId === boardId ? focus : null}
      onFocusHandled={onFocusHandled}
    />
  );
}

interface BoardCanvasProps {
  workspaceId: string;
  boardId: string;
  boards: BoardSummaryDto[];
  creating: boolean;
  onSelect: (id: string) => void;
  onNewBoard: () => void;
  focus: BoardFocusRequest | null;
  onFocusHandled?: () => void;
}

function BoardCanvas({
  workspaceId,
  boardId,
  boards,
  creating,
  onSelect,
  onNewBoard,
  focus,
  onFocusHandled,
}: BoardCanvasProps) {
  const { data: board, isLoading, isError } = useBoard(workspaceId, boardId);
  const saver = useSceneSaver(workspaceId, boardId);
  const addToTasks = useCreateTasksFromSelection(workspaceId);
  const apiRef = useRef<ExcalidrawAPI | null>(null);
  const primed = useRef(false);
  const focusDone = useRef(false);

  const [selectedCount, setSelectedCount] = useState(0);
  const [toast, setToast] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);

  const showToast = (kind: "ok" | "warn", text: string) => setToast({ kind, text });

  // Seed the saved version from the loaded scene so an untouched board isn't re-saved.
  useEffect(() => {
    if (board && !primed.current) {
      saver.prime(board.elements);
      primed.current = true;
    }
  }, [board, saver]);

  // Auto-dismiss the toast.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Focus request from a task's board back-link: zoom to and select the element.
  useEffect(() => {
    if (!focus || focusDone.current) return;
    const api = apiRef.current;
    if (!api || !board) return;
    focusDone.current = true;
    const target = api.getSceneElements().find((e) => e.id === focus.elementId);
    if (!target) {
      showToast("warn", "That element no longer exists on this board.");
    } else {
      api.scrollToContent(target, { fitToContent: true, animate: true });
      api.updateScene({ appState: { selectedElementIds: { [focus.elementId]: true } } });
    }
    onFocusHandled?.();
  }, [focus, board, onFocusHandled]);

  const onAddToTasks = () => {
    const api = apiRef.current;
    if (!api) return;
    const selectedIds = api.getAppState().selectedElementIds;
    const elements: BoardElementInput[] = api
      .getSceneElements()
      .filter((e) => selectedIds[e.id])
      .map((e) => ({ id: e.id, type: e.type, text: (e as { text?: string }).text ?? null }));
    if (elements.length === 0) return;

    addToTasks.mutate(
      { boardId, elements },
      {
        onSuccess: (res) => showToast("ok", summarize(res)),
        onError: () => showToast("warn", "Couldn't add to tasks. Please try again."),
      },
    );
  };

  if (isLoading) return <FullMessage>Loading board…</FullMessage>;
  if (isError || !board) return <FullMessage>Could not load this board.</FullMessage>;

  return (
    <div className="relative h-full min-h-0">
      {/* Saved indicator — bottom-centre so it never covers Excalidraw's UI. */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
        <SaveChip status={saver.status} onRetry={saver.retryNow} />
      </div>

      {/* Floating "Add to tasks" — appears only when elements are selected. */}
      {selectedCount > 0 && (
        <div className="absolute bottom-14 left-1/2 z-20 -translate-x-1/2">
          <button
            onClick={onAddToTasks}
            disabled={addToTasks.isPending}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white shadow-md transition hover:bg-accent-hover disabled:opacity-60"
          >
            {addToTasks.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ListPlus className="h-4 w-4" />
            )}
            Add to tasks
            <span className="rounded-full bg-white/20 px-1.5 text-xs">{selectedCount}</span>
          </button>
        </div>
      )}

      {toast && (
        <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2">
          <span
            className={`rounded-full px-4 py-2 text-sm font-medium shadow-md ${
              toast.kind === "ok" ? "bg-slate-800 text-white" : "bg-amber-50 text-amber-800"
            }`}
          >
            {toast.text}
          </span>
        </div>
      )}

      <Excalidraw
        excalidrawAPI={(api) => (apiRef.current = api)}
        renderTopRightUI={() => (
          <BoardBar
            boards={boards}
            boardId={boardId}
            creating={creating}
            onSelect={onSelect}
            onNewBoard={onNewBoard}
          />
        )}
        initialData={{
          elements: Array.isArray(board.elements) ? (board.elements as never) : ([] as never),
          appState: sanitizeAppState(board.appState as Record<string, unknown>) as never,
          files: (board.files ?? {}) as never,
          scrollToContent: true,
        }}
        onChange={(elements, appState, files) => {
          const count = Object.keys(appState.selectedElementIds ?? {}).length;
          setSelectedCount((prev) => (prev === count ? prev : count));
          if (!primed.current) return; // ignore the initial restore emit
          saver.schedule({
            elements: elements as readonly unknown[],
            appState: sanitizeAppState(appState as unknown as Record<string, unknown>),
            files: (files ?? {}) as Record<string, unknown>,
          });
        }}
      />
    </div>
  );
}

/** Board switcher + New Board, rendered inside Excalidraw's top toolbar. */
function BoardBar({
  boards,
  boardId,
  creating,
  onSelect,
  onNewBoard,
}: {
  boards: BoardSummaryDto[];
  boardId: string;
  creating: boolean;
  onSelect: (id: string) => void;
  onNewBoard: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <select
        value={boardId}
        onChange={(e) => onSelect(e.target.value)}
        aria-label="Switch board"
        className="h-9 max-w-[10rem] rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none focus:border-accent"
      >
        {boards.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <button
        onClick={onNewBoard}
        disabled={creating}
        title="New board"
        aria-label="New board"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * Excalidraw's `collaborators` is a Map at runtime. Once persisted as JSON it
 * comes back as a plain object, and Excalidraw's restore calls `.forEach` on it
 * -> "forEach is not a function". Strip it (Excalidraw rebuilds an empty Map),
 * both when loading a scene and before saving one. Element data is untouched.
 */
function sanitizeAppState(appState: Record<string, unknown>): Record<string, unknown> {
  if (!appState || typeof appState !== "object") return {};
  const { collaborators: _collaborators, ...rest } = appState;
  return rest;
}

function summarize(res: BridgeResultDto): string {
  const n = res.created.length;
  if (n === 0) {
    return res.skipped > 0 ? `No text elements selected (skipped ${res.skipped}).` : "Nothing to add.";
  }
  const parts = [`Created ${n} task${n === 1 ? "" : "s"}`];
  if (res.skipped > 0) parts.push(`skipped ${res.skipped} non-text`);
  if (res.trimmed > 0) parts.push(`${res.trimmed} trimmed`);
  return `${parts.join(" · ")}.`;
}

function SaveChip({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  if (status === "idle") return null;

  if (status === "error") {
    return (
      <span className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 shadow-sm">
        <TriangleAlert className="h-3.5 w-3.5" />
        Save failed
        <button onClick={onRetry} className="ml-1 underline underline-offset-2 hover:no-underline">
          Retry
        </button>
      </span>
    );
  }

  if (status === "saved") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-slate-500 shadow-sm">
        <Check className="h-3.5 w-3.5 text-emerald-600" />
        Saved
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-slate-500 shadow-sm">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Saving…
    </span>
  );
}

function FullMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">{children}</div>
  );
}
