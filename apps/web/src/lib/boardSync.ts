import { useEffect, useRef } from "react";
import type {
  BoardCursorGoneMessage,
  BoardCursorMessage,
  BoardUpdateMessage,
} from "@plane-and-curves/shared";
import { socket } from "./collaboration.js";
import { api } from "./api.js";
import { reconcileElements, type Versioned } from "./reconcile.js";

/** The slice of the Excalidraw imperative API this hook touches. */
interface SceneApi {
  getSceneElements: () => readonly Versioned[];
  getSceneElementsIncludingDeleted?: () => readonly Versioned[];
  getFiles?: () => Record<string, unknown>;
  updateScene: (scene: { elements?: readonly unknown[]; collaborators?: Map<string, unknown> }) => void;
  addFiles: (files: unknown[]) => void;
}

type StoredFile = { id: string } & Record<string, unknown>;

const CURSOR_COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
function colorFor(key: string): { background: string; stroke: string } {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  const c = CURSOR_COLORS[hash % CURSOR_COLORS.length]!;
  return { background: c, stroke: c };
}

/**
 * Live co-editing for one open board. Broadcasts local element deltas + cursor to
 * peers (throttled), reconciles inbound deltas into the scene without disturbing
 * the local viewport/selection, and renders peer cursors.
 *
 * Image binaries are NOT sent over the socket (they blow past the frame limit and
 * would broadcast MBs to every peer). Instead, when an inbound element references
 * a file this peer doesn't have, we pull it from the durable store
 * (GET …/boards/:id/files, which the adder's save persists) and inject it into the
 * live canvas — retried briefly to cover the gap until that save lands.
 */
