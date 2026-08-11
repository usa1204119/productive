import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BoardDto, BoardSummaryDto } from "@plane-and-curves/shared";
import { api } from "./api.js";

const boardsKey = (workspaceId: string) => ["boards", workspaceId] as const;
export const boardKey = (workspaceId: string, boardId: string) => ["board", workspaceId, boardId] as const;

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

export function useReorderBoard(workspaceId: string) {
  const qc = useQueryClient();
  const key = boardsKey(workspaceId);
  return useMutation({
    mutationFn: ({ id, prevId, nextId }: { id: string; prevId: string | null; nextId: string | null }) =>
      api<BoardSummaryDto>(`/workspaces/${workspaceId}/boards/${id}/reorder`, {
        method: "POST",
        body: JSON.stringify({ prevId, nextId }),
      }),
    onMutate: async ({ id, prevId, nextId }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardSummaryDto[]>(key) ?? [];
      const byId = new Map(prev.map((b) => [b.id, b]));
      const prevOrder = prevId ? (byId.get(prevId)?.order ?? null) : null;
      const nextOrder = nextId ? (byId.get(nextId)?.order ?? null) : null;
      let order: number;
      if (prevOrder !== null && nextOrder !== null) order = (prevOrder + nextOrder) / 2;
      else if (nextOrder !== null) order = nextOrder - 1000;
      else if (prevOrder !== null) order = prevOrder + 1000;
      else order = 1000;
      qc.setQueryData<BoardSummaryDto[]>(
        key,
        prev
          .map((b) => (b.id === id ? { ...b, order } : b))
          .sort((a, b) => a.order - b.order),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
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
    baseRevision: number;
    elements: readonly unknown[];
    appState: Record<string, unknown>;
    files?: Record<string, unknown>;
    force?: boolean;
  },
): Promise<BoardSummaryDto> {
  return api<BoardSummaryDto>(`/workspaces/${workspaceId}/boards/${boardId}/scene`, {
    method: "PUT",
    body: JSON.stringify(scene),
  });
}
