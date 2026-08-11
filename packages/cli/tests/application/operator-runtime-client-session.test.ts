import { describe, expect, it, vi } from "vitest";
import { createOperatorRuntimeClientSession } from "../../src/application/operator-runtime-client-session.js";

describe("createOperatorRuntimeClientSession", () => {
  it("renews once after an authenticated request is rejected", async () => {
    let sessionOpens = 0;
    let applicationRequests = 0;
    const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (new URL(String(url)).pathname.endsWith("/session")) {
        sessionOpens += 1;
        return Response.json({ credential: `v2.payload${sessionOpens}.signature`, expiresAt: 500 });
      }
      applicationRequests += 1;
      if (applicationRequests === 1) return new Response(null, { status: 401 });
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer v2.payload2.signature");
      return Response.json({ ok: true });
    });
    const client = createOperatorRuntimeClientSession({
      principal: { kind: "native-harness", harness: "claude" },
      supervisor: { ensure: async () => ({ state: "ready", identity: { port: 4820 } } as never) },
      readBridgeCredentials: async () => ({ schemaVersion: 1, controlToken: "control-token" }),
      resolveWorkspace: () => ({
        status: "resolved",
        canonicalRoot: "C:\\Projects\\kiln",
        projectRuntimeId: `krp_${"a".repeat(64)}`,
        markerDigest: `sha256:${"b".repeat(64)}`,
      }),
      fetch,
      createSessionId: () => "session-1",
      nowEpochSeconds: () => 100,
    });
    const response = await client.request("/.well-known/kiln/operator-runtime/mcp", { method: "POST" });
    expect(response.status).toBe(200);
    expect(sessionOpens).toBe(2);
  });

  it("opens one bound surface session and authenticates application requests", async () => {
    const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith("/session")) {
        return new Response(JSON.stringify({ credential: `v2.${"a".repeat(20)}.${"b".repeat(20)}`, expiresAt: 200 }));
      }
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toMatch(/^Bearer v2\./);
      expect(headers.get("x-kiln-principal-kind")).toBe("operator-surface");
      expect(headers.get("x-kiln-principal-id")).toBe("gui");
      return new Response(JSON.stringify({ schemaVersion: 1, status: "ok", result: null }));
    });
    const client = createOperatorRuntimeClientSession({
      principal: { kind: "operator-surface", surface: "gui" },
      supervisor: { ensure: async () => ({
        state: "ready" as const,
        identity: { port: 4820 } as never,
        lifecycle: "ready" as const,
        diagnostic: "none" as const,
        activeProjectRuntimeCount: 0,
      }) },
      readBridgeCredentials: async () => ({ controlToken: "control-token" }) as never,
      resolveWorkspace: () => ({
        status: "resolved" as const,
        canonicalRoot: "C:\\Projects\\kiln",
        projectRuntimeId: `krp_${"a".repeat(64)}`,
        markerDigest: `sha256:${"b".repeat(64)}`,
      }),
      fetch,
      createSessionId: () => "gui-session",
      nowEpochSeconds: () => 100,
    });

    const response = await client.request("/.well-known/kiln/operator-runtime/application", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toMatchObject({
      schemaVersion: 2,
      principal: { kind: "operator-surface", surface: "gui" },
    });
  });
});
