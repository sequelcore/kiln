import { Link, Outlet } from "@tanstack/react-router";
import { useKilnSocket } from "../hooks/useKilnSocket";
import { Badge } from "@/components/ui/badge";

export function RootLayout() {
  const { connected } = useKilnSocket();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-8">
          <h1 className="text-lg font-semibold tracking-tight">Kiln</h1>
          <nav className="flex gap-1">
            <Link
              to="/dashboard"
              className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              activeProps={{ className: "text-foreground bg-secondary" }}
            >
              Dashboard
            </Link>
            <Link
              to="/memory"
              className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              activeProps={{ className: "text-foreground bg-secondary" }}
            >
              Memory
            </Link>
            <Link
              to="/settings"
              className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              activeProps={{ className: "text-foreground bg-secondary" }}
            >
              Settings
            </Link>
          </nav>
        </div>
        <Badge variant={connected ? "secondary" : "destructive"} className="text-xs gap-1.5">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-red-400"}`}
          />
          {connected ? "Connected" : "Disconnected"}
        </Badge>
      </header>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
