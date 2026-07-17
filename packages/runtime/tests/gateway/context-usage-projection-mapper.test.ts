import { describe, expect, it } from "vitest";
import {
  restoreGatewayContextUsageProjection,
  toGatewayContextUsageProjection,
} from "../../src/gateway/context-usage-projection-mapper.js";

const authoritative = {
  state: "authoritative" as const,
  usedTokens: 12_000,
  contextWindowTokens: 128_000,
  remainingTokens: 116_000,
  usedPercentage: 9.375,
  providerId: "codex-oauth",
  modelId: "gpt-5.6-terra",
  turnId: "turn-1",
  observedAt: "2026-07-13T00:00:00.000Z",
  measurement: "provider_reported" as const,
  lifecycle: "completed" as const,
  contextWindowAuthority: "provider_reported" as const,
  freshness: "fresh" as const,
};

describe("context-usage Gateway mapping", () => {
  it("conforms a canonical runtime projection to the standalone Gateway wire contract", () => {
    expect(toGatewayContextUsageProjection(authoritative)).toEqual(authoritative);
  });

  it("marks persisted evidence historical without changing its state or ratio", () => {
    expect(restoreGatewayContextUsageProjection(authoritative)).toEqual({
      ...authoritative,
      lifecycle: "restored",
      freshness: "historical",
    });
  });

  it("fails closed for malformed persisted evidence", () => {
    expect(restoreGatewayContextUsageProjection({ ...authoritative, usedPercentage: 101 })).toBeNull();
  });
});
