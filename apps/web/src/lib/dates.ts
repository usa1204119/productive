import { format, parseISO } from "date-fns";

/**
 * Due dates are stored/exchanged as UTC ISO strings; we convert to the viewer's
 * local timezone only here, in the UI.
 */

/** Short chip label, e.g. "Aug 1" or "Aug 1, 3:30 PM" when a time is set. */
export function formatDueChip(iso: string): string {
  const d = parseISO(iso);
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  return hasTime ? format(d, "MMM d, p") : format(d, "MMM d");
}

/** Overdue = due instant is in the past (caller decides whether completed matters). */
export function isOverdue(iso: string): boolean {
  return parseISO(iso).getTime() < Date.now();
}

/** ISO (UTC) → value for a <input type="datetime-local"> (local time). */
export function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  return format(parseISO(iso), "yyyy-MM-dd'T'HH:mm");
}

/** <input type="datetime-local"> value (local) → ISO (UTC), or null if empty. */
export function fromLocalInputValue(local: string): string | null {
  if (!local) return null;
  return new Date(local).toISOString();
}
