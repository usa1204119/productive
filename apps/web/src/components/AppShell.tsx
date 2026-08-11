import { useState } from "react";
import type { UserDto } from "@plane-and-curves/shared";
import { CurrentWorkspaceProvider, useCurrentWorkspace } from "../lib/currentWorkspace.js";
import { Sidebar } from "./Sidebar.js";
import { TopBar } from "./TopBar.js";
import { WorkspaceView } from "./WorkspaceView.js";

/** Authenticated layout: top bar, workspace sidebar, and the main tab area. */
export function AppShell({ user }: { user: UserDto }) {
  // Sidebar open/closed, remembered across reloads and toggled by the hamburger.
  const [sidebarOpen, setSidebarOpen] = useState(
    () => window.innerWidth >= 768 && localStorage.getItem("pac.sidebar") !== "closed",
  );
  const toggleSidebar = () =>
    setSidebarOpen((open) => {
      const next = !open;
      localStorage.setItem("pac.sidebar", next ? "open" : "closed");
      return next;
    });

  return (
    <CurrentWorkspaceProvider>
      <div className="flex h-full flex-col">
        <TopBar user={user} sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
        <div className="flex min-h-0 flex-1">
          {sidebarOpen && (
            <>
              <button type="button" aria-label="Close sidebar" onClick={toggleSidebar} className="fixed inset-0 z-30 bg-slate-900/25 md:hidden" />
              <div className="fixed inset-y-0 left-0 top-[3.25rem] z-40 md:static md:z-auto"><Sidebar /></div>
            </>
          )}
          <main className="min-w-0 flex-1 bg-slate-50">
            <MainArea user={user} />
          </main>
        </div>
      </div>
    </CurrentWorkspaceProvider>
  );
}

function MainArea({ user }: { user: UserDto }) {
  const { current, isLoading } = useCurrentWorkspace();

  if (isLoading) {
    return <Centered>Loading workspaces…</Centered>;
  }
  if (!current) {
    return <Centered>Create a workspace to get started.</Centered>;
  }
  return <WorkspaceView workspace={current} user={user} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">{children}</div>
  );
}
