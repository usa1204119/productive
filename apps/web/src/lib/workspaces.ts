import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WorkspaceDto } from "@plane-and-curves/shared";
import { api } from "./api.js";

const WORKSPACES_KEY = ["workspaces"] as const;

export function useWorkspaces() {
  return useQuery<WorkspaceDto[]>({
    queryKey: WORKSPACES_KEY,
    queryFn: () => api<WorkspaceDto[]>("/workspaces"),
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api<WorkspaceDto>("/workspaces", { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: WORKSPACES_KEY }),
  });
}

export function useRenameWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api<WorkspaceDto>(`/workspaces/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: WORKSPACES_KEY }),
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ deleted: boolean }>(`/workspaces/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: WORKSPACES_KEY }),
  });
}