export function useBoardLiveSync(params: {
  workspaceId: string;
  boardId: string;
  canEdit: boolean;
  getApi: () => SceneApi | null;
}) {
  const { workspaceId, boardId, canEdit } = params;
  const getApi = useRef(params.getApi);
  getApi.current = params.getApi;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  const state = useRef({ subscribed: false });
  const lastVersions = useRef(new Map<string, number>());
  const knownFiles = useRef(new Set<string>());
  const collaborators = useRef(new Map<string, unknown>());

  const sceneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScene = useRef<readonly Versioned[] | null>(null);
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCursor = useRef<{ x: number | null; y: number | null; selectedIds: string[] } | null>(null);
  const fileRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!boardId) return;
    state.current = { subscribed: false };
    lastVersions.current = new Map();
    knownFiles.current = new Set();
    collaborators.current = new Map();

    const subscribe = () =>
      socket.emit("board:subscribe", { workspaceId, boardId }, (ack?: { ok?: boolean }) => {
        state.current.subscribed = Boolean(ack?.ok);
      });

    const applyCollaborators = () =>
      getApi.current()?.updateScene({ collaborators: new Map(collaborators.current) as never });

    // Pull image binaries a synced element references but we don't have yet.
    const fetchMissingFiles = (attempt = 0) => {
      const ex = getApi.current();
      if (!ex?.getFiles) return;
      const have = new Set(Object.keys(ex.getFiles()));
      const referenced = new Set<string>();
      for (const el of ex.getSceneElements() as ReadonlyArray<{ fileId?: string | null }>) {
        if (el.fileId) referenced.add(el.fileId);
      }
      const missing = [...referenced].filter((id) => !have.has(id) && !knownFiles.current.has(id));
      if (missing.length === 0) return;

      const retry = () => {
        if (attempt >= 5) return;
        if (fileRetryTimer.current) clearTimeout(fileRetryTimer.current);
        fileRetryTimer.current = setTimeout(() => fetchMissingFiles(attempt + 1), Math.min(1000 * 2 ** attempt, 8000));
      };

      void api<Record<string, StoredFile>>(`/workspaces/${workspaceId}/boards/${boardId}/files`)
        .then((files) => {
          const ex2 = getApi.current();
          if (!ex2) return;
          const toAdd = missing.map((id) => files[id]).filter((f): f is StoredFile => Boolean(f));
          if (toAdd.length) {
            ex2.addFiles(toAdd);
            for (const f of toAdd) knownFiles.current.add(f.id);
          }
          // Some may not be persisted yet (adder's save is debounced) — retry.
          if (missing.some((id) => !files[id])) retry();
        })
        .catch(retry);
    };

    const onUpdate = (msg: BoardUpdateMessage) => {
      if (msg.boardId !== boardId) return;
      const api = getApi.current();
      if (!api) return;
      for (const el of msg.elements) {
        if (typeof el.version === "number") lastVersions.current.set(el.id, el.version);
      }
      const base = (api.getSceneElementsIncludingDeleted?.() ?? api.getSceneElements()) as Versioned[];
      api.updateScene({ elements: reconcileElements(base, msg.elements as Versioned[]) as never });
      fetchMissingFiles();
    };
    const onCursor = (msg: BoardCursorMessage) => {
      if (msg.boardId !== boardId) return;
      collaborators.current.set(msg.socketId, {
        pointer: msg.x != null && msg.y != null ? { x: msg.x, y: msg.y } : undefined,
        button: "up",
        selectedElementIds: Object.fromEntries((msg.selectedIds ?? []).map((id) => [id, true])),
        username: msg.displayName,
        avatarUrl: msg.avatarUrl ?? undefined,
        color: colorFor(msg.userId || msg.socketId),
        id: msg.userId,
      });
      applyCollaborators();
    };
    const onCursorGone = (msg: BoardCursorGoneMessage) => {
      if (msg.boardId === boardId && collaborators.current.delete(msg.socketId)) applyCollaborators();
    };

    socket.on("board:update", onUpdate);
    socket.on("board:cursor", onCursor);
    socket.on("board:cursor-gone", onCursorGone);
    socket.on("connect", subscribe);
    if (socket.connected) subscribe();

    return () => {
      if (socket.connected) socket.emit("board:unsubscribe", { boardId });
      socket.off("board:update", onUpdate);
      socket.off("board:cursor", onCursor);
      socket.off("board:cursor-gone", onCursorGone);
      socket.off("connect", subscribe);
      if (sceneTimer.current) clearTimeout(sceneTimer.current);
      if (cursorTimer.current) clearTimeout(cursorTimer.current);
      if (fileRetryTimer.current) clearTimeout(fileRetryTimer.current);
      sceneTimer.current = cursorTimer.current = fileRetryTimer.current = null;
      pendingScene.current = pendingCursor.current = null;
      state.current = { subscribed: false };
    };
  }, [workspaceId, boardId]);

  const flushScene = () => {
    sceneTimer.current = null;
    const elements = pendingScene.current;
    pendingScene.current = null;
    if (!elements || !state.current.subscribed || !canEditRef.current) return;

    const changed: Versioned[] = [];
    for (const el of elements) {
      if (typeof el.version !== "number") continue;
      const last = lastVersions.current.get(el.id);
      if (last === undefined || el.version > last) {
        changed.push(el);
        lastVersions.current.set(el.id, el.version);
      }
    }
    if (changed.length) socket.emit("board:update", { boardId, elements: changed });
  };

  const flushCursor = () => {
    cursorTimer.current = null;
    const c = pendingCursor.current;
    pendingCursor.current = null;
    if (c && state.current.subscribed) {
      socket.emit("board:cursor", { boardId, x: c.x, y: c.y, selectedIds: c.selectedIds });
    }
  };

  return {
    /** Seed known versions from the loaded scene so the first edit sends a delta, not the whole scene. */
    primeVersions: (elements: readonly Versioned[]) => {
      const map = new Map<string, number>();
      for (const el of elements) if (typeof el.version === "number") map.set(el.id, el.version);
      lastVersions.current = map;
    },
    broadcastScene: (elements: readonly Versioned[]) => {
      if (!state.current.subscribed || !canEditRef.current) return;
      pendingScene.current = elements;
      if (!sceneTimer.current) sceneTimer.current = setTimeout(flushScene, 60);
    },
    broadcastPointer: (x: number | null, y: number | null, selectedIds: string[]) => {
      if (!state.current.subscribed) return;
      pendingCursor.current = { x, y, selectedIds };
      if (!cursorTimer.current) cursorTimer.current = setTimeout(flushCursor, 60);
    },
  };
}
