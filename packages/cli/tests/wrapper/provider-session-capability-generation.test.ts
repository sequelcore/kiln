import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadConfiguredBuiltinToolSurfaceOptions,
  withProgressiveRuntimeToolProjection,
} from "../../src/config/builtin-tool-surface-config.js";
import { MODEL_FACING_DEFAULT_PERMISSION_POLICY } from "../../src/config/model-facing-permission-policy.js";
import type { KilnAppConfig } from "../../src/config.js";
import { ProviderSession } from "../../src/wrapper/provider-session.js";
import { compileNormalizedCapabilityJsonSchema } from "@kilnai/core/capabilities";
import { deriveAuthorityFromEffect, getBuiltinEffectEnvelope } from "@kilnai/core";
import { RuntimeSession } from "@kilnai/runtime";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("ProviderSession capability generation", () => {
  it("prepares verification capabilities only for an explicitly owned composition surface", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "kiln-capability-generation-"));
    roots.push(projectPath);
    const options = await loadConfiguredBuiltinToolSurfaceOptions(appConfig(), projectPath, {
      globalConfig: {
        version: "6",
        verification: {
          static: { quality: { typescript: ["test-integrity", "type-integrity", "complexity"] } },
        },
      },
      now: () => new Date("2026-08-30T10:00:00.000Z"),
    });
    const common = {
      provider: "openai" as const,
      model: "gpt-5",
      task: "verify the implementation",
      cwd: projectPath,
      permissionPolicy: MODEL_FACING_DEFAULT_PERMISSION_POLICY,
      builtinToolOptions: withProgressiveRuntimeToolProjection(options, "execute"),
    };
    const unowned = new ProviderSession(common);
    const owned = new ProviderSession({
      ...common,
      capabilityComposition: { appId: "cli-direct:openai", surfaceId: "cli-direct" },
    });

    try {
      expect(unowned.authorityCapabilityGeneration).toBeUndefined();
      expect(owned.config.builtinToolOptions?.capabilityContributions).toHaveLength(1);
      expect(owned.config.builtinToolOptions?.capabilityToolSchemas).toHaveLength(4);
      expect(owned.authorityBuiltinToolSurface.materializableTools.has("quality_analyze")).toBe(true);
      expect(owned.authorityBuiltinToolSurface.callBuiltinTools.has("quality_analyze")).toBe(true);
      expect(owned.authorityCapabilityGeneration).toMatchObject({
        evaluatedAt: "2026-08-30T10:00:00.000Z",
        scope: { appId: "cli-direct:openai", surfaceId: "cli-direct", caller: "kiln-runtime" },
        discoveryTools: [{ name: "capability.search" }, { name: "capability.describe" }],
        authorityCandidates: [{
          capabilityId: "verify.artifact-quality",
          toolName: "quality_analyze",
          materializationStatus: "materializable",
        }],
      });

      writeFileSync(join(projectPath, "quality.ts"), "export const value = input as unknown as User;\n", "utf8");
      const qualitySchema = options.capabilityToolSchemas.find((schema) => schema.toolName === "quality_analyze");
      const qualityExecutor = owned.authorityBuiltinToolSurface.callBuiltinTools.get("quality_analyze");
      const qualityEffect = getBuiltinEffectEnvelope("quality_analyze");
      expect(qualitySchema).toBeDefined();
      expect(qualityExecutor).toBeDefined();
      expect(qualityEffect).toBeDefined();
      const qualityResult = await qualityExecutor!(
        { file: "quality.ts" },
        {
          session: new RuntimeSession({
            sessionId: "capability-quality-session",
            appName: "kiln-cli",
            tenantId: "local",
            userId: "operator",
            systemPrompt: "test",
          }),
          toolCallScopeId: "capability-quality-scope",
          toolCall: { id: "capability-quality-call", name: "quality_analyze", input: { file: "quality.ts" } },
          sandbox: { cwd: projectPath },
          authority: deriveAuthorityFromEffect(qualityEffect!),
          resolvedEffect: qualityEffect!,
        },
      );
      const validator = compileNormalizedCapabilityJsonSchema(
        qualitySchema!.outputSchema,
        "output",
      );
      expect(validator.validate(qualityResult)).toBe(true);
      expect(qualityResult).toMatchObject({
        isError: false,
        metadata: {
          schema: "kiln.quality-analysis-observation/v1",
          kind: "static_quality_analysis",
          establishes: [],
        },
      });
    } finally {
      await Promise.all([unowned.dispose(), owned.dispose()]);
    }
  });
});

function appConfig(): KilnAppConfig {
  return {
    createRegistry: () => {
      throw new Error("createRegistry should not be used");
    },
    kilnYaml: { version: "1" },
  };
}
