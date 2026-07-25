import { Component, type ReactNode } from "react";

// A crashed render (or a stale JS chunk after a redeploy) would otherwise blank
// the whole page. Chunk-load failures are common right after a deploy — the old
// page references hashed chunks that no longer exist — so we reload ONCE to pull
// the fresh build. Anything else shows a friendly retry instead of white screen.
const CHUNK_ERROR =
  /dynamically imported module|Loading chunk|module script failed|Failed to fetch|ChunkLoadError/i;
const RELOAD_AT_KEY = "pac.lastChunkReload";
const RELOAD_COOLDOWN_MS = 10_000;

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    if (CHUNK_ERROR.test(error.message)) {
      const last = Number(sessionStorage.getItem(RELOAD_AT_KEY) ?? 0);
      // Reload at most once per cooldown so we never get stuck in a loop.
      if (Date.now() - last > RELOAD_COOLDOWN_MS) {
        sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now()));
        window.location.reload();
      }
    }
  }

  private readonly reload = () => {
    sessionStorage.removeItem(RELOAD_AT_KEY);
    window.location.reload();
  };

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-full items-center justify-center bg-slate-50 p-6">
          <div className="max-w-sm rounded-2xl bg-white p-8 text-center shadow-sm">
            <p className="text-base font-semibold text-slate-800">Something went wrong</p>
            <p className="mt-2 text-sm text-slate-500">
              The app hit an unexpected error. Reloading usually fixes it.
            </p>
            {this.state.error.message && (
              <p className="mt-3 max-h-24 overflow-auto rounded-lg bg-slate-50 px-3 py-2 text-left font-mono text-[11px] leading-snug text-slate-400">
                {this.state.error.message}
              </p>
            )}
            <button
              onClick={this.reload}
              className="mt-5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-hover"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
