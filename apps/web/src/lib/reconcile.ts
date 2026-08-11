/**
 * Element-level reconciliation for live whiteboard co-editing — the same rule
 * upstream Excalidraw uses: the higher `version` wins; ties break on the lower
 * `versionNonce`. This lets two people edit *different* elements simultaneously
 * with both edits surviving, and resolves edits to the *same* element
 * deterministically (last writer per element).
 *
 * Excalidraw 0.17 derives z-order from array order (no fractional index), so we
 * preserve the local order for existing elements and append genuinely-new remote
 * elements at the end — a stable order that avoids z-index thrash on every sync.
 */

export interface Versioned {
  id: string;
  version: number;
  versionNonce?: number;
}

/** True when `remote` should replace `local` for the same element id. */
export function remoteWins(local: Versioned, remote: Versioned): boolean {
  if (remote.version > local.version) return true;
  if (remote.version < local.version) return false;
  // Equal versions: deterministic tiebreak so all peers converge identically.
  return (remote.versionNonce ?? 0) < (local.versionNonce ?? 0);
}

export function reconcileElements<T extends Versioned>(local: readonly T[], remote: readonly T[]): T[] {
  const remoteById = new Map<string, T>();
  for (const el of remote) remoteById.set(el.id, el);

  const seen = new Set<string>();
  const result: T[] = [];

  // Keep local order; upgrade an element in place when the remote copy wins.
  for (const l of local) {
    const r = remoteById.get(l.id);
    result.push(r && remoteWins(l, r) ? r : l);
    seen.add(l.id);
  }
  // Append elements that only exist remotely, in their incoming order.
  for (const r of remote) {
    if (!seen.has(r.id)) {
      result.push(r);
      seen.add(r.id);
    }
  }
  return result;
}
