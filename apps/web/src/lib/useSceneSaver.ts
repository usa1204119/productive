import { useEffect, useRef, useState } from "react";
import { getSceneVersion } from "@excalidraw/excalidraw";
import { SceneSaver, type SaveStatus, type Scene } from "./sceneSaver.js";
import { saveBoardScene } from "./boards.js";

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
      save: (scene) => saveBoardScene(workspaceId, boardId, scene).then(() => undefined),
      versionOf: (elements) =>
        getSceneVersion(elements as Parameters<typeof getSceneVersion>[0]),
      onStatusChange: setStatus,
    });
    saverRef.current = saver;
    return () => {
      saver.flushNow();
      saver.dispose();
      saverRef.current = null;
    };
  }, [workspaceId, boardId]);

  return {
    status,
    schedule: (scene: Scene) => saverRef.current?.schedule(scene),
    prime: (elements: readonly unknown[]) => saverRef.current?.primeSaved(elements),
    retryNow: () => saverRef.current?.retryNow(),
    flushNow: () => saverRef.current?.flushNow(),
  };
}
