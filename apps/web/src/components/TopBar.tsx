import { LogOut, Menu, Share2, UserRound } from "lucide-react";
import { useState } from "react";
import type { UserDto } from "@plane-and-curves/shared";
import { googleLink, useLogout } from "../lib/auth.js";
import { useCurrentWorkspace, type WorkspaceTab } from "../lib/currentWorkspace.js";
import { ShareWorkspaceDialog } from "./sharing/ShareWorkspaceDialog.js";
import { useWorkspaceCollaboration } from "../lib/collaboration.js";
import { PresenceAvatars } from "./collaboration/PresenceAvatars.js";

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
  const [shareOpen, setShareOpen] = useState(false);
  const presence = useWorkspaceCollaboration(current?.id, tab);

  return (
    <header className="relative z-40 flex min-h-[3.25rem] flex-wrap items-center justify-between border-b border-slate-200 bg-white px-3 py-2 sm:px-4">
      {current && (
        <div
          role="tablist"
          aria-label="Workspace sections"
          className="order-3 mt-2 flex w-full items-center overflow-x-auto rounded-xl border border-slate-200 bg-slate-100 p-0.5 md:absolute md:left-1/2 md:top-1/2 md:mt-0 md:w-auto md:-translate-x-1/2 md:-translate-y-1/2"
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
        <span className="hidden text-sm font-semibold tracking-tight text-slate-700 sm:inline">
          Swift Productive
        </span>
        {current && (
          <>
            <span className="hidden text-slate-300 sm:inline">/</span>
            <span className="max-w-[9rem] truncate text-sm font-medium text-slate-600 sm:max-w-[14rem]">
              {current.name}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        <PresenceAvatars entries={presence} />
        {current?.isOwner && !user.isGuest && (
          <button type="button" onClick={() => setShareOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            <Share2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Share</span>
          </button>
        )}
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
          <span className="hidden max-w-[10rem] truncate text-sm text-slate-600 lg:inline">
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
      {shareOpen && current && <ShareWorkspaceDialog workspace={current} onClose={() => setShareOpen(false)} />}
    </header>
  );
}
