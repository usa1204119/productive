import { lazy, Suspense, useEffect, useRef, useState, type ComponentProps } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Excalidraw } from "@excalidraw/excalidraw";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { BoardDto, BoardSummaryDto, WorkspaceDto } from "@plane-and-curves/shared";
import {
  boardKey,
  useBoard,
  useBoards,
  useCreateBoard,
  useDeleteBoard,
  useRenameBoard,
  useReorderBoard,
} from "../lib/boards.js";
import { useSceneSaver } from "../lib/useSceneSaver.js";
import { useBoardLiveSync } from "../lib/boardSync.js";
import { captureSelectionSnapshot } from "../lib/snapshot.js";
import type { SaveStatus } from "../lib/sceneSaver.js";
import { ConfirmDialog } from "./ConfirmDialog.js";

const AiChatPanel = lazy(() => import("./ai/AiChatPanel.js").then((m) => ({ default: m.AiChatPanel })));

/** A request from the Tasks tab to open a slide and focus a specific element. */
export interface BoardFocusRequest {
  boardId: string;
  elementId: string;
}

type ExcalidrawAPI = Parameters<
  NonNullable<ComponentProps<typeof Excalidraw>["excalidrawAPI"]>
>[0];

interface WhiteboardTabProps {
  workspace: WorkspaceDto;
  /** Whether the whiteboard tab is the visible one (it stays mounted when not). */
  active?: boolean;
  focus?: BoardFocusRequest | null;
  onFocusHandled?: () => void;
}

/** Whiteboard tab: a left slide rail + the Excalidraw canvas. */
export function WhiteboardTab({ workspace, active = true, focus, onFocusHandled }: WhiteboardTabProps) {
  const boardsQuery = useBoards(workspace.id);
  const { data: boards = [], isLoading, isError, isFetching } = boardsQuery;
  const create = useCreateBoard(workspace.id);
  const [boardId, setBoardId] = useState<string | null>(null);
  const canEdit = workspace.currentRole !== "VIEWER";

  const storageKey = `pac.board.${workspace.id}`;

  // Pick a slide: a pending focus target wins, else remembered, else the first.
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
    if (!canEdit) return;
    create.mutate(`Slide ${boards.length + 1}`, { onSuccess: (b) => select(b.id) });
  };

  const onDeleted = (deletedId: string) => {
    const remaining = boards.filter((board) => board.id !== deletedId);
    if (deletedId !== boardId) return; // deleting a non-active slide keeps the view
    if (remaining[0]) select(remaining[0].id);
    else {
      setBoardId(null);
      localStorage.removeItem(storageKey);
    }
  };

  if (isLoading) return <FullMessage>Loading slides…</FullMessage>;

  return (
    <div className="flex h-full min-h-0">
      <SlideRail
        workspaceId={workspace.id}
        boards={boards}
        activeId={boardId}
        canEdit={canEdit}
        creating={create.isPending}
        onSelect={select}
        onNewBoard={onNewBoard}
        onDeleted={onDeleted}
      />
      <div className="relative min-w-0 flex-1">
        {isError ? (
          <FullMessage>
            <div className="text-center">
              <p className="text-sm text-slate-600">Couldn't load slides.</p>
              <p className="mt-1 text-xs text-slate-400">
                The server may have been waking up. This usually clears on retry.
              </p>
              <button
                onClick={() => void boardsQuery.refetch()}
                disabled={isFetching}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
                {isFetching ? "Retrying…" : "Retry"}
              </button>
            </div>
          </FullMessage>
        ) : boards.length === 0 ? (
          <FullMessage>
            <div className="text-center">
              <p className="text-sm text-slate-500">No slides yet.</p>
              {canEdit && (
                <button
                  onClick={onNewBoard}
                  disabled={create.isPending}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
                >
                  <Plus className="h-4 w-4" />
                  {create.isPending ? "Creating…" : "New slide"}
                </button>
              )}
            </div>
          </FullMessage>
        ) : boardId ? (
          <BoardCanvas
            key={boardId}
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            boardId={boardId}
            canEdit={canEdit}
            active={active}
            focus={focus && focus.boardId === boardId ? focus : null}
            onFocusHandled={onFocusHandled}
          />
        ) : (
          <FullMessage>Select a slide.</FullMessage>
        )}
      </div>
    </div>
  );
}

