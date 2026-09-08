import { describe, expect, it, vi } from "vitest";
import type { ProviderAdapter, ToolDefinition } from "@kilnai/core/agents";
import { textParts } from "@kilnai/core/engine";
import {
  RuntimeProviderTransportBudgetAuthority,
  RuntimeProviderTransportBudgetExceededError,
} from "../../src/session/provider-transport-admission.js";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import { createFixtureClaimConfig } from "./runtime-claim-fixture.js";
import { makeSession } from "./runtime-session-orchestrator-tools-test-fixture.js";

describe("RuntimeProviderTransportBudgetAuthority", () => {
  it("shares one hard physical-attempt fence across callers", () => {
    const authority = new RuntimeProviderTransportBudgetAuthority(2);

    authority.admit({ requestId: "parent:1" });
    authority.admit({ requestId: "child:1" });

    expect(authority.snapshot()).toEqual({ admitted: 2, limit: 2, remaining: 0 });
    expect(() => authority.admit({ requestId: "parent:retry" }))
      .toThrow(RuntimeProviderTransportBudgetExceededError);
    expect(authority.snapshot()).toEqual({ admitted: 2, limit: 2, remaining: 0 });
  });

  it("rejects non-positive or non-integral limits", () => {
    expect(() => new RuntimeProviderTransportBudgetAuthority(0)).toThrow("positive safe integer");
    expect(() => new RuntimeProviderTransportBudgetAuthority(1.5)).toThrow("positive safe integer");
  });
});

type FixtureProviderResponse = Awaited<ReturnType<ProviderAdapter["createMessage"]>>;

function response(overrides: Partial<FixtureProviderResponse> = {}): FixtureProviderResponse {
  return {
    parts: textParts("done"),
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    toolCalls: [],
    stopReason: "end_turn",
    ...overrides,
  };
}

function tool(name: string): ToolDefinition {
  return { name, description: name, inputSchema: {}, tags: new Set() };
}

describe("RuntimeSessionOrchestrator physical provider transport admission", () => {
  it("settles an exhausted physical request as an outer authority denial", async () => {
    let physicalCalls = 0;
    const provider: ProviderAdapter = {
      name: "fixture-provider",
      createMessage: vi.fn(async (request) => {
        request.transportAdmission?.admit(request.requestIdentity);
        physicalCalls += 1;
        return physicalCalls === 1
          ? response({
              parts: textParts("using the admitted tool"),
              toolCalls: [{ id: "tc-1", name: "get_data", input: {} }],
              stopReason: "tool_use",
            })
          : response();
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const session = makeSession();
    const perCallConfig = createFixtureClaimConfig({
      session,
      provider,
      model: "unknown",
      includeToolClaims: true,
      toolPermissions: [{ toolName: "get_data" }],
    });
    const toolExecution = vi.fn().mockResolvedValue("fixture result");
    const transport = new RuntimeProviderTransportBudgetAuthority(1);
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      model: "unknown",
      tools: [tool("get_data")],
      builtinTools: new Map([["get_data", toolExecution]]),
      providerTransportAdmission: transport,
    });

    const result = await orchestrator.processMessage(
      session,
      textParts("fetch data"),
      undefined,
      undefined,
      perCallConfig,
    );

    expect(physicalCalls).toBe(1);
    expect(provider.createMessage).toHaveBeenCalledTimes(2);
    expect(toolExecution).toHaveBeenCalledTimes(1);
    expect(transport.snapshot()).toEqual({ admitted: 1, limit: 1, remaining: 0 });
    expect(perCallConfig.runtimeModelRoundDispatch?.state?.outcome).toBe("not_dispatched");
    expect(result).toMatchObject({
      outcome: "failed",
      dispositionReason: "outer_authority_denied",
    });
    expect(result.providerRequests).toHaveLength(1);
    expect(orchestrator.providerRequestSnapshot()).toHaveLength(1);
  });
});
