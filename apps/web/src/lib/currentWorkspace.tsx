import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { WorkspaceDto } from "@plane-and-curves/shared";
import { useWorkspaces } from "./workspaces.js";

const STORAGE_KEY = "pac.currentWorkspaceId";

interface CurrentWorkspaceValue {
  workspaces: WorkspaceDto[];
  current: WorkspaceDto | null;
  isLoading: boolean;
  select: (id: string) => void;
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

  const value: CurrentWorkspaceValue = {
    workspaces,
    current,
    isLoading,
    select: (id) => {
      setSelectedId(id);
      localStorage.setItem(STORAGE_KEY, id);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCurrentWorkspace(): CurrentWorkspaceValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCurrentWorkspace must be used within CurrentWorkspaceProvider");
  return ctx;
}
