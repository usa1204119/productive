import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { WorkspaceDto } from "@plane-and-curves/shared";
import { useWorkspaces } from "./workspaces.js";

const STORAGE_KEY = "pac.currentWorkspaceId";

/** The three workspace sections. Tab lives here so the navbar and the panel share it. */
export type WorkspaceTab = "whiteboard" | "tasks" | "documents";

const tabKey = (workspaceId: string) => `pac.tab.${workspaceId}`;
const readTab = (workspaceId: string): WorkspaceTab =>
  (localStorage.getItem(tabKey(workspaceId)) as WorkspaceTab) || "whiteboard";

interface CurrentWorkspaceValue {
  workspaces: WorkspaceDto[];
  current: WorkspaceDto | null;
  isLoading: boolean;
  select: (id: string) => void;
  tab: WorkspaceTab;
  setTab: (tab: WorkspaceTab) => void;
}

const Ctx = createContext<CurrentWorkspaceValue | null>(null);

/**
 * Tracks which workspace is selected. Persisted across reloads and reconciled
 * against the loaded list (falls back to the first workspace if the stored id
 * no longer exists). Context is used here only because the conventions permit
 * it for current-workspace selection.
 */
export function CurrentWorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { data: workspaces = [], isLoading } = useWorkspaces();
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  );

  const current = useMemo<WorkspaceDto | null>(() => {
    if (workspaces.length === 0) return null;
    return workspaces.find((w) => w.id === selectedId) ?? workspaces[0] ?? null;
  }, [workspaces, selectedId]);

  // Keep the stored id in sync with the effective selection.
  useEffect(() => {
    if (current && current.id !== selectedId) {
      setSelectedId(current.id);
      localStorage.setItem(STORAGE_KEY, current.id);
    }
  }, [current, selectedId]);

  // Active tab, remembered per workspace and restored when the workspace changes.
  const [tab, setTabState] = useState<WorkspaceTab>("whiteboard");
  useEffect(() => {
    if (current) setTabState(readTab(current.id));
  }, [current?.id]);

  const value: CurrentWorkspaceValue = {
    workspaces,
    current,
    isLoading,
    select: (id) => {
      setSelectedId(id);
      localStorage.setItem(STORAGE_KEY, id);
    },
    tab,
    setTab: (next) => {
      setTabState(next);
      if (current) localStorage.setItem(tabKey(current.id), next);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCurrentWorkspace(): CurrentWorkspaceValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCurrentWorkspace must be used within CurrentWorkspaceProvider");
  return ctx;
}
