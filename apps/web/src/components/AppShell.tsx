import type { UserDto } from "@plane-and-curves/shared";
import { CurrentWorkspaceProvider, useCurrentWorkspace } from "../lib/currentWorkspace.js";
import { Sidebar } from "./Sidebar.js";
import { TopBar } from "./TopBar.js";
import { WorkspaceView } from "./WorkspaceView.js";

/** Authenticated layout: top bar, workspace sidebar, and the main tab area. */
export function AppShell({ user }: { user: UserDto }) {
  return (
    <CurrentWorkspaceProvider>
      <div className="flex h-full flex-col">
        <TopBar user={user} />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="min-w-0 flex-1 bg-slate-50">
            <MainArea />
          </main>
        </div>
      </div>
    </CurrentWorkspaceProvider>
  );
}

function MainArea() {
  const { current, isLoading } = useCurrentWorkspace();

  if (isLoading) {
    return <Centered>Loading workspaces…</Centered>;
  }
  if (!current) {
    return <Centered>Create a workspace to get started.</Centered>;
  }
  return <WorkspaceView workspace={current} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">{children}</div>
  );
}
