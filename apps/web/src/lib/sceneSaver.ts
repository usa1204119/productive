/**
 * Framework-agnostic autosave controller for a single board's scene.
 *
 * Guarantees (the invariants Step 4 must hold):
 *  - Change-gated: only saves when the scene VERSION actually changed.
 *  - Debounced (~1s) so typing doesn't spam the server.
 *  - Single-flight + latest-wins: never two saves at once; a change arriving
 *    mid-save is saved right after the current one, so the newest state wins.
 *  - Failure-resilient: on error the latest scene is kept in memory and retried
 *    with capped backoff — nothing is lost when a save fails or the network drops
 *    (offline). retryNow() forces an immediate attempt.
 *
 * Pure and timer-based (global setTimeout), so it is unit-testable with fake
 * timers and has no React or network dependency of its own.
 */

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export interface Scene {
  elements: readonly unknown[];
  appState: Record<string, unknown>;
}

export interface SceneSaverOptions {
  /** Persist a scene. Rejects on failure (network/server). */
  save: (scene: Scene) => Promise<void>;
  /** Version of the scene's elements (e.g. Excalidraw getSceneVersion). */
  versionOf: (elements: readonly unknown[]) => number;
  debounceMs?: number;
  /** Base backoff between retries; doubles each attempt up to 8x. */
  retryBaseMs?: number;
  onStatusChange?: (status: SaveStatus) => void;
}

export class SceneSaver {
  private readonly save: (scene: Scene) => Promise<void>;
  private readonly versionOf: (elements: readonly unknown[]) => number;
  private readonly debounceMs: number;
  private readonly retryBaseMs: number;
  private readonly onStatusChange?: (status: SaveStatus) => void;

  private latest: Scene | null = null;
  private savedVersion: number | null = null;
  private inFlight = false;
  private retryAttempt = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private _status: SaveStatus = "idle";

  constructor(opts: SceneSaverOptions) {
    this.save = opts.save;
    this.versionOf = opts.versionOf;
    this.debounceMs = opts.debounceMs ?? 1000;
    this.retryBaseMs = opts.retryBaseMs ?? 2000;
    this.onStatusChange = opts.onStatusChange;
  }

  get status(): SaveStatus {
    return this._status;
  }

  private setStatus(s: SaveStatus): void {
    if (this._status === s) return;
    this._status = s;
    this.onStatusChange?.(s);
  }

  /**
   * Seed the last-saved version without triggering a save — call this when a
   * board loads so its untouched initial scene isn't re-saved.
   */
  primeSaved(elements: readonly unknown[]): void {
    this.savedVersion = this.versionOf(elements);
    this.setStatus("saved");
  }

  /** Record a new scene from the editor and schedule a debounced save. */
  schedule(scene: Scene): void {
    if (this.disposed) return;
    this.latest = scene;
    const version = this.versionOf(scene.elements);
    // Nothing changed and we're not recovering from an error → ignore.
    if (version === this.savedVersion && this._status !== "error") return;

    this.setStatus("dirty");
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flush();
    }, this.debounceMs);
  }

  /** Force an immediate save attempt (e.g. manual retry after a failure). */
  retryNow(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    void this.flush();
  }

  /** Flush any pending change synchronously-ish (e.g. before switching boards). */
  flushNow(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    void this.flush();
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.debounceTimer = null;
    this.retryTimer = null;
  }

  private async flush(): Promise<void> {
    if (this.disposed || this.inFlight || !this.latest) return;

    const scene = this.latest;
    const version = this.versionOf(scene.elements);
    if (version === this.savedVersion && this._status !== "error") {
      this.setStatus("saved");
      return;
    }

    this.inFlight = true;
    this.setStatus("saving");
    try {
      await this.save(scene);
      this.inFlight = false;
      this.savedVersion = version;
      this.retryAttempt = 0;

      // Latest-wins: if the scene changed while we were saving, save again now.
      if (this.latest && this.versionOf(this.latest.elements) !== this.savedVersion) {
        this.setStatus("dirty");
        void this.flush();
      } else {
        this.setStatus("saved");
      }
    } catch {
      this.inFlight = false;
      this.setStatus("error");
      this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    if (this.disposed) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const factor = Math.min(2 ** this.retryAttempt, 8);
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, this.retryBaseMs * factor);
  }
}
