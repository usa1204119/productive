import type { UploadProgressEvent } from "@plane-and-curves/shared";

type ProgressInput = Omit<UploadProgressEvent, "sequence">;
type Listener = (event: UploadProgressEvent) => void;

interface Channel {
  sequence: number;
  history: UploadProgressEvent[];
  listeners: Set<Listener>;
  cleanupTimer: NodeJS.Timeout | null;
}

const channels = new Map<string, Channel>();
const TERMINAL_TTL_MS = 2 * 60 * 1000;
const MAX_HISTORY = 64;

export function uploadProgressKey(
  userId: string,
  workspaceId: string,
  uploadId: string,
): string {
  return `${userId}:${workspaceId}:${uploadId}`;
}

function channelFor(key: string): Channel {
  let channel = channels.get(key);
  if (!channel) {
    channel = {
      sequence: 0,
      history: [],
      listeners: new Set(),
      cleanupTimer: null,
    };
    channels.set(key, channel);
  }
  return channel;
}

/** Publish ordered, monotonic progress for one upload. */
export function publishUploadProgress(key: string, input: ProgressInput): UploadProgressEvent {
  const channel = channelFor(key);
  const previous = channel.history.at(-1);
  const event: UploadProgressEvent = {
    ...input,
    sequence: channel.sequence + 1,
    bytesSent: Math.max(previous?.bytesSent ?? 0, input.bytesSent),
  };
  channel.sequence = event.sequence;
  channel.history.push(event);
  if (channel.history.length > MAX_HISTORY) channel.history.shift();
  for (const listener of channel.listeners) listener(event);

  if (event.phase === "complete" || event.phase === "error") {
    if (channel.cleanupTimer) clearTimeout(channel.cleanupTimer);
    channel.cleanupTimer = setTimeout(() => channels.delete(key), TERMINAL_TTL_MS);
    channel.cleanupTimer.unref();
  }
  return event;
}

/**
 * Subscribe and replay buffered events, preventing the "SSE connected a few
 * milliseconds late" race. Returns an unsubscribe function.
 */
export function subscribeUploadProgress(key: string, listener: Listener): () => void {
  const channel = channelFor(key);
  for (const event of channel.history) listener(event);
  channel.listeners.add(listener);
  return () => channel.listeners.delete(listener);
}

/** Test-only lifecycle reset; intentionally not exported from the HTTP layer. */
export function clearUploadProgressForTests(): void {
  for (const channel of channels.values()) {
    if (channel.cleanupTimer) clearTimeout(channel.cleanupTimer);
  }
  channels.clear();
}
