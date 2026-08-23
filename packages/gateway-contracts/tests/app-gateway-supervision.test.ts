import { describe, expect, it } from "vitest";
import {
  APP_GATEWAY_CONTROL_PROTOCOL_VERSION,
  APP_GATEWAY_SERVICE,
  AppGatewayRuntimeIdentitySchema,
} from "../src/app-gateway-supervision.js";

const identity = {
  protocolVersion: APP_GATEWAY_CONTROL_PROTOCOL_VERSION,
  service: APP_GATEWAY_SERVICE,
  instanceId: "app-gateway-01",
  version: "3.0.0-beta.1",
  pid: 42,
  startedAt: 1_700_000_000,
  port: 4_800,
  configurationRevision: `sha256:${"a".repeat(64)}`,
  lifecycle: "ready",
} as const;

describe("App Gateway supervision contract", () => {
  it("admits one portable, exact-revision runtime identity", () => {
    expect(AppGatewayRuntimeIdentitySchema.parse(identity)).toEqual(identity);
  });

  it.each([
    { ...identity, instanceId: "C:/operator/private/runtime" },
    { ...identity, configurationRevision: "sha256:not-a-digest" },
    { ...identity, lifecycle: "starting" },
    { ...identity, controlToken: "must-not-cross-the-wire" },
  ])("rejects malformed or secret-bearing identity evidence", (value) => {
    expect(() => AppGatewayRuntimeIdentitySchema.parse(value)).toThrow();
  });
});
