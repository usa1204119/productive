import { useEffect, useRef, useState } from "react";
import { Check, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import type { WorkspaceDto } from "@plane-and-curves/shared";
import { MAX_WORKSPACES_PER_USER } from "@plane-and-curves/shared";
import { ApiClientError } from "../lib/api.js";
import { useCurrentWorkspace } from "../lib/currentWorkspace.js";
import { useCreateWorkspace, useDeleteWorkspace, useRenameWorkspace } from "../lib/workspaces.js";
import { ConfirmDialog } from "./ConfirmDialog.js";

export function Sidebar() {
  const { workspaces, current, select } = useCurrentWorkspace();
  const create = useCreateWorkspace();
  const rename = useRenameWorkspace();
  const del = useDeleteWorkspace();

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceDto | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const atLimit = workspaces.filter((workspace) => workspace.isOwner).length >= MAX_WORKSPACES_PER_USER;

  const onNew = () => {
    setCreateError(null);
    create.mutate("New workspace", {
      onSuccess: (ws) => {
        select(ws.id);
        setRenamingId(ws.id);
      },
      onError: (err) => {
        setCreateError(
          err instanceof ApiClientError && err.code === "WORKSPACE_LIMIT_REACHED"
            ? `You've reached the limit of ${MAX_WORKSPACES_PER_USER} workspaces.`
            : "Could not create workspace.",
        );
      },
    });
  };

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="px-4 py-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Workspaces</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-2">
        {workspaces.map((ws) => (
          <WorkspaceRow
            key={ws.id}
            workspace={ws}
            active={current?.id === ws.id}
            renaming={renamingId === ws.id}
            onSelect={() => select(ws.id)}
            onStartRename={() => setRenamingId(ws.id)}
            onSubmitRename={(name) => {
              const trimmed = name.trim();
              if (trimmed && trimmed !== ws.name) rename.mutate({ id: ws.id, name: trimmed });
              setRenamingId(null);
            }}
            onCancelRename={() => setRenamingId(null)}
            onDelete={() => setDeleting(ws)}
          />
        ))}
      </nav>

      <div className="border-t border-slate-100 p-2">
        {createError && <p className="px-2 pb-2 text-xs text-rose-600">{createError}</p>}
        <button
          onClick={onNew}
          disabled={create.isPending || atLimit}
          title={atLimit ? `Limit of ${MAX_WORKSPACES_PER_USER} reached` : undefined}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          New WS
        </button>
      </div>

      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.name}”?`}
          destructive
          confirmLabel="Delete workspace"
          busy={del.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() =>
            del.mutate(deleting.id, {
              onSuccess: () => setDeleting(null),
            })
          }
          body={
            <>
              <p>
                This removes the workspace and its boards, tasks and document records from
                Swift Productive.
              </p>
              <p className="mt-2 font-medium text-slate-700">
                Your files in Google Drive are not deleted — only the references here are
                removed.
              </p>
            </>
          }
        />
      )}
    </aside>
  );
}

interface RowProps {
  workspace: WorkspaceDto;
  active: boolean;
  renaming: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onSubmitRename: (name: string) => void;
  onCancelRename: () => void;
  onDelete: () => void;
}

function WorkspaceRow({
  workspace,
  active,
  renaming,
  onSelect,
  onStartRename,
  onSubmitRename,
  onCancelRename,
  onDelete,
}: RowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState(workspace.name);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (renaming) setDraft(workspace.name);
  }, [renaming, workspace.name]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  if (renaming) {
    return (
      <div className="flex items-center gap-1 rounded-lg px-2 py-1.5">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmitRename(draft);
            if (e.key === "Escape") onCancelRename();
          }}
          className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-accent"
        />
        <button onClick={() => onSubmitRename(draft)} className="p-1 text-slate-500 hover:text-accent">
          <Check className="h-4 w-4" />
        </button>
        <button onClick={onCancelRename} className="p-1 text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`group relative flex items-center rounded-lg ${
        active ? "bg-accent/10 text-accent" : "text-slate-700 hover:bg-slate-50"
      }`}
    >
      <button onClick={onSelect} className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm">
        {workspace.name}
      </button>

      {workspace.isOwner && <div ref={menuRef} className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="mr-1 rounded p-1 text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-slate-600 group-hover:opacity-100 aria-expanded:opacity-100"
          aria-expanded={menuOpen}
          aria-label="Workspace options"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-8 z-10 w-36 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            <button
              onClick={() => {
                setMenuOpen(false);
                onStartRename();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <Pencil className="h-4 w-4" />
              Rename
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </div>
        )}
      </div>}
    </div>
  );
}
