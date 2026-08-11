import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AssignableWorkspaceRole,
  InvitationPreviewDto,
  WorkspaceInvitationDto,
  WorkspaceMemberDto,
} from "@plane-and-curves/shared";
import { api } from "./api.js";

export const membersKey = (workspaceId: string) => ["workspace-members", workspaceId] as const;
export const invitationsKey = (workspaceId: string) => ["workspace-invitations", workspaceId] as const;

export function useMembers(workspaceId: string, enabled = true) {
  return useQuery<WorkspaceMemberDto[]>({
    queryKey: membersKey(workspaceId),
    queryFn: () => api(`/workspaces/${workspaceId}/members`),
    enabled,
  });
}

export function useInvitations(workspaceId: string, enabled = true) {
  return useQuery<WorkspaceInvitationDto[]>({
    queryKey: invitationsKey(workspaceId),
    queryFn: () => api(`/workspaces/${workspaceId}/invitations`),
    enabled,
  });
}

function useRefreshSharing(workspaceId: string) {
  const queryClient = useQueryClient();
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: membersKey(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: invitationsKey(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
  ]);
}

export function useInviteMember(workspaceId: string) {
  const refresh = useRefreshSharing(workspaceId);
  return useMutation({
    mutationFn: (input: { email: string; role: AssignableWorkspaceRole }) =>
      api<WorkspaceInvitationDto>(`/workspaces/${workspaceId}/invitations`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: refresh,
  });
}

export function useResendInvitation(workspaceId: string) {
  const refresh = useRefreshSharing(workspaceId);
  return useMutation({
    mutationFn: (invitationId: string) =>
      api<WorkspaceInvitationDto>(`/workspaces/${workspaceId}/invitations/${invitationId}/resend`, { method: "POST" }),
    onSuccess: refresh,
  });
}

export function useRevokeInvitation(workspaceId: string) {
  const refresh = useRefreshSharing(workspaceId);
  return useMutation({
    mutationFn: (invitationId: string) =>
      api<{ revoked: boolean }>(`/workspaces/${workspaceId}/invitations/${invitationId}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
}

export function useUpdateMemberRole(workspaceId: string) {
  const refresh = useRefreshSharing(workspaceId);
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: AssignableWorkspaceRole }) =>
      api<{ updated: boolean }>(`/workspaces/${workspaceId}/members/${memberId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    onSuccess: refresh,
  });
}

export function useRemoveMember(workspaceId: string) {
  const refresh = useRefreshSharing(workspaceId);
  return useMutation({
    mutationFn: (memberId: string) =>
      api<{ removed: boolean }>(`/workspaces/${workspaceId}/members/${memberId}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
}

export function useInvitationPreview(token: string) {
  return useQuery<InvitationPreviewDto>({
    queryKey: ["invitation-preview", token],
    queryFn: () => api(`/workspace-invitations/${encodeURIComponent(token)}`),
    retry: false,
  });
}

export function useAcceptInvitation(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ workspaceId: string }>(`/workspace-invitations/${encodeURIComponent(token)}/accept`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}
