import { lazy, Suspense } from "react";
import { createRootRoute, Outlet } from "@tanstack/react-router";

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
      <Outlet />
      {import.meta.env.DEV ? (
        <Suspense fallback={null}>
          <TanStackRouterDevtools />
        </Suspense>
      ) : null}
    </>
  );
}
