import { LogOut, Menu, UserRound } from "lucide-react";
import type { UserDto } from "@plane-and-curves/shared";
import { googleLink, useLogout } from "../lib/auth.js";
import { useCurrentWorkspace, type WorkspaceTab } from "../lib/currentWorkspace.js";

interface TopBarProps {
  user: UserDto;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

const TABS: { id: WorkspaceTab; label: string }[] = [
  { id: "whiteboard", label: "Whiteboard" },
  { id: "tasks", label: "To do tasks" },
  { id: "documents", label: "Documents" },
];

/** Slim top bar: sidebar toggle, identity, centered workspace tabs, and sign out. */
export function TopBar({ user, sidebarOpen, onToggleSidebar }: TopBarProps) {
  const logout = useLogout();
  const { current, tab, setTab } = useCurrentWorkspace();

  return (
    <header className="relative flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
      {current && (
        <div
          role="tablist"
          aria-label="Workspace sections"
          className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center rounded-xl border border-slate-200 bg-slate-100 p-0.5 md:inline-flex"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-3.5 py-1 text-sm font-medium transition ${
                tab === t.id
                  ? "bg-white text-accent shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          aria-pressed={sidebarOpen}
          title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="text-sm font-semibold tracking-tight text-slate-700">
          Swift Productive
        </span>
        {current && (
          <>
            <span className="text-slate-300">/</span>
            <span className="max-w-[14rem] truncate text-sm font-medium text-slate-600">
              {current.name}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-4">
        {user.isGuest && (
          <button
            onClick={googleLink}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent-hover"
          >
            Sign in with Google to save your work
          </button>
        )}

        <div className="flex items-center gap-2">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full" />
          ) : (
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100">
              <UserRound className="h-4 w-4 text-slate-500" />
            </span>
          )}
          <span className="max-w-[10rem] truncate text-sm text-slate-600">
            {user.isGuest ? "Guest" : user.name}
          </span>
        </div>

        <button
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 disabled:opacity-60"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
