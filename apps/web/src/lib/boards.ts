import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BoardDto, BoardSummaryDto } from "@plane-and-curves/shared";
import { api } from "./api.js";

const boardsKey = (workspaceId: string) => ["boards", workspaceId] as const;
const boardKey = (workspaceId: string, boardId: string) => ["board", workspaceId, boardId] as const;

export function useBoards(workspaceId: string) {
  return useQuery<BoardSummaryDto[]>({
    queryKey: boardsKey(workspaceId),
    queryFn: () => api<BoardSummaryDto[]>(`/workspaces/${workspaceId}/boards`),
  });
}

export function useBoard(workspaceId: string, boardId: string | null) {
  return useQuery<BoardDto>({
    queryKey: boardKey(workspaceId, boardId ?? "none"),
    queryFn: () => api<BoardDto>(`/workspaces/${workspaceId}/boards/${boardId}`),
    enabled: Boolean(boardId),
  });
}

export function useCreateBoard(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api<BoardSummaryDto>(`/workspaces/${workspaceId}/boards`, {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: boardsKey(workspaceId) }),
  });
}

export function useRenameBoard(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api<BoardSummaryDto>(`/workspaces/${workspaceId}/boards/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: boardsKey(workspaceId) }),
  });
}

export function useDeleteBoard(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ deleted: boolean }>(`/workspaces/${workspaceId}/boards/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: boardsKey(workspaceId) }),
  });
}

/** Save the scene (used by the autosave controller, not a React Query mutation). */
export function saveBoardScene(
  workspaceId: string,
  boardId: string,
  scene: {
    elements: readonly unknown[];
    appState: Record<string, unknown>;
    files?: Record<string, unknown>;
  },
): Promise<unknown> {
  return api(`/workspaces/${workspaceId}/boards/${boardId}/scene`, {
    method: "PUT",
    body: JSON.stringify(scene),
  });
}
