import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TaskDto, UpdateTaskInput } from "@plane-and-curves/shared";
import { api } from "./api.js";

const tasksKey = (workspaceId: string) => ["tasks", workspaceId] as const;

export function useTasks(workspaceId: string) {
  return useQuery<TaskDto[]>({
    queryKey: tasksKey(workspaceId),
    queryFn: () => api<TaskDto[]>(`/workspaces/${workspaceId}/tasks`),
  });
}

/** Apply an optimistic patch locally, mirroring the server's completion rule. */
function applyPatch(task: TaskDto, patch: UpdateTaskInput): TaskDto {
  const next: TaskDto = { ...task };
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.dueAt !== undefined) next.dueAt = patch.dueAt;
  if (patch.completed !== undefined && patch.completed !== task.completed) {
    next.completed = patch.completed;
    next.completedAt = patch.completed ? new Date().toISOString() : null;
  }
  return next;
}

/**
 * Small helper to wrap a mutation with optimistic cache edits + rollback.
 * `mutate` performs the network call; `optimistic` transforms the cached list.
 */
function useOptimisticTaskMutation<TArgs>(
  workspaceId: string,
  mutate: (args: TArgs) => Promise<unknown>,
  optimistic: (list: TaskDto[], args: TArgs) => TaskDto[],
) {
  const qc = useQueryClient();
  const key = tasksKey(workspaceId);
  return useMutation({
    mutationFn: mutate,
    onMutate: async (args: TArgs) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<TaskDto[]>(key) ?? [];
      qc.setQueryData<TaskDto[]>(key, optimistic(prev, args));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useCreateTask(workspaceId: string) {
  return useOptimisticTaskMutation<string>(
    workspaceId,
    (title) =>
      api<TaskDto>(`/workspaces/${workspaceId}/tasks`, {
        method: "POST",
        body: JSON.stringify({ title }),
      }),
    (list, title) => {
      const maxOrder = list.reduce((m, t) => Math.max(m, t.order), 0);
      const now = new Date().toISOString();
      const optimistic: TaskDto = {
        id: `temp-${Date.now()}`,
        title,
        description: null,
        completed: false,
        completedAt: null,
        order: maxOrder + 1000,
        dueAt: null,
        sourceBoardId: null,
        sourceElementId: null,
        createdAt: now,
        updatedAt: now,
      };
      return [...list, optimistic];
    },
  );
}

export function useUpdateTask(workspaceId: string) {
  return useOptimisticTaskMutation<{ id: string; patch: UpdateTaskInput }>(
    workspaceId,
    ({ id, patch }) =>
      api<TaskDto>(`/workspaces/${workspaceId}/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    (list, { id, patch }) => list.map((t) => (t.id === id ? applyPatch(t, patch) : t)),
  );
}

export function useReorderTask(workspaceId: string) {
  return useOptimisticTaskMutation<{ id: string; prevId: string | null; nextId: string | null }>(
    workspaceId,
    ({ id, prevId, nextId }) =>
      api<TaskDto>(`/workspaces/${workspaceId}/tasks/${id}/reorder`, {
        method: "POST",
        body: JSON.stringify({ prevId, nextId }),
      }),
    (list, { id, prevId, nextId }) => {
      const byId = new Map(list.map((t) => [t.id, t]));
      const prevOrder = prevId ? (byId.get(prevId)?.order ?? null) : null;
      const nextOrder = nextId ? (byId.get(nextId)?.order ?? null) : null;
      let order: number;
      if (prevOrder !== null && nextOrder !== null) order = (prevOrder + nextOrder) / 2;
      else if (nextOrder !== null) order = nextOrder - 1000;
      else if (prevOrder !== null) order = prevOrder + 1000;
      else order = 1000;
      return list.map((t) => (t.id === id ? { ...t, order } : t));
    },
  );
}

export function useDeleteTask(workspaceId: string) {
  return useOptimisticTaskMutation<string>(
    workspaceId,
    (id) => api<{ deleted: boolean }>(`/workspaces/${workspaceId}/tasks/${id}`, { method: "DELETE" }),
    (list, id) => list.filter((t) => t.id !== id),
  );
}
