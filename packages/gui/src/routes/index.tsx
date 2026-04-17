import { createFileRoute } from "@tanstack/react-router";
import { useGatewayHealth } from "../lib/use-gateway-health.js";

export const Route = createFileRoute("/")({
  component: IndexComponent,
});

function IndexComponent() {
  const { data, isLoading, isError } = useGatewayHealth();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Kiln</h1>
      <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
        <span>Gateway</span>
        {isLoading && <span>checking...</span>}
        {isError && <span className="text-[var(--color-kiln-error)]">unreachable</span>}
        {data && (
          <span className="text-[var(--color-kiln-success)]">
            {data.status}
          </span>
        )}
      </div>
    </main>
  );
}
