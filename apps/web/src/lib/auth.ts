import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserDto } from "@plane-and-curves/shared";
import { api, ApiClientError } from "./api.js";

export const AUTH_ME_KEY = ["auth", "me"] as const;

/** Current user, or null when not signed in. Server state via TanStack Query. */
export function useCurrentUser() {
  return useQuery<UserDto | null>({
    queryKey: AUTH_ME_KEY,
    queryFn: async () => {
      try {
        return await api<UserDto>("/auth/me");
      } catch (err) {
        if (err instanceof ApiClientError && err.code === "UNAUTHENTICATED") return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

export function useGuestLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<UserDto>("/auth/guest", { method: "POST" }),
    onSuccess: (user) => qc.setQueryData(AUTH_ME_KEY, user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ loggedOut: boolean }>("/auth/logout", { method: "POST" }),
    onSuccess: () => qc.setQueryData(AUTH_ME_KEY, null),
  });
}

/** Google Sign-In and guest conversion are full-page redirects. */
export const googleSignIn = () => {
  window.location.href = "/auth/google";
};
export const googleLink = () => {
  window.location.href = "/auth/google/link";
};
export const googleDriveConnect = () => {
  window.location.href = "/auth/google/drive";
};
