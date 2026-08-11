import { useCurrentUser } from "./lib/auth.js";
import { LoginCard } from "./components/LoginCard.js";
import { AppShell } from "./components/AppShell.js";
import { InviteLandingPage } from "./pages/InviteLandingPage.js";

export function App() {
  const { data: user, isLoading } = useCurrentUser();
  const inviteMatch = window.location.pathname.match(/^\/invite\/([^/]+)$/);

  if (isLoading) {
    return (
      <div className="flex min-h-full items-center justify-center text-sm text-slate-400">
        Loading…
      </div>
    );
  }

  if (inviteMatch?.[1]) return <InviteLandingPage token={decodeURIComponent(inviteMatch[1])} user={user ?? null} />;

  if (user) {
    const inviteReturn = sessionStorage.getItem("pac.inviteReturn");
    if (inviteReturn?.startsWith("/invite/")) {
      sessionStorage.removeItem("pac.inviteReturn");
      window.location.replace(inviteReturn);
      return null;
    }
  }
  return user ? <AppShell user={user} /> : <LoginCard />;
}
