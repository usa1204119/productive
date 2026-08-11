import { useEffect, useRef, useState } from "react";
import { getSceneVersion } from "@excalidraw/excalidraw";
import { SceneSaver, type SaveStatus, type Scene } from "./sceneSaver.js";
import { saveBoardScene } from "./boards.js";
import { ApiClientError } from "./api.js";

/**
 * React binding for the autosave controller. One SceneSaver per open board;
 * it is disposed (and any pending change flushed) when the board changes or the
 * component unmounts, so switching boards never drops unsaved work.
 */
export function useSceneSaver(workspaceId: string, boardId: string | null) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const saverRef = useRef<SceneSaver | null>(null);

  useEffect(() => {
    if (!boardId) return;
    const saver = new SceneSaver({
      save: (scene, baseRevision, force) =>
        saveBoardScene(workspaceId, boardId, { ...scene, baseRevision, force }),
      versionOf: (elements) =>
        getSceneVersion(elements as Parameters<typeof getSceneVersion>[0]),
      onStatusChange: setStatus,
      isConflict: (error) => error instanceof ApiClientError && error.code === "BOARD_CONFLICT",
    });
    saverRef.current = saver;
    return () => {
      void saver.flushNow().finally(() => saver.dispose());
      saverRef.current = null;
    };
  }, [workspaceId, boardId]);

  return {
    status,
    schedule: (scene: Scene) => saverRef.current?.schedule(scene),
    prime: (elements: readonly unknown[], revision: number) =>
      saverRef.current?.primeSaved(elements, revision),
    retryNow: () => saverRef.current?.retryNow(),
    flushNow: () => saverRef.current?.flushNow() ?? Promise.resolve(),
    overwriteNow: () => saverRef.current?.overwriteNow() ?? Promise.resolve(),
    acceptLatest: (elements: readonly unknown[], revision: number) =>
      saverRef.current?.acceptLatest(elements, revision),
    dispose: () => saverRef.current?.dispose(),
  };
}
