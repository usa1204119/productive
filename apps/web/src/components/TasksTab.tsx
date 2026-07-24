import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, GripVertical } from "lucide-react";
import type { TaskDto, WorkspaceDto } from "@plane-and-curves/shared";
import { useCreateTask, useReorderTask, useTasks, useUpdateTask } from "../lib/tasks.js";
import { formatDueChip, isOverdue } from "../lib/dates.js";
import { TaskPanel } from "./TaskPanel.js";

export function TasksTab({
  workspace,
  onViewOnBoard,
}: {
  workspace: WorkspaceDto;
  onViewOnBoard: (boardId: string) => void;
}) {
  const { data: tasks = [], isLoading } = useTasks(workspace.id);
  const create = useCreateTask(workspace.id);
  const update = useUpdateTask(workspace.id);
  const reorder = useReorderTask(workspace.id);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const doneKey = `pac.done.${workspace.id}`;
  const [doneOpen, setDoneOpen] = useState(() => localStorage.getItem(doneKey) === "1");
  const addRef = useRef<HTMLInputElement>(null);

  const active = useMemo(
    () => tasks.filter((t) => !t.completed).sort((a, b) => a.order - b.order),
    [tasks],
  );
  const done = useMemo(
    () =>
      tasks
        .filter((t) => t.completed)
        .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")),
    [tasks],
  );

  const selected = tasks.find((t) => t.id === selectedId) ?? null;
  useEffect(() => {
    // Close the panel if its task disappeared (deleted).
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragEnd = (event: DragEndEvent) => {
    const { active: dragged, over } = event;
    if (!over || dragged.id === over.id) return;
    const oldIndex = active.findIndex((t) => t.id === dragged.id);
    const newIndex = active.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const seq = arrayMove(active, oldIndex, newIndex);
    const idx = seq.findIndex((t) => t.id === dragged.id);
    reorder.mutate({
      id: String(dragged.id),
      prevId: seq[idx - 1]?.id ?? null,
      nextId: seq[idx + 1]?.id ?? null,
    });
  };

  const addTask = () => {
    const title = newTitle.trim();
    if (!title) return;
    create.mutate(title);
    setNewTitle("");
    addRef.current?.focus(); // keep focus for rapid entry
  };

  const toggleDone = (open: boolean) => {
    setDoneOpen(open);
    localStorage.setItem(doneKey, open ? "1" : "0");
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto max-w-2xl">
            {isLoading ? (
              <p className="text-sm text-slate-400">Loading tasks…</p>
            ) : (
              <>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                  <SortableContext items={active.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                    <ul className="space-y-1">
                      {active.map((task) => (
                        <SortableTaskRow
                          key={task.id}
                          task={task}
                          selected={task.id === selectedId}
                          onSelect={() => setSelectedId(task.id)}
                          onToggle={() =>
                            update.mutate({ id: task.id, patch: { completed: true } })
                          }
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>

                {active.length === 0 && (
                  <p className="py-6 text-center text-sm text-slate-400">
                    No tasks yet. Add one below.
                  </p>
                )}

                <div className="mt-3">
                  <input
                    ref={addRef}
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addTask();
                    }}
                    placeholder="Add task and press Enter…"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-accent"
                  />
                </div>

                {done.length > 0 && (
                  <div className="mt-8">
                    <button
                      onClick={() => toggleDone(!doneOpen)}
                      className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600"
                    >
                      <ChevronRight
                        className={`h-3.5 w-3.5 transition ${doneOpen ? "rotate-90" : ""}`}
                      />
                      Done ({done.length})
                    </button>
                    {doneOpen && (
                      <ul className="mt-2 space-y-1">
                        {done.map((task) => (
                          <DoneRow
                            key={task.id}
                            task={task}
                            selected={task.id === selectedId}
                            onSelect={() => setSelectedId(task.id)}
                            onReopen={() =>
                              update.mutate({ id: task.id, patch: { completed: false } })
                            }
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {selected && (
        <TaskPanel
          workspaceId={workspace.id}
          task={selected}
          onClose={() => setSelectedId(null)}
          onViewOnBoard={onViewOnBoard}
        />
      )}
    </div>
  );
}

function SortableTaskRow({
  task,
  selected,
  onSelect,
  onToggle,
}: {
  task: TaskDto;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-2 rounded-lg border px-2 py-2 ${
        selected ? "border-accent/40 bg-accent/5" : "border-transparent hover:bg-slate-50"
      } ${isDragging ? "opacity-60 shadow-sm" : ""}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-slate-300 opacity-0 transition group-hover:opacity-100"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <input
        type="checkbox"
        checked={false}
        onChange={onToggle}
        className="h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 text-accent focus:ring-accent"
        aria-label="Complete task"
      />
      <button onClick={onSelect} className="min-w-0 flex-1 truncate text-left text-sm text-slate-700">
        {task.title}
      </button>
      {task.dueAt && <DueChip iso={task.dueAt} />}
    </li>
  );
}

function DoneRow({
  task,
  selected,
  onSelect,
  onReopen,
}: {
  task: TaskDto;
  selected: boolean;
  onSelect: () => void;
  onReopen: () => void;
}) {
  return (
    <li
      className={`flex items-center gap-2 rounded-lg px-2 py-2 ${
        selected ? "bg-accent/5" : "hover:bg-slate-50"
      }`}
    >
      <span className="w-4" />
      <input
        type="checkbox"
        checked
        onChange={onReopen}
        className="h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 text-accent focus:ring-accent"
        aria-label="Reopen task"
      />
      <button
        onClick={onSelect}
        className="min-w-0 flex-1 truncate text-left text-sm text-slate-400 line-through"
      >
        {task.title}
      </button>
    </li>
  );
}

function DueChip({ iso }: { iso: string }) {
  const overdue = isOverdue(iso);
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
        overdue ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-500"
      }`}
    >
      {formatDueChip(iso)}
    </span>
  );
}
