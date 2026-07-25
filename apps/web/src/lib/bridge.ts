import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BoardElementInput, BridgeResultDto } from "@plane-and-curves/shared";
import { api } from "./api.js";

/**
 * "Add to tasks": send a selection of board elements to the bridge. The server
 * processor decides which become tasks; we just invalidate the task list.
 */
export function useCreateTasksFromSelection(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, elements }: { boardId: string; elements: BoardElementInput[] }) =>
      api<BridgeResultDto>(`/workspaces/${workspaceId}/boards/${boardId}/tasks-from-selection`, {
        method: "POST",
        body: JSON.stringify({ elements }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", workspaceId] }),
  });
}
