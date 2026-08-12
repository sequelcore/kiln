import { lazy, Suspense } from "react";
import { createRootRoute } from "@tanstack/react-router";
import { RoutedAppShell } from "../components/routed-app-shell.js";

const TanStackRouterDevtools = lazy(async () => {
  const module = await import("@tanstack/react-router-devtools");
  return { default: module.TanStackRouterDevtools };
});

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <>
      <RoutedAppShell />
      {import.meta.env.DEV ? (
        <Suspense fallback={null}>
          <TanStackRouterDevtools />
        </Suspense>
      ) : null}
    </>
  );
}
