import { useCurrentUser } from "./lib/auth.js";
import { LoginCard } from "./components/LoginCard.js";
import { AppShell } from "./components/AppShell.js";

export function App() {
  const { data: user, isLoading } = useCurrentUser();

  if (isLoading) {
    return (
      <div className="flex min-h-full items-center justify-center text-sm text-slate-400">
        Loading…
      </div>
    );
  }

  return user ? <AppShell user={user} /> : <LoginCard />;
}
