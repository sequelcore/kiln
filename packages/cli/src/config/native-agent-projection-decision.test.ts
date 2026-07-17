import { describe, expect, it } from "vitest";
import type { KilnAgentDefinition } from "../application/agent-loader.js";
import {
  HARNESSES_WITH_NATIVE_PROJECTION,
  resolveHarnessRouteCapability,
} from "./harness-integration-capabilities.js";
import { decideNativeAgentProjection } from "./native-agent-projection-decision.js";

const portableAgent = {
  name: "coder",
  role: "Coding implementation specialist",
  goal: "Implement focused code changes",
  tier: "coding",
  scope: "project",
} satisfies KilnAgentDefinition;

function agentWithRoute(
  providerId: string,
  model?: string,
): KilnAgentDefinition {
  return {
    ...portableAgent,
    providerRoute: {
      providerId,
      ...(model ? { model } : {}),
    },
  };
}

describe("decideNativeAgentProjection", () => {
  it.each(HARNESSES_WITH_NATIVE_PROJECTION)(
    "projects a portable agent to %s without a native model",
    (harness) => {
      expect(decideNativeAgentProjection({ agent: portableAgent, harness })).toStrictEqual({
        kind: "project",
        harness,
      });
    },
  );

  it("projects a codex-oauth route to Codex using the raw model ID", () => {
    expect(decideNativeAgentProjection({
      agent: agentWithRoute("codex-oauth", "gpt-5.5"),
      harness: "codex",
    })).toStrictEqual({
      kind: "project",
      harness: "codex",
      nativeModel: "gpt-5.5",
    });
  });

  it("projects an opencode-go route to OpenCode using its provider-qualified model", () => {
    expect(decideNativeAgentProjection({
      agent: agentWithRoute("opencode-go", "deepseek-v4-flash"),
      harness: "opencode",
    })).toStrictEqual({
      kind: "project",
      harness: "opencode",
      nativeModel: "opencode-go/deepseek-v4-flash",
    });
  });

  it("uses the explicit opencode-zen capability mapping", () => {
    expect(decideNativeAgentProjection({
      agent: agentWithRoute("opencode-zen", "deepseek-v4-flash-free"),
      harness: "opencode",
    })).toStrictEqual({
      kind: "project",
      harness: "opencode",
      nativeModel: "opencode/deepseek-v4-flash-free",
    });
  });

  it("omits an explicit provider with no native or adapter capability", () => {
    expect(decideNativeAgentProjection({
      agent: agentWithRoute("unregistered-provider", "deepseek-v4-flash"),
      harness: "codex",
    })).toStrictEqual({
      kind: "omit",
      harness: "codex",
      reason: "unsupported-provider",
    });
  });

  it("omits an explicit route whose model is missing", () => {
    expect(decideNativeAgentProjection({
      agent: agentWithRoute("codex-oauth"),
      harness: "codex",
    })).toStrictEqual({
      kind: "omit",
      harness: "codex",
      reason: "unsupported-model",
    });
  });

  it.each([
    ["codex", "codex-oauth-preview"],
    ["opencode", "opencode-go-preview"],
  ] as const)(
    "does not guess support for the %s provider prefix %s",
    (harness, providerId) => {
      expect(decideNativeAgentProjection({
        agent: agentWithRoute(providerId, "deepseek-v4-flash"),
        harness,
      })).toStrictEqual({
        kind: "omit",
        harness,
        reason: "unsupported-provider",
      });
    },
  );

  it("distinguishes cross-harness adapter support from native projection support", () => {
    expect(resolveHarnessRouteCapability({
      harness: "codex",
      providerId: "opencode-go",
      model: "deepseek-v4-flash",
    })).toStrictEqual({
      kind: "adapter-supported",
      harness: "codex",
      providerId: "opencode-go",
      model: "deepseek-v4-flash",
      adapterId: "kiln-managed-invocation",
      reason: "cross-harness-managed-invocation",
    });
  });

  it("keeps adapter support separate from native agent projection", () => {
    expect(decideNativeAgentProjection({
      agent: agentWithRoute("opencode-go", "deepseek-v4-flash"),
      harness: "codex",
    })).toStrictEqual({
      kind: "omit",
      harness: "codex",
      reason: "adapter-required",
    });
  });
});
