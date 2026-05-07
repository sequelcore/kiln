import { describe, expect, it, vi } from "vitest";
import type { KilnAppConfig } from "../config.js";
import {
  buildOperatorIdentityContext,
  withGlobalIdentityContext,
} from "./operator-identity-context.js";

describe("operator identity context", () => {
  it("returns no context when global identity is missing or blank", () => {
    expect(buildOperatorIdentityContext(undefined)).toBeUndefined();
    expect(buildOperatorIdentityContext({ name: "  ", timezone: "\n" })).toBeUndefined();
  });

  it("formats admitted operator identity with provenance", () => {
    expect(buildOperatorIdentityContext({
      name: " Ricardo\nArmenta ",
      timezone: " America/Tijuana ",
    })).toBe([
      "## Operator Identity",
      "Source: ~/.kiln/config.yaml identity.",
      "- Operator name: Ricardo Armenta",
      "- Timezone: America/Tijuana",
    ].join("\n"));
  });

  it("appends identity to the configured system prompt builder", () => {
    const buildSystemPrompt = vi.fn().mockReturnValue("base prompt");
    const appConfig: KilnAppConfig = {
      createRegistry: vi.fn(),
      buildSystemPrompt,
    };

    const wrapped = withGlobalIdentityContext(appConfig, {
      version: "1",
      identity: {
        name: "Ricardo",
      },
    });

    expect(wrapped.buildSystemPrompt?.({
      task: "test",
      domain: {
        name: "default",
        displayName: "Default",
        toolTags: new Set<string>(),
        qualityGates: [],
        detectPatterns: [],
        multishotExamples: "",
        phaseExamples: "",
      },
      projectedContext: {
        blocks: [],
        estimatedTokens: 0,
      },
      projectPath: "C:/repo",
    })).toBe([
      "base prompt",
      "",
      "## Operator Identity",
      "Source: ~/.kiln/config.yaml identity.",
      "- Operator name: Ricardo",
    ].join("\n"));
    expect(buildSystemPrompt).toHaveBeenCalledOnce();
  });

  it("returns the original app config when there is no identity context", () => {
    const appConfig: KilnAppConfig = { createRegistry: vi.fn() };

    expect(withGlobalIdentityContext(appConfig, {
      version: "1",
      identity: {},
    })).toBe(appConfig);
  });
});
