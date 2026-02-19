import { join } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { createBunWebSocket } from "hono/bun";
import { registerApiRoutes } from "./routes/api.js";
import { registerWsRoutes } from "./routes/ws.js";
import { SessionState } from "./session-state.js";
import type { KilnAppConfig } from "../config.js";

export interface ServerConfig {
  readonly port: number;
  readonly open: boolean;
}

export function createApp(sessionState: SessionState): {
  app: Hono;
  websocket: ReturnType<typeof createBunWebSocket>["websocket"];
} {
  const app = new Hono();
  const { upgradeWebSocket, websocket } = createBunWebSocket();

  registerApiRoutes(app, sessionState);
  registerWsRoutes(app, sessionState, upgradeWebSocket);

  // Static SPA files -- resolve from CLI dist directory
  // Use import.meta.dir (Bun) + join for cross-platform path resolution
  const consolePath = join(import.meta.dir, "..", "..", "dist", "console");
  app.use("/assets/*", serveStatic({ root: consolePath }));
  app.get("/*", serveStatic({ root: consolePath, path: "index.html" }));

  return { app, websocket };
}

export async function startServer(
  config: ServerConfig = { port: 4800, open: true },
  appConfig?: KilnAppConfig,
): Promise<void> {
  const sessionState = new SessionState(appConfig);
  const { app, websocket } = createApp(sessionState);

  const appName = appConfig?.appName ?? "kiln";
  const version = appConfig?.version ?? "0.1.0";

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      port: config.port,
      fetch: app.fetch,
      websocket,
    });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "EADDRINUSE") {
      const appLabel = appName.charAt(0).toUpperCase() + appName.slice(1);
      console.error(`Error: Port ${config.port} is already in use. Is another ${appLabel} instance running?`);
      console.error(`Try: ${appName} --port ${config.port + 1}`);
      process.exit(1);
    }
    throw err;
  }

  const appLabel = appName.charAt(0).toUpperCase() + appName.slice(1);
  console.log(`${appLabel} v${version} running on http://localhost:${config.port}`);
  console.log("Press Ctrl+C to stop\n");

  if (config.open) {
    const cmd =
      process.platform === "win32"
        ? "start"
        : process.platform === "darwin"
          ? "open"
          : "xdg-open";
    try {
      Bun.spawn(
        cmd === "start"
          ? ["cmd", "/c", "start", `http://localhost:${config.port}`]
          : [cmd, `http://localhost:${config.port}`],
        { stdio: ["ignore", "ignore", "ignore"] },
      );
    } catch {
      /* browser open is best-effort */
    }
  }

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      console.log("\nShutting down...");
      server.stop(true);
      resolve();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

export { SessionState } from "./session-state.js";
export type { StateSnapshot, WsMessage, SessionFlags } from "./session-state.js";
