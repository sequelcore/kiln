import { describe, expect, it, vi } from "vitest";
import type { ProviderAdapter, ToolDefinition } from "@kilnai/core/agents";
import { textParts } from "@kilnai/core/engine";
import { digestToolDefinition } from "@kilnai/core/tools";
import { createMaterializableRuntimeToolBinding } from "../../src/session/progressive-tool-admission.js";
import { deriveRuntimeConvergencePolicyInput } from "../../src/session/runtime-execution-envelope.js";
import {
  RuntimeSessionOrchestrator,
} from "../../src/session/runtime-session-orchestrator.js";
import {
  createFixtureClaimConfig,
  FIXTURE_READ_ONLY_EFFECT,
} from "./runtime-claim-fixture.js";
import { makeSession } from "./runtime-session-orchestrator-tools-test-fixture.js";
import { requireRuntimeConvergencePause } from "./runtime-terminal-fixture.js";

const LEGACY_CATALOG_SNAPSHOT_ID = `sha256:${"c".repeat(64)}` as const;

type ExhaustedCounter = "providerRequests" | "toolRounds";
type SafetyCondition = "cumulative_overflow" | "unknown_cumulative" | "unknown_projected";

interface DeferredDisclosureFixture {
  readonly provider: ProviderAdapter;
  readonly catalogSearch: ReturnType<typeof vi.fn>;
  readonly deferredExecutor: ReturnType<typeof vi.fn>;
  readonly orchestrator: RuntimeSessionOrchestrator;
  readonly session: ReturnType<typeof makeSession>;
}

