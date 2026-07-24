import { useEffect, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import { Check, Loader2, Plus, TriangleAlert } from "lucide-react";
import type { WorkspaceDto } from "@plane-and-curves/shared";
import { useBoard, useBoards, useCreateBoard } from "../lib/boards.js";
import { useSceneSaver } from "../lib/useSceneSaver.js";
import type { SaveStatus } from "../lib/sceneSaver.js";

/** Whiteboard tab: board switcher + New Board on top, Excalidraw fills the rest. */
export function WhiteboardTab({ workspace }: { workspace: WorkspaceDto }) {
  const { data: boards = [], isLoading } = useBoards(workspace.id);
  const create = useCreateBoard(workspace.id);
  const [boardId, setBoardId] = useState<string | null>(null);

  const storageKey = `pac.board.${workspace.id}`;

  // Pick a board: remembered one if it still exists, else the most recent.
  useEffect(() => {
    if (boards.length === 0) {
      setBoardId(null);
      return;
    }
    const remembered = localStorage.getItem(storageKey);
    const exists = boards.some((b) => b.id === remembered);
    setBoardId(exists ? remembered : boards[0]!.id);
  }, [boards, storageKey]);

  const select = (id: string) => {
    setBoardId(id);
    localStorage.setItem(storageKey, id);
  };

  const onNewBoard = () => {
    create.mutate(`Board ${boards.length + 1}`, { onSuccess: (b) => select(b.id) });
  };

  if (isLoading) {
    return <FullMessage>Loading boards…</FullMessage>;
  }

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

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <select
          value={boardId ?? ""}
          onChange={(e) => select(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-accent"
        >
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <button
          onClick={onNewBoard}
          disabled={create.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
        >
          <Plus className="h-4 w-4" />
          New Board
        </button>
      </div>

      {boardId && (
        <BoardCanvas key={boardId} workspaceId={workspace.id} boardId={boardId} />
      )}
    </div>
  );
}

function BoardCanvas({ workspaceId, boardId }: { workspaceId: string; boardId: string }) {
  const { data: board, isLoading, isError } = useBoard(workspaceId, boardId);
  const saver = useSceneSaver(workspaceId, boardId);
  const primed = useRef(false);

  // Seed the saved version from the loaded scene so an untouched board isn't re-saved.
  useEffect(() => {
    if (board && !primed.current) {
      saver.prime(board.elements);
      primed.current = true;
    }
  }, [board, saver]);

  if (isLoading) return <FullMessage>Loading board…</FullMessage>;
  if (isError || !board) return <FullMessage>Could not load this board.</FullMessage>;

  return (
    <div className="relative min-h-0 flex-1">
      <div className="absolute right-3 top-3 z-10">
        <SaveChip status={saver.status} onRetry={saver.retryNow} />
      </div>
      <Excalidraw
        initialData={{
          elements: board.elements as never,
          appState: board.appState as never,
          scrollToContent: true,
        }}
        onChange={(elements, appState) => {
          if (!primed.current) return; // ignore the initial restore emit
          saver.schedule({
            elements: elements as readonly unknown[],
            appState: appState as unknown as Record<string, unknown>,
          });
        }}
      />
    </div>
  );
}

function SaveChip({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  if (status === "idle") return null;

  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 shadow-sm">
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

  // dirty | saving → a pending write
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
