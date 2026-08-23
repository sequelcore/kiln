import { describe, expect, it, vi } from "vitest";
import {
  APP_GATEWAY_CONTROL_PROTOCOL_VERSION,
  APP_GATEWAY_SERVICE,
  type AppGatewayRuntimeIdentity,
} from "@kilnai/gateway-contracts";
import {
  createGatewayDrainController,
  handleAppGatewayControlRequest,
  inspectAppGatewayListener,
} from "../../src/gateway/app-gateway-control.js";

const identity: AppGatewayRuntimeIdentity = {
  protocolVersion: APP_GATEWAY_CONTROL_PROTOCOL_VERSION,
  service: APP_GATEWAY_SERVICE,
  instanceId: "instance-a",
  version: "3.0.0-test",
  pid: 42,
  startedAt: 1_700_000_000,
  port: 4_800,
  configurationRevision: `sha256:${"a".repeat(64)}`,
  lifecycle: "ready",
};

describe("App Gateway control", () => {
  it("admits health and shutdown only for authenticated loopback ownership", async () => {
    const requestShutdown = vi.fn();
    const health = handleAppGatewayControlRequest({
      request: new Request("http://127.0.0.1:4800/__kiln/control/app-gateway/health", {
        headers: { authorization: "Bearer secret" },
      }),
      requestAddress: "127.0.0.1",
      identity,
      controlToken: "secret",
      requestShutdown,
    });
    expect(health?.status).toBe(200);
    await expect(health?.json()).resolves.toEqual(identity);

    const rejected = handleAppGatewayControlRequest({
      request: new Request("http://127.0.0.1:4800/__kiln/control/app-gateway/shutdown", {
        method: "POST",
        headers: { authorization: "Bearer secret", "x-kiln-instance-id": "other" },
      }),
      requestAddress: "10.0.0.8",
      identity,
      controlToken: "secret",
      requestShutdown,
    });
    expect(rejected?.status).toBe(403);
    expect(requestShutdown).not.toHaveBeenCalled();
  });

  it("classifies exact revision drift as a foreign listener", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(identity), {
      status: 200,
      headers: { "content-type": "application/json", "x-kiln-service": APP_GATEWAY_SERVICE },
    }));
    await expect(inspectAppGatewayListener({
      port: 4_800,
      controlToken: "secret",
      expected: { ...identity, configurationRevision: `sha256:${"b".repeat(64)}` },
      fetch,
    })).resolves.toEqual({ state: "foreign", reason: "identity-mismatch" });
  });

  it("stops admission once, drains, then closes owned resources", async () => {
    const calls: string[] = [];
    const controller = createGatewayDrainController({
      server: { stop: vi.fn(async (force?: boolean) => { calls.push(`stop:${String(force)}`); }) },
      closeResources: async () => { calls.push("resources"); },
      wait: async () => undefined,
      timeoutMs: 1_000,
    });
    const first = controller.requestShutdown();
    const second = controller.requestShutdown();
    expect(controller.isDraining()).toBe(true);
    await Promise.all([first, second, controller.waitForShutdown()]);
    expect(calls).toEqual(["stop:false", "resources"]);
  });

  it("force-stops only after the graceful drain deadline", async () => {
    const calls: string[] = [];
    let releaseGraceful!: () => void;
    const graceful = new Promise<void>((resolve) => { releaseGraceful = resolve; });
    const controller = createGatewayDrainController({
      server: { stop: vi.fn(async (force?: boolean) => {
        calls.push(`stop:${String(force)}`);
        if (force === false) await graceful;
      }) },
      closeResources: async () => { calls.push("resources"); },
      wait: async () => { calls.push("deadline"); },
      timeoutMs: 1,
    });
    await controller.requestShutdown();
    releaseGraceful();
    expect(calls).toEqual(["stop:false", "deadline", "stop:true", "resources"]);
  });
});
