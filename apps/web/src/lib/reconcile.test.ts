import { describe, expect, it } from "vitest";
import { reconcileElements, remoteWins, type Versioned } from "./reconcile.js";

const el = (id: string, version: number, versionNonce = 0): Versioned & { id: string } => ({
  id,
  version,
  versionNonce,
});

describe("remoteWins", () => {
  it("higher remote version wins", () => {
    expect(remoteWins(el("a", 1), el("a", 2))).toBe(true);
    expect(remoteWins(el("a", 3), el("a", 2))).toBe(false);
  });
  it("equal versions break the tie on the lower versionNonce", () => {
    expect(remoteWins(el("a", 5, 100), el("a", 5, 50))).toBe(true);
    expect(remoteWins(el("a", 5, 50), el("a", 5, 100))).toBe(false);
  });
});

describe("reconcileElements", () => {
  it("keeps local elements the remote does not mention", () => {
    const local = [el("a", 1), el("b", 1)];
    const remote = [el("a", 2)];
    const merged = reconcileElements(local, remote);
    expect(merged.map((e) => e.id)).toEqual(["a", "b"]);
    expect(merged.find((e) => e.id === "a")!.version).toBe(2); // remote upgrade
    expect(merged.find((e) => e.id === "b")!.version).toBe(1); // local preserved
  });

  it("does not downgrade a local element that is newer than remote", () => {
    const local = [el("a", 9)];
    const remote = [el("a", 4)];
    expect(reconcileElements(local, remote)[0]!.version).toBe(9);
  });

  it("appends genuinely-new remote elements after local, preserving order", () => {
    const local = [el("a", 1), el("b", 1)];
    const remote = [el("c", 1), el("d", 1)];
    expect(reconcileElements(local, remote).map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("is convergent: applying the same remote twice is idempotent", () => {
    const local = [el("a", 1)];
    const remote = [el("a", 2)];
    const once = reconcileElements(local, remote);
    const twice = reconcileElements(once, remote);
    expect(twice).toEqual(once);
  });

  it("carries through unknown element fields (passthrough shape)", () => {
    const local = [{ id: "a", version: 1, versionNonce: 0, x: 1 }];
    const remote = [{ id: "a", version: 2, versionNonce: 0, x: 99, extra: "kept" }];
    const merged = reconcileElements(local as never, remote as never);
    expect(merged[0]).toMatchObject({ x: 99, extra: "kept" });
  });
});
