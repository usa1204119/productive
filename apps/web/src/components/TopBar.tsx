import { LogOut, UserRound } from "lucide-react";
import type { UserDto } from "@plane-and-curves/shared";
import { googleLink, useLogout } from "../lib/auth.js";

/** Slim top bar: identity, guest-conversion prompt, and sign out. */
export function TopBar({ user }: { user: UserDto }) {
  const logout = useLogout();

  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
      <span className="text-sm font-semibold tracking-tight text-slate-700">Plane and Curves</span>

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
