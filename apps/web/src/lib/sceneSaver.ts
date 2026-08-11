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

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

export interface Scene {
  elements: readonly unknown[];
  appState: Record<string, unknown>;
  /** Excalidraw image binaries (data URLs) keyed by fileId. */
  files?: Record<string, unknown>;
}

export interface SceneSaverOptions {
  /** Persist a scene. Rejects on failure (network/server). */
  save: (
    scene: Scene,
    baseRevision: number,
    force: boolean,
  ) => Promise<void | { revision: number }>;
  /** Version of the scene's elements (e.g. Excalidraw getSceneVersion). */
  versionOf: (elements: readonly unknown[]) => number;
  debounceMs?: number;
  /** Base backoff between retries; doubles each attempt up to 8x. */
  retryBaseMs?: number;
  onStatusChange?: (status: SaveStatus) => void;
  isConflict?: (error: unknown) => boolean;
  onConflict?: (scene: Scene) => void;
}

export class SceneSaver {
  private readonly save: SceneSaverOptions["save"];
  private readonly versionOf: (elements: readonly unknown[]) => number;
  private readonly debounceMs: number;
  private readonly retryBaseMs: number;
  private readonly onStatusChange?: (status: SaveStatus) => void;
  private readonly isConflict: (error: unknown) => boolean;
  private readonly onConflict?: (scene: Scene) => void;

  private latest: Scene | null = null;
  private savedVersion: number | null = null;
  private inFlight = false;
  private activeSave: Promise<void> | null = null;
  private revision = 0;
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
    this.isConflict = opts.isConflict ?? (() => false);
    this.onConflict = opts.onConflict;
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
  primeSaved(elements: readonly unknown[], revision = 0): void {
    this.savedVersion = this.versionOf(elements);
    this.revision = revision;
    this.setStatus("saved");
  }

  /** Record a new scene from the editor and schedule a debounced save. */
  schedule(scene: Scene): void {
    if (this.disposed) return;
    this.latest = scene;
    if (this._status === "conflict") return;
    const version = this.versionOf(scene.elements);
    // Nothing changed and we're not recovering from an error → ignore.
    if (version === this.savedVersion && this._status !== "error") return;

    this.setStatus("dirty");
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.startFlush();
    }, this.debounceMs);
  }

  /** Force an immediate save attempt (e.g. manual retry after a failure). */
  retryNow(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    void this.startFlush();
  }

  /** Flush any pending change synchronously-ish (e.g. before switching boards). */
  async flushNow(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.activeSave) await this.activeSave;
    if (this._status === "dirty" || this._status === "error") await this.startFlush();
    if (this.activeSave) await this.activeSave;
  }

  overwriteNow(): Promise<void> {
    if (this._status !== "conflict") return Promise.resolve();
    this.setStatus("dirty");
    return this.startFlush(true);
  }

  acceptLatest(elements: readonly unknown[], revision: number): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.latest = null;
    this.savedVersion = this.versionOf(elements);
    this.revision = revision;
    this.retryAttempt = 0;
    this.setStatus("saved");
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.debounceTimer = null;
    this.retryTimer = null;
  }

  private startFlush(force = false): Promise<void> {
    if (this.disposed || !this.latest) return Promise.resolve();
    if (this.activeSave) return this.activeSave;
    const operation = this.flush(force);
    this.activeSave = operation;
    void operation.finally(() => {
      if (this.activeSave === operation) this.activeSave = null;
      if (!this.disposed && this._status === "dirty") void this.startFlush();
    });
    return operation;
  }

  private async flush(force = false): Promise<void> {
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
      const result = await this.save(scene, this.revision, force);
      this.inFlight = false;
      this.savedVersion = version;
      this.revision = result?.revision ?? this.revision + 1;
      this.retryAttempt = 0;

      // Latest-wins: if the scene changed while we were saving, save again now.
      if (this.latest && this.versionOf(this.latest.elements) !== this.savedVersion) {
        this.setStatus("dirty");
        // startFlush's completion handler immediately persists this latest version.
      } else {
        this.setStatus("saved");
      }
    } catch (error) {
      this.inFlight = false;
      if (this.isConflict(error)) {
        this.setStatus("conflict");
        this.onConflict?.(scene);
        return;
      }
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
      void this.startFlush();
    }, this.retryBaseMs * factor);
  }
}
