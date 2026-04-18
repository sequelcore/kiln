import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "../components/app-shell.js";

export const Route = createFileRoute("/")({
  component: IndexComponent,
});

function IndexComponent() {
  return <AppShell />;
}