function makeDeferredDisclosureFixture(
  exhaustedCounter: ExhaustedCounter,
  condition: SafetyCondition,
): DeferredDisclosureFixture {
  const session = makeSession();
  const catalogTool: ToolDefinition = {
    name: "tool_catalog_search",
    description: "Searches the tool catalog",
    inputSchema: {},
    tags: new Set(),
  };
  const deferredTool: ToolDefinition = {
    name: "browser_session_start",
    description: "Starts a browser session",
    inputSchema: { type: "object" },
    tags: new Set(["browser"]),
  };
  const deferredExecutor = vi.fn().mockResolvedValue({
    output: "browser-session-1",
    isError: false,
  });
  const binding = createMaterializableRuntimeToolBinding({
    definition: deferredTool,
    capability: {
      name: deferredTool.name,
      description: deferredTool.description,
      schema: deferredTool.inputSchema,
      tags: [...deferredTool.tags],
      effectEnvelope: FIXTURE_READ_ONLY_EFFECT,
    },
    executor: deferredExecutor,
    scopeIdentity: "runtime-test-deferred-disclosure-reserve-safety",
  });
  const provider: ProviderAdapter = {
    name: "mock",
    createMessage: vi.fn()
      .mockResolvedValueOnce({
        parts: textParts("finding the browser session tool"),
        inputTokens: condition === "cumulative_overflow"
          ? 1_000
          : condition === "unknown_cumulative"
            ? Number.NaN
            : 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls: [{
          id: "catalog-search-reserve-safety",
          name: catalogTool.name,
          input: { exact: deferredTool.name, includeSchemas: true },
        }],
        stopReason: "tool_use",
      })
      // A second response makes an accidental reserve dispatch observable via
      // the call-count assertion below without allowing the test to hang.
      .mockResolvedValue({
        parts: textParts("must not receive a disclosure request"),
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls: [],
        stopReason: "end_turn",
      }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
  const catalogSearch = vi.fn().mockImplementation(async () => {
    if (condition === "unknown_projected") {
      const cyclicSchema = catalogTool.inputSchema as Record<string, unknown>;
      cyclicSchema.self = cyclicSchema;
    }
    return {
      output: JSON.stringify({ tools: [deferredTool.name] }),
      isError: false,
      metadata: {
        toolName: catalogTool.name,
        kind: "catalog",
        operation: "search",
        exact: deferredTool.name,
        resultCount: 1,
        totalIndexed: 2,
        includedSchemas: true,
        stale: false,
        materializableToolName: deferredTool.name,
        catalogSnapshotId: LEGACY_CATALOG_SNAPSHOT_ID,
        materializableToolDefinitionDigest: digestToolDefinition(deferredTool),
      },
    };
  });
  const convergence = deriveRuntimeConvergencePolicyInput({
    policyId: `kiln.slice3.reserve-safety.${exhaustedCounter}.${condition}`,
    providerRequests: exhaustedCounter === "providerRequests" ? 1 : 2,
    toolRounds: exhaustedCounter === "toolRounds" ? 1 : 2,
    ...(condition === "cumulative_overflow" ? { cumulativeInputTokens: 1_000 } : {}),
  });
  const orchestrator = new RuntimeSessionOrchestrator({
    provider,
    model: "unknown",
    tools: [catalogTool],
    executionEnvelope: { convergence },
    materializableTools: new Map([[deferredTool.name, deferredTool]]),
    materializableToolBindings: new Map([[deferredTool.name, binding]]),
    toolCatalogSnapshotId: LEGACY_CATALOG_SNAPSHOT_ID,
    capabilityMap: new Map([[deferredTool.name, binding.capability]]),
    builtinTools: new Map([
      [catalogTool.name, catalogSearch],
      [deferredTool.name, deferredExecutor],
    ]),
  });
  return { provider, catalogSearch, deferredExecutor, orchestrator, session };
}

describe("RuntimeSessionOrchestrator - deferred-disclosure reserve safety", () => {
  it.each([
    ["provider request", "providerRequests" as const, "cumulative token overflow", "cumulative_overflow" as const, "cumulative_input_limit" as const, "cumulativeInputTokens" as const],
    ["provider request", "providerRequests" as const, "unknown cumulative input", "unknown_cumulative" as const, "observation_unavailable" as const, "cumulativeInputTokens" as const],
    ["provider request", "providerRequests" as const, "unknown projected input", "unknown_projected" as const, "observation_unavailable" as const, "projectedInputTokens" as const],
    ["tool round", "toolRounds" as const, "cumulative token overflow", "cumulative_overflow" as const, "cumulative_input_limit" as const, "cumulativeInputTokens" as const],
    ["tool round", "toolRounds" as const, "unknown cumulative input", "unknown_cumulative" as const, "observation_unavailable" as const, "cumulativeInputTokens" as const],
    ["tool round", "toolRounds" as const, "unknown projected input", "unknown_projected" as const, "observation_unavailable" as const, "projectedInputTokens" as const],
  ] as const)(
    "does not spend a disclosure request when an exhausted %s also has %s",
    async (_counterLabel, exhaustedCounter, _conditionLabel, condition, expectedReason, expectedMetric) => {
      const fixture = makeDeferredDisclosureFixture(exhaustedCounter, condition);

      const result = await fixture.orchestrator.processMessage(
        fixture.session,
        textParts("start a browser"),
        undefined,
        undefined,
        Object.freeze({
          ...createFixtureClaimConfig({
            session: fixture.session,
            provider: fixture.provider,
            model: "unknown",
            includeToolClaims: true,
            toolPermissions: [
              { toolName: "tool_catalog_search", effectEnvelope: FIXTURE_READ_ONLY_EFFECT },
              { toolName: "browser_session_start", effectEnvelope: FIXTURE_READ_ONLY_EFFECT },
            ],
          }),
          toolAllowlist: new Set(["tool_catalog_search", "browser_session_start"]),
        }),
      );

      expect(fixture.provider.createMessage).toHaveBeenCalledTimes(1);
      expect(fixture.catalogSearch).toHaveBeenCalledTimes(1);
      expect(fixture.deferredExecutor).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        outcome: "paused",
        dispositionReason: expectedReason,
      });
      expect(requireRuntimeConvergencePause(result).convergence.pause).toMatchObject({
        reason: expectedReason,
        metric: expectedMetric,
      });
    },
  );
});
