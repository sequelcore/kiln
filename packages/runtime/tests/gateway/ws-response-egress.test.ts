import { describe, expect, it, vi } from "vitest";
import type { WSContext } from "hono/ws";
import { textParts } from "@kilnai/core/engine";
import { createWsResponseEgress } from "../../src/gateway/ws-routes.js";
import type { GatewayAuthorityAdmissionCommit, GatewayAuthorityAdmissionPort } from "../../src/gateway/gateway-authority-admission.js";
import { SessionRegistry } from "../../src/session/persistence/session-registry.js";
import { makeGatewayTestAdmission } from "./gateway-test-admission.js";

async function admittedResponseEgress(input: {
  readonly idempotencyKey: string;
  readonly ws: WSContext;
}): Promise<{
  readonly egress: ReturnType<typeof createWsResponseEgress>;
  readonly admission: GatewayAuthorityAdmissionPort;
  readonly commit: GatewayAuthorityAdmissionCommit;
}> {
  const sessionRegistry = new SessionRegistry();
  const session = await sessionRegistry.getOrCreate({
    appName: "ws-test",
    tenantId: "tenant-test",
    userId: "user-test",
    sessionId: "session-test",
    systemPrompt: "",
  });
  const admission = makeGatewayTestAdmission(sessionRegistry);
  let commit: GatewayAuthorityAdmissionCommit | undefined;

  await admission.execute({
    ingressId: input.idempotencyKey,
    appName: session.appName,
    tenantId: session.tenantId,
    userId: session.userId,
    sessionId: session.id,
    channel: "web",
    userParts: textParts("hello"),
  }, async (admitted) => {
    commit = admitted;
  });

  if (!commit) throw new Error("Test admission did not produce a commit.");
  return {
    admission,
    commit,
    egress: createWsResponseEgress({
      gatewayAdmission: admission,
      admitted: commit,
      appName: session.appName,
      tenantId: session.tenantId,
      userId: session.userId,
      idempotencyKey: input.idempotencyKey,
      ws: input.ws,
    }),
  };
}

describe("createWsResponseEgress", () => {
  it("allows only one concurrent assistant delivery for one idempotency slot", async () => {
    const ws = { readyState: 1, send: vi.fn() } as unknown as WSContext;
    const { egress } = await admittedResponseEgress({ idempotencyKey: "message-concurrent", ws });

    const outcomes = await Promise.all([
      egress({ slot: "assistant", frame: { type: "done", content: "first" } }),
      egress({ slot: "assistant", frame: { type: "done", content: "duplicate" } }),
    ]);

    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(ws.send).toHaveBeenCalledOnce();
  });

  it("settles a transport exception as unknown and never retries the send", async () => {
    const send = vi.fn(() => {
      throw new Error("transport response lost");
    });
    const ws = { readyState: 1, send } as unknown as WSContext;
    const { egress } = await admittedResponseEgress({ idempotencyKey: "message-transport-unknown", ws });

    expect(await egress({ slot: "assistant", frame: { type: "done", content: "ambiguous" } })).toBe(false);
    expect(await egress({ slot: "assistant", frame: { type: "done", content: "retry" } })).toBe(false);
    expect(send).toHaveBeenCalledOnce();
  });

  it("treats a disconnected socket as unknown and does not redispatch after reconnect", async () => {
    const ws = { readyState: 3, send: vi.fn() } as unknown as WSContext & { readyState: number };
    const { egress } = await admittedResponseEgress({ idempotencyKey: "message-disconnected", ws });

    expect(await egress({ slot: "error", frame: { type: "error", message: "not delivered" } })).toBe(false);
    ws.readyState = 1;
    expect(await egress({ slot: "error", frame: { type: "error", message: "retry" } })).toBe(false);
    expect(ws.send).not.toHaveBeenCalled();
  });
});
