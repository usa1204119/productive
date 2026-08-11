// Reconciliation now lives in the shared package so the server merges on save
// with the exact same rule the client applies to live deltas. Re-exported here
// so existing imports (boardSync, tests) keep resolving.
export { reconcileElements, remoteWins, type Versioned } from "@plane-and-curves/shared";
