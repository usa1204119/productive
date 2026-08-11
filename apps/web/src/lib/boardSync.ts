import { useEffect, useRef } from "react";
import type {
  BoardCursorGoneMessage,
  BoardCursorMessage,
  BoardFilesMessage,
  BoardRoleMessage,
  BoardUpdateMessage,
} from "@plane-and-curves/shared";
import { socket } from "./collaboration.js";
import { reconcileElements, type Versioned } from "./reconcile.js";

/** The slice of the Excalidraw imperative API this hook touches. */
interface SceneApi {
  getSceneElements: () => readonly Versioned[];
  getSceneElementsIncludingDeleted?: () => readonly Versioned[];
  updateScene: (scene: { elements?: readonly unknown[]; collaborators?: Map<string, unknown> }) => void;
  addFiles: (files: unknown[]) => void;
}

const CURSOR_COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
function colorFor(key: string): { background: string; stroke: string } {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  const c = CURSOR_COLORS[hash % CURSOR_COLORS.length]!;
  return { background: c, stroke: c };
}

/**
 * Live co-editing for one open board. Broadcasts local element deltas + cursor
 * to peers (throttled), reconciles inbound deltas into the scene without
 * disturbing the local viewport/selection, renders peer cursors, and gates
 * persistence to the server-elected "leader" so N editors never fight the board
 * revision. Falls back to normal local persistence when the socket is offline.
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

  const state = useRef({ subscribed: false, isLeader: false });
  const lastVersions = useRef(new Map<string, number>());
  const knownFiles = useRef(new Set<string>());
  const collaborators = useRef(new Map<string, unknown>());

  const sceneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScene = useRef<{ elements: readonly Versioned[]; files: Record<string, unknown> } | null>(null);
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCursor = useRef<{ x: number | null; y: number | null; selectedIds: string[] } | null>(null);

  useEffect(() => {
    if (!boardId) return;
    state.current = { subscribed: false, isLeader: false };
    lastVersions.current = new Map();
    knownFiles.current = new Set();
    collaborators.current = new Map();

    const subscribe = () =>
      socket.emit("board:subscribe", { workspaceId, boardId }, (ack?: { ok?: boolean }) => {
        state.current.subscribed = Boolean(ack?.ok);
      });

    const applyCollaborators = () =>
      getApi.current()?.updateScene({ collaborators: new Map(collaborators.current) as never });

    const onUpdate = (msg: BoardUpdateMessage) => {
      if (msg.boardId !== boardId) return;
      const api = getApi.current();
      if (!api) return;
      for (const el of msg.elements) {
        if (typeof el.version === "number") lastVersions.current.set(el.id, el.version);
      }
      const base = (api.getSceneElementsIncludingDeleted?.() ?? api.getSceneElements()) as Versioned[];
      api.updateScene({ elements: reconcileElements(base, msg.elements as Versioned[]) as never });
    };
    const onFiles = (msg: BoardFilesMessage) => {
      if (msg.boardId !== boardId) return;
      const api = getApi.current();
      if (!api) return;
      const values = Object.values(msg.files ?? {});
      if (values.length) api.addFiles(values);
      for (const id of Object.keys(msg.files ?? {})) knownFiles.current.add(id);
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
    const onRole = (msg: BoardRoleMessage) => {
      if (msg.boardId === boardId) state.current.isLeader = Boolean(msg.isLeader);
    };

    socket.on("board:update", onUpdate);
    socket.on("board:files", onFiles);
    socket.on("board:cursor", onCursor);
    socket.on("board:cursor-gone", onCursorGone);
    socket.on("board:role", onRole);
    socket.on("connect", subscribe);
    if (socket.connected) subscribe();

    return () => {
      if (socket.connected) socket.emit("board:unsubscribe", { boardId });
      socket.off("board:update", onUpdate);
      socket.off("board:files", onFiles);
      socket.off("board:cursor", onCursor);
      socket.off("board:cursor-gone", onCursorGone);
      socket.off("board:role", onRole);
      socket.off("connect", subscribe);
      if (sceneTimer.current) clearTimeout(sceneTimer.current);
      if (cursorTimer.current) clearTimeout(cursorTimer.current);
      sceneTimer.current = cursorTimer.current = null;
      pendingScene.current = pendingCursor.current = null;
      state.current = { subscribed: false, isLeader: false };
    };
  }, [workspaceId, boardId]);

  const flushScene = () => {
    sceneTimer.current = null;
    const snap = pendingScene.current;
    pendingScene.current = null;
    if (!snap || !state.current.subscribed || !canEditRef.current) return;

    const changed: Versioned[] = [];
    for (const el of snap.elements) {
      if (typeof el.version !== "number") continue;
      const last = lastVersions.current.get(el.id);
      if (last === undefined || el.version > last) {
        changed.push(el);
        lastVersions.current.set(el.id, el.version);
      }
    }
    if (changed.length) socket.emit("board:update", { boardId, elements: changed });

    const newFiles: Record<string, unknown> = {};
    let hasNew = false;
    for (const [id, file] of Object.entries(snap.files ?? {})) {
      if (!knownFiles.current.has(id)) {
        newFiles[id] = file;
        knownFiles.current.add(id);
        hasNew = true;
      }
    }
    if (hasNew) socket.emit("board:files", { boardId, files: newFiles });
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
    broadcastScene: (elements: readonly Versioned[], files: Record<string, unknown>) => {
      if (!state.current.subscribed || !canEditRef.current) return;
      pendingScene.current = { elements, files };
      if (!sceneTimer.current) sceneTimer.current = setTimeout(flushScene, 60);
    },
    broadcastPointer: (x: number | null, y: number | null, selectedIds: string[]) => {
      if (!state.current.subscribed) return;
      pendingCursor.current = { x, y, selectedIds };
      if (!cursorTimer.current) cursorTimer.current = setTimeout(flushCursor, 60);
    },
    /** Persist only when we're the leader — or when live sync isn't active (solo/offline). */
    shouldPersist: () => !state.current.subscribed || state.current.isLeader,
  };
}