/** Left rail: list/add/rename/delete/reorder slides. Collapsible. */
function SlideRail({
  workspaceId,
  boards,
  activeId,
  canEdit,
  creating,
  onSelect,
  onNewBoard,
  onDeleted,
}: {
  workspaceId: string;
  boards: BoardSummaryDto[];
  activeId: string | null;
  canEdit: boolean;
  creating: boolean;
  onSelect: (id: string) => void;
  onNewBoard: () => void;
  onDeleted: (id: string) => void;
}) {
  const rename = useRenameBoard(workspaceId);
  const del = useDeleteBoard(workspaceId);
  const reorder = useReorderBoard(workspaceId);
  const collapseKey = `pac.rail.${workspaceId}`;

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(collapseKey) === "1");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<BoardSummaryDto | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(collapseKey, next ? "1" : "0");
      return next;
    });
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = boards.findIndex((b) => b.id === active.id);
    const newIndex = boards.findIndex((b) => b.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const seq = arrayMove(boards, oldIndex, newIndex);
    const idx = seq.findIndex((b) => b.id === active.id);
    reorder.mutate({
      id: String(active.id),
      prevId: seq[idx - 1]?.id ?? null,
      nextId: seq[idx + 1]?.id ?? null,
    });
  };

  if (collapsed) {
    return (
      <div className="flex h-full w-10 shrink-0 flex-col items-center gap-2 border-r border-slate-200 bg-white py-2">
        <button
          onClick={toggle}
          title="Show slides"
          aria-label="Show slides"
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        {canEdit && (
          <button
            onClick={onNewBoard}
            disabled={creating}
            title="New slide"
            aria-label="New slide"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Slides</span>
        <button
          onClick={toggle}
          title="Hide slides"
          aria-label="Hide slides"
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={boards.map((b) => b.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-1">
              {boards.map((b, i) => (
                <SlideRow
                  key={b.id}
                  index={i + 1}
                  board={b}
                  active={b.id === activeId}
                  canEdit={canEdit}
                  renaming={renamingId === b.id}
                  onSelect={() => onSelect(b.id)}
                  onStartRename={() => setRenamingId(b.id)}
                  onSubmitRename={(name) => {
                    const trimmed = name.trim();
                    if (trimmed && trimmed !== b.name) rename.mutate({ id: b.id, name: trimmed });
                    setRenamingId(null);
                  }}
                  onCancelRename={() => setRenamingId(null)}
                  onDelete={() => setDeleting(b)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </div>

      {canEdit && (
        <div className="border-t border-slate-100 p-2">
          <button
            onClick={onNewBoard}
            disabled={creating}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            New slide
          </button>
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.name}”?`}
          destructive
          confirmLabel="Delete slide"
          busy={del.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() =>
            del.mutate(deleting.id, {
              onSuccess: () => {
                onDeleted(deleting.id);
                setDeleting(null);
              },
            })
          }
          body="The slide is removed. Tasks created from it survive, but their board back-links are cleared."
        />
      )}
    </aside>
  );
}

function SlideRow({
  index,
  board,
  active,
  canEdit,
  renaming,
  onSelect,
  onStartRename,
  onSubmitRename,
  onCancelRename,
  onDelete,
}: {
  index: number;
  board: BoardSummaryDto;
  active: boolean;
  canEdit: boolean;
  renaming: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onSubmitRename: (name: string) => void;
  onCancelRename: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: board.id,
    disabled: !canEdit,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState(board.name);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (renaming) setDraft(board.name);
  }, [renaming, board.name]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  if (renaming) {
    return (
      <li className="flex items-center gap-1 rounded-lg px-1 py-1">
        <input
          autoFocus
          value={draft}
          maxLength={100}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmitRename(draft);
            if (e.key === "Escape") onCancelRename();
          }}
          onBlur={() => onSubmitRename(draft)}
          className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-accent"
        />
      </li>
    );
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-1 rounded-lg border px-1.5 py-1.5 ${
        active ? "border-accent/40 bg-accent/5" : "border-transparent hover:bg-slate-50"
      } ${isDragging ? "opacity-60 shadow-sm" : ""}`}
    >
      {canEdit && (
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none text-slate-300 opacity-0 transition group-hover:opacity-100"
          aria-label="Drag to reorder slide"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <button onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] font-medium text-slate-500">
          {index}
        </span>
        <span className={`min-w-0 truncate text-sm ${active ? "text-accent" : "text-slate-700"}`}>
          {board.name}
        </span>
      </button>

      {canEdit && (
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded p-1 text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-slate-600 group-hover:opacity-100"
            aria-label="Slide options"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-7 z-30 w-32 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onStartRename();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                <Pencil className="h-4 w-4" />
                Rename
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

interface BoardCanvasProps {
  workspaceId: string;
  workspaceName: string;
  boardId: string;
  canEdit: boolean;
  active: boolean;
  focus: BoardFocusRequest | null;
  onFocusHandled?: () => void;
}

function BoardCanvas({ workspaceId, workspaceName, boardId, canEdit, active, focus, onFocusHandled }: BoardCanvasProps) {
  const { data: board, isLoading, isError, refetch } = useBoard(workspaceId, boardId);
  const queryClient = useQueryClient();
  const cacheTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScene = useRef<{
    elements: readonly unknown[];
    appState: Record<string, unknown>;
    files: Record<string, unknown>;
  } | null>(null);
  const saver = useSceneSaver(workspaceId, boardId);
  const apiRef = useRef<ExcalidrawAPI | null>(null);
  const live = useBoardLiveSync({
    workspaceId,
    boardId,
    canEdit,
    getApi: () => apiRef.current as never,
  });
  const primed = useRef(false);
  const focusDone = useRef(false);

  const [selectedCount, setSelectedCount] = useState(0);
  const [toast, setToast] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);
  const [askingAi, setAskingAi] = useState(false);
  const [aiSnapshot, setAiSnapshot] = useState<string | null>(null);

  const showToast = (kind: "ok" | "warn", text: string) => setToast({ kind, text });

  useEffect(() => {
    if (board && !primed.current) {
      saver.prime(board.elements, board.revision);
      live.primeVersions(board.elements as never);
      primed.current = true;
    }
  }, [board, saver, live]);

  // Excalidraw measures its container; when the whiteboard becomes visible again
  // after being hidden (tab switch), nudge it to re-fit to the now-sized canvas.
  useEffect(() => {
    if (active) apiRef.current?.refresh();
  }, [active]);

  // Flush the pending cache write on unmount so nothing is left dangling.
  useEffect(() => () => {
    if (cacheTimer.current) clearTimeout(cacheTimer.current);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!focus || focusDone.current) return;
    const api = apiRef.current;
    if (!api || !board) return;
    focusDone.current = true;
    const target = api.getSceneElements().find((e) => e.id === focus.elementId);
    if (!target) {
      showToast("warn", "That element no longer exists on this slide.");
    } else {
      api.scrollToContent(target, { fitToContent: true, animate: true });
      api.updateScene({ appState: { selectedElementIds: { [focus.elementId]: true } } });
    }
    onFocusHandled?.();
  }, [focus, board, onFocusHandled]);

  const onAskAi = async () => {
    const api = apiRef.current;
    if (!api || askingAi) return;
    setAskingAi(true);
    try {
      const snapshot = await captureSelectionSnapshot(api as never);
      if (snapshot) setAiSnapshot(snapshot);
      else showToast("warn", "Select something on the board first.");
    } catch {
      showToast("warn", "Couldn't capture the selection. Please try again.");
    } finally {
      setAskingAi(false);
    }
  };

  const reloadLatest = async () => {
    const latest = await refetch();
    if (!latest.data || !apiRef.current) return;
    apiRef.current.updateScene({
      elements: latest.data.elements as never,
      appState: sanitizeAppState(latest.data.appState) as never,
    });
    apiRef.current.addFiles(Object.values(latest.data.files ?? {}) as never);
    saver.acceptLatest(latest.data.elements, latest.data.revision);
  };

  if (isLoading) return <FullMessage>Loading slide…</FullMessage>;
  if (isError || !board) return <FullMessage>Could not load this slide.</FullMessage>;

  return (
    <div className="relative h-full min-h-0">
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
        <SaveChip status={saver.status} onRetry={saver.retryNow} />
      </div>

      {selectedCount > 0 && (
        <div className="absolute bottom-14 left-1/2 z-20 -translate-x-1/2">
          <button
            onClick={() => void onAskAi()}
            disabled={askingAi}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white shadow-md transition hover:bg-accent-hover disabled:opacity-60"
          >
            {askingAi ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Ask AI
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
        viewModeEnabled={!canEdit}
        excalidrawAPI={(api) => (apiRef.current = api)}
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
          const scene = {
            elements: elements as readonly unknown[],
            appState: sanitizeAppState(appState as unknown as Record<string, unknown>),
            files: (files ?? {}) as Record<string, unknown>,
          };
          // Broadcast element deltas to peers (fast, ephemeral) AND persist our own
          // edits. Every editor persists; the server merges by element version, so
          // concurrent saves converge with no lost work and no conflict dialog.
          // Image binaries travel via the durable store, not the socket (peers pull
          // them in boardSync), so only elements are broadcast here.
          live.broadcastScene(elements as readonly never[]);
          saver.schedule(scene);
          // Keep the board's query cache current with the latest EDIT (throttled,
          // trailing), independent of the async/debounced save — so remounting this
          // slide (or a reload) seeds Excalidraw from the live scene, never a stale
          // one.
          pendingScene.current = scene;
          if (!cacheTimer.current) {
            cacheTimer.current = setTimeout(() => {
              cacheTimer.current = null;
              const p = pendingScene.current;
              pendingScene.current = null;
              if (!p) return;
              queryClient.setQueryData<BoardDto>(boardKey(workspaceId, boardId), (prev) =>
                prev
                  ? {
                      ...prev,
                      elements: p.elements as BoardDto["elements"],
                      appState: p.appState as BoardDto["appState"],
                      files: p.files as BoardDto["files"],
                    }
                  : prev,
              );
            }, 300);
          }
        }}
        onPointerUpdate={(payload) => {
          const selected = apiRef.current?.getAppState().selectedElementIds ?? {};
          live.broadcastPointer(
            payload.pointer?.x ?? null,
            payload.pointer?.y ?? null,
            Object.keys(selected),
          );
        }}
      />

      {saver.status === "conflict" && (
        <ConflictDialog
          onReload={() => void reloadLatest()}
          onOverwrite={() => void saver.overwriteNow()}
        />
      )}

      {aiSnapshot && (
        <Suspense fallback={null}>
          <AiChatPanel
            workspaceId={workspaceId}
            workspaceName={workspaceName}
            snapshot={aiSnapshot}
            onClose={() => setAiSnapshot(null)}
          />
        </Suspense>
      )}
    </div>
  );
}

/**
 * Excalidraw's `collaborators` is a Map at runtime. Once persisted as JSON it
 * comes back as a plain object, and Excalidraw's restore calls `.forEach` on it
 * -> "forEach is not a function". Strip it (Excalidraw rebuilds an empty Map).
 */
function sanitizeAppState(appState: Record<string, unknown>): Record<string, unknown> {
  if (!appState || typeof appState !== "object") return {};
  const { collaborators: _collaborators, ...rest } = appState;
  return rest;
}

function SaveChip({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  if (status === "idle") return null;

  if (status === "error" || status === "conflict") {
    return (
      <span className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 shadow-sm">
        <TriangleAlert className="h-3.5 w-3.5" />
        {status === "conflict" ? "Save conflict" : "Save failed"}
        {status === "error" && (
          <button onClick={onRetry} className="ml-1 underline underline-offset-2 hover:no-underline">
            Retry
          </button>
        )}
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

function ConflictDialog({ onReload, onOverwrite }: { onReload: () => void; onOverwrite: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="board-conflict-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg">
        <h2 id="board-conflict-title" className="font-semibold text-slate-800">Another collaborator changed this slide</h2>
        <p className="mt-2 text-sm text-slate-600">Your unsaved version is still held in this browser. Reload the latest slide, or deliberately overwrite it with your local version.</p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onReload} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Reload latest</button>
          <button type="button" onClick={onOverwrite} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700">Overwrite latest</button>
        </div>
      </div>
    </div>
  );
}

function FullMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">{children}</div>
  );
}
