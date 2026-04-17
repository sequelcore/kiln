/**
 * Gateway fixture for Playwright e2e tests.
 *
 * FIXTURE PATH: Hono mock server (not the real startGuiGateway).
 *
 * Rationale: startGuiGateway (packages/runtime/src/gateway/gui-gateway.ts) requires
 * Bun.serve, a live EventBus, SessionRegistry, and a full operatorTransport wiring that
 * pulls in @kilnai/core and @kilnai/runtime at runtime — circular in a browser test
 * worker context and too heavy for a first harness pass.
 *
 * The mock responds to GET /health with the same shape the real gateway emits:
 *   { status: "ok", channel: "gui" }
 * and to GET /gui/api/dashboard with a minimal GuiDashboardSnapshot.
 *
 * The Vite dev server proxies /gui-api → http://localhost:4810 (hard-coded in
 * vite.config.ts). The mock therefore binds to port 4810 so the proxy route works
 * during e2e runs. A port-in-use error here means a real gateway is already running;
 * tests can run against that instance too.
 *
 * TODO (ADR-006 parity): replace with a lightweight in-process startGuiGateway call
 * once the gateway factory gains a headless/test mode that does not require Bun.serve.
 * Track under the ADR-006 parity checklist.
 */

import { createServer, type Server } from "node:http";
import { test as base } from "@playwright/test";

/** Port the Vite proxy forwards to — must match vite.config.ts proxy target. */
export const GATEWAY_MOCK_PORT = 4810;

interface GatewayFixture {
  /** HTTP port the mock gateway is listening on (always GATEWAY_MOCK_PORT). */
  gatewayPort: number;
}

function handleRequest(
  req: { url?: string },
  res: {
    writeHead: (code: number, headers: Record<string, string>) => void;
    end: (body: string) => void;
  },
): void {
  const url = req.url ?? "/";
  const json = (code: number, body: unknown) => {
    const payload = JSON.stringify(body);
    res.writeHead(code, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Content-Length": String(Buffer.byteLength(payload)),
    });
    res.end(payload);
  };

  if (url === "/health") {
    json(200, { status: "ok", channel: "gui" });
    return;
  }

  if (url === "/gui/api/dashboard") {
    json(200, {
      providers: [],
      sessions: [],
      telemetry: { status: "idle", dominantRegions: [], saturation: 0, entropy: 0 },
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
}

export const test = base.extend<GatewayFixture>({
  // eslint-disable-next-line no-empty-pattern
  gatewayPort: async ({}, use) => {
    const server: Server = createServer(
      handleRequest as Parameters<typeof createServer>[0],
    );

    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(GATEWAY_MOCK_PORT, "127.0.0.1", resolve);
    });

    await use(GATEWAY_MOCK_PORT);

    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  },
});

export { expect } from "@playwright/test";
