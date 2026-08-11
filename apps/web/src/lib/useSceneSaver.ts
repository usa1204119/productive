import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSceneVersion } from "@excalidraw/excalidraw";
import type { BoardDto } from "@plane-and-curves/shared";
import { SceneSaver, type SaveStatus, type Scene } from "./sceneSaver.js";
import { boardKey, saveBoardScene } from "./boards.js";
import { ApiClientError } from "./api.js";

/**
 * React binding for the autosave controller. One SceneSaver per open board;
 * it is disposed (and any pending change flushed) when the board changes or the
 * component unmounts, so switching boards never drops unsaved work.
 */
export function useSceneSaver(workspaceId: string, boardId: string | null) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const saverRef = useRef<SceneSaver | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!boardId) return;
    const saver = new SceneSaver({
      save: async (scene, baseRevision, force) => {
        const summary = await saveBoardScene(workspaceId, boardId, { ...scene, baseRevision, force });
        // Keep the board's cached scene current so remounting after a tab/slide
        // switch shows the just-saved scene, not the stale pre-edit one.
        queryClient.setQueryData<BoardDto>(boardKey(workspaceId, boardId), (prev) =>
          prev
            ? {
                ...prev,
                elements: scene.elements as BoardDto["elements"],
                appState: scene.appState as BoardDto["appState"],
                files: (scene.files ?? {}) as BoardDto["files"],
                revision: summary.revision,
              }
            : prev,
        );
        return summary;
      },
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
  }, [workspaceId, boardId, queryClient]);

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
