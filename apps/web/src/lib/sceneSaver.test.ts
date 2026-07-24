import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SceneSaver, type Scene } from "./sceneSaver.js";

// Version = the `v` field of the first element, so tests control scene versions.
const versionOf = (els: readonly unknown[]) =>
  els.length ? ((els[0] as { v: number }).v ?? 0) : 0;
const sceneOf = (v: number): Scene => ({ elements: [{ v }], appState: {} });

/** A save() whose promises we resolve/reject by hand, to model slow/flaky saves. */
function controllableSave() {
  const calls: Scene[] = [];
  let pending: { resolve: () => void; reject: () => void } | null = null;
  const save = vi.fn((scene: Scene) => {
    calls.push(scene);
    return new Promise<void>((resolve, reject) => {
      pending = { resolve: () => resolve(), reject: () => reject(new Error("offline")) };
    });
  });
  return {
    save,
    calls,
    resolveLast: async () => {
      pending!.resolve();
      await vi.advanceTimersByTimeAsync(0);
    },
    rejectLast: async () => {
      pending!.reject();
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("SceneSaver", () => {
  it("saves the latest scene once, after the debounce", async () => {
    const c = controllableSave();
    const saver = new SceneSaver({ save: c.save, versionOf, debounceMs: 1000 });

    saver.schedule(sceneOf(1));
    expect(c.save).not.toHaveBeenCalled(); // still debouncing
    await vi.advanceTimersByTimeAsync(1000);
    await c.resolveLast();

    expect(c.save).toHaveBeenCalledTimes(1);
    expect(versionOf(c.calls[0]!.elements)).toBe(1);
    expect(saver.status).toBe("saved");
  });

  it("does not save again when the scene version is unchanged", async () => {
    const c = controllableSave();
    const saver = new SceneSaver({ save: c.save, versionOf, debounceMs: 1000 });

    saver.schedule(sceneOf(1));
    await vi.advanceTimersByTimeAsync(1000);
    await c.resolveLast();
    expect(c.save).toHaveBeenCalledTimes(1);

    saver.schedule(sceneOf(1)); // identical version
    await vi.advanceTimersByTimeAsync(2000);
    expect(c.save).toHaveBeenCalledTimes(1); // no second write
    expect(saver.status).toBe("saved");
  });

  it("latest-wins: a change during an in-flight save is saved right after", async () => {
    const c = controllableSave();
    const saver = new SceneSaver({ save: c.save, versionOf, debounceMs: 1000 });

    saver.schedule(sceneOf(1));
    await vi.advanceTimersByTimeAsync(1000); // save #1 (v1) starts, stays in-flight
    expect(saver.status).toBe("saving");

    saver.schedule(sceneOf(2)); // newer change arrives mid-save
    await c.resolveLast(); // finish save #1 → triggers save #2 with v2

    expect(c.save).toHaveBeenCalledTimes(2);
    expect(versionOf(c.calls[1]!.elements)).toBe(2);
    await c.resolveLast();
    expect(saver.status).toBe("saved");
  });

  it("never runs two saves concurrently", async () => {
    const c = controllableSave();
    const saver = new SceneSaver({ save: c.save, versionOf, debounceMs: 500 });

    saver.schedule(sceneOf(1));
    await vi.advanceTimersByTimeAsync(500); // save #1 in-flight
    saver.schedule(sceneOf(2));
    await vi.advanceTimersByTimeAsync(500); // debounce fires but a save is in-flight
    expect(c.save).toHaveBeenCalledTimes(1); // still only one in flight
  });

  it("offline: keeps the latest scene, retries, and recovers", async () => {
    const c = controllableSave();
    const saver = new SceneSaver({ save: c.save, versionOf, debounceMs: 1000, retryBaseMs: 2000 });

    saver.schedule(sceneOf(1));
    await vi.advanceTimersByTimeAsync(1000); // attempt #1
    await c.rejectLast(); // offline
    expect(saver.status).toBe("error");
    expect(c.save).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000); // backoff retry → attempt #2
    await c.resolveLast(); // back online
    expect(c.save).toHaveBeenCalledTimes(2);
    expect(versionOf(c.calls[1]!.elements)).toBe(1); // latest preserved, not lost
    expect(saver.status).toBe("saved");
  });

  it("offline then a newer edit: retry saves the NEWEST scene", async () => {
    const c = controllableSave();
    const saver = new SceneSaver({ save: c.save, versionOf, debounceMs: 1000, retryBaseMs: 2000 });

    saver.schedule(sceneOf(1));
    await vi.advanceTimersByTimeAsync(1000);
    await c.rejectLast(); // attempt #1 fails
    expect(saver.status).toBe("error");

    saver.schedule(sceneOf(2)); // user keeps editing while offline
    saver.retryNow(); // now online / manual retry
    await c.resolveLast();

    expect(versionOf(c.calls.at(-1)!.elements)).toBe(2);
    expect(saver.status).toBe("saved");
  });

  it("primeSaved suppresses a redundant save of the untouched initial scene", async () => {
    const c = controllableSave();
    const saver = new SceneSaver({ save: c.save, versionOf, debounceMs: 1000 });

    saver.primeSaved(sceneOf(7).elements); // board loaded at version 7
    saver.schedule(sceneOf(7)); // editor's initial onChange echoes the same scene
    await vi.advanceTimersByTimeAsync(2000);
    expect(c.save).not.toHaveBeenCalled();
  });
});
