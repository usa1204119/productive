import { useEffect, useState } from "react";
import { CalendarClock, SquareArrowOutUpRight, Trash2, X } from "lucide-react";
import type { TaskDto } from "@plane-and-curves/shared";
import { useDeleteTask, useUpdateTask } from "../lib/tasks.js";
import { fromLocalInputValue, toLocalInputValue } from "../lib/dates.js";

interface TaskPanelProps {
  workspaceId: string;
  task: TaskDto;
  onClose: () => void;
  onViewOnBoard: (boardId: string) => void;
}

/** Right-hand side panel for a single task (not a modal). Escape closes it. */
export function TaskPanel({ workspaceId, task, onClose, onViewOnBoard }: TaskPanelProps) {
  const update = useUpdateTask(workspaceId);
  const del = useDeleteTask(workspaceId);

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");

  // Reset local fields when a different task is selected.
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
  }, [task.id, task.title, task.description]);

  // Escape closes the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const saveTitle = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== task.title) update.mutate({ id: task.id, patch: { title: trimmed } });
    else setTitle(task.title);
  };

  const saveDescription = () => {
    const value = description.trim() === "" ? null : description;
    if (value !== task.description) update.mutate({ id: task.id, patch: { description: value } });
  };

  return (
    <aside className="flex h-full w-96 shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Task details
        </span>
        <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            rows={4}
            placeholder="Add details…"
            className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <CalendarClock className="h-3.5 w-3.5" />
            Due
          </label>
          <input
            type="datetime-local"
            value={toLocalInputValue(task.dueAt)}
            onChange={(e) =>
              update.mutate({ id: task.id, patch: { dueAt: fromLocalInputValue(e.target.value) } })
            }
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium text-slate-500">Documents</span>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">
            Attaching documents arrives in Step 6.
          </p>
        </div>

        {task.sourceBoardId && (
          <button
            onClick={() => onViewOnBoard(task.sourceBoardId!)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-hover"
          >
            <SquareArrowOutUpRight className="h-4 w-4" />
            View on board
          </button>
        )}
      </div>

      <div className="border-t border-slate-100 p-4">
        <button
          onClick={() => {
            del.mutate(task.id);
            onClose();
          }}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
        >
          <Trash2 className="h-4 w-4" />
          Delete task
        </button>
      </div>
    </aside>
  );
}
