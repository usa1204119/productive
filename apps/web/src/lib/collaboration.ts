import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io } from "socket.io-client";
import type { PresenceEntry, WorkspaceEvent } from "@plane-and-curves/shared";
import type { WorkspaceTab } from "./currentWorkspace.js";

export const socket = io({ path: "/socket.io", autoConnect: false, withCredentials: true });

export function useWorkspaceCollaboration(workspaceId: string | undefined, activeSection: WorkspaceTab) {
  const queryClient = useQueryClient();
  const [presence, setPresence] = useState<PresenceEntry[]>([]);

  useEffect(() => {
    if (!workspaceId) return;
    const onConnect = () => {
      socket.emit("workspace:join", { workspaceId, activeSection });
      // A (re)connect may have missed events while we were offline — re-sync the
      // workspace's lists so a client that loaded stale content self-heals.
      void queryClient.invalidateQueries({ queryKey: ["boards", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["tasks", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] });
    };
    const onPresence = (entries: PresenceEntry[]) => setPresence(entries);
    const onEvent = (event: WorkspaceEvent) => {
      if (event.workspaceId !== workspaceId) return;
      if (event.type.startsWith("board.")) {
        void queryClient.invalidateQueries({ queryKey: ["boards", workspaceId] });
        if (event.entityId) void queryClient.invalidateQueries({ queryKey: ["board", workspaceId, event.entityId] });
      } else if (event.type.startsWith("task.")) {
        void queryClient.invalidateQueries({ queryKey: ["tasks", workspaceId] });
      } else if (event.type.startsWith("document.")) {
        void queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] });
      } else {
        void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
        void queryClient.invalidateQueries({ queryKey: ["workspace-members", workspaceId] });
      }
    };
    const onRevoked = (payload: { workspaceId?: string }) => {
      if (payload.workspaceId !== workspaceId) return;
      setPresence([]);
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      void queryClient.removeQueries({ queryKey: ["boards", workspaceId] });
      void queryClient.removeQueries({ queryKey: ["tasks", workspaceId] });
      void queryClient.removeQueries({ queryKey: ["documents", workspaceId] });
    };

    socket.on("connect", onConnect);
    socket.on("workspace:presence", onPresence);
    socket.on("workspace:event", onEvent);
    socket.on("workspace:access-revoked", onRevoked);
    if (!socket.connected) socket.connect();
    else onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("workspace:presence", onPresence);
      socket.off("workspace:event", onEvent);
      socket.off("workspace:access-revoked", onRevoked);
      setPresence([]);
    };
  }, [workspaceId, activeSection, queryClient]);

  return presence;
}
