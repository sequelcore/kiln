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
import { TranscriptStore } from "../../src/wrapper/session-store.js";
import { TranscriptAuthorityAdmissionEvidenceStore } from "../../src/application/authority-admission-evidence-store.js";
import { ProviderSession } from "../../src/wrapper/provider-session.js";
import { compileNormalizedCapabilityJsonSchema } from "@kilnai/core/capabilities";
import { defineExecutionTargetCatalog } from "@kilnai/core/agents";
import { deriveAuthorityFromEffect } from "@kilnai/core/engine";
import { getBuiltinEffectEnvelope } from "@kilnai/core/tools";
import {
  defineEffectiveAuthorityAdmissionBundle,
  defineOperatorAuthorityAdmissionFacets,
  projectToolPermissionAdmissionFromPerCallConfig,
  RuntimeManagedAgentInvocationService,
  RuntimeSession,
  type AgentTaskVisionAnalysisCapabilityBinding,
  type ManagedInvocationToolAttachment,
  type ManagedInvocationToolRoute,
} from "@kilnai/runtime";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("ProviderSession capability generation", () => {
  it("persists audited edit and patch admission while excluding higher-authority write and shell tools", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "kiln-capability-approval-"));
    roots.push(projectPath);
    const session = new ProviderSession({ provider: "openai", model: "gpt-5", task: "edit a bounded fixture",
      cwd: projectPath, executionMode: "kiln-executable", requestedAuthority: "audited",
      permissionPolicy: { ...MODEL_FACING_DEFAULT_PERMISSION_POLICY, sandbox: "workspace-write" } });
    try {
      const config = session.buildAuthorityPerCallConfig({ requestedAuthority: "audited", workingDirectory: projectPath });
      const admission = projectToolPermissionAdmissionFromPerCallConfig({
        candidateToolNames: [...new Set([...session.authorityBuiltinToolSurface.materializableTools.keys(), ...(config.additionalTools ?? []).map((tool) => tool.name)])], config,
      });
      expect(admission.allowedToolPermissions.map((entry) => entry.toolName)).toEqual(expect.arrayContaining(["edit", "patch"]));
      expect(config.toolAllowlist?.has("write")).toBe(false);
      expect(config.toolAllowlist?.has("bash")).toBe(false);
      const authority = config.effectiveTurnAuthority;
      if (!authority) throw new Error("Missing audited turn authority");
      const revision = { revisionSetId: "test-r1", revisions: { global: "g1" } };
      const facets = defineOperatorAuthorityAdmissionFacets({
        executionId: "audited-turn", turnId: "audited-turn",
        session: new RuntimeSession({ sessionId: "audited-session", appName: "test", tenantId: "test", userId: "operator", systemPrompt: "test" }),
        snapshot: { catalog: defineExecutionTargetCatalog({ accounts: [], accountPolicies: [], targets: [] }), configurationRevision: revision },
        perCallConfig: config, candidateToolNames: [...new Set([...session.authorityBuiltinToolSurface.materializableTools.keys(), ...(config.additionalTools ?? []).map((tool) => tool.name)])],
        skillCatalog: { catalogId: "test", revision: "s1", skillIds: [] },
        authorityCeiling: { maximumAuthority: "audited", reason: "test policy" },
        operatorAdoption: { status: "not-required" }, capabilityParticipation: { status: "not-requested" },
      });
      const bundle = defineEffectiveAuthorityAdmissionBundle({
        sessionId: facets.sessionId, turnId: facets.turnId, admittedAt: "2026-09-05T00:00:00.000Z",
        configuration: { sessionRevision: revision, turnRevision: revision }, session: facets.session,
        turn: { ...facets.turn, budget: { status: "not-configured" }, execution: { status: "not-routed" } },
      });
      const transcripts = new TranscriptStore({ sessionsPath: join(projectPath, "sessions") });
      await new TranscriptAuthorityAdmissionEvidenceStore(transcripts).persist(bundle);
      expect(await transcripts.readAuthorityAdmissions("audited-session")).toHaveLength(1);
      const readOnly = session.buildAuthorityPerCallConfig({ requestedAuthority: "read_only", workingDirectory: projectPath });
      expect(readOnly.toolAllowlist?.has("write")).toBe(false);
    } finally { await session.dispose(); }
  });

  it("prepares verification capabilities only for an explicitly owned composition surface", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "kiln-capability-generation-"));
    roots.push(projectPath);
    const options = await loadConfiguredBuiltinToolSurfaceOptions(appConfig(), projectPath, {
      globalConfig: {
        version: "7",
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

  it("materializes one configured managed vision specialist as an agent-backed capability", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "kiln-managed-vision-generation-"));
    roots.push(projectPath);
    const session = new ProviderSession({
      provider: "openai",
      model: "gpt-5",
      task: "analyze an admitted image",
      cwd: projectPath,
      permissionPolicy: MODEL_FACING_DEFAULT_PERMISSION_POLICY,
      builtinToolOptions: { capabilityEvaluatedAt: "2026-08-31T12:00:00.000Z" },
      capabilityComposition: { appId: "cli-direct:openai", surfaceId: "cli-direct" },
      managedInvocation: visionAttachment(),
    });

    try {
      expect(session.authorityCapabilityGeneration).toMatchObject({
        evaluatedAt: "2026-08-31T12:00:00.000Z",
        authorityCandidates: [{
          capabilityId: "vision.analyze",
          toolName: "vision_analyze",
          materializationStatus: "materializable",
          kind: "agent-backed",
        }],
      });
    } finally {
      await session.dispose();
    }
  });

  it("materializes local vision through the existing Agent Task owner", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "kiln-local-vision-generation-"));
    roots.push(projectPath);
    const agentTaskCapability: AgentTaskVisionAnalysisCapabilityBinding = {
      agentTaskService: {
        dispatch: async () => { throw new Error("dispatch should not run during construction"); },
        getResult: async () => { throw new Error("result should not run during construction"); },
        cancel: async () => { throw new Error("cancel should not run during construction"); },
      },
      configuredAgentProfileId: "local-vision-worker",
      callerId: "parent-session",
      acceptAgentTask: async () => { throw new Error("accept should not run during construction"); },
    };
    const session = new ProviderSession({
      provider: "openai",
      model: "gpt-5",
      task: "analyze an admitted image locally",
      cwd: projectPath,
      permissionPolicy: MODEL_FACING_DEFAULT_PERMISSION_POLICY,
      builtinToolOptions: { capabilityEvaluatedAt: "2026-08-31T12:00:00.000Z" },
      capabilityComposition: { appId: "cli-direct:openai", surfaceId: "cli-direct" },
      agentTaskCapability,
    });

    try {
      expect(session.authorityCapabilityGeneration).toMatchObject({
        evaluatedAt: "2026-08-31T12:00:00.000Z",
        authorityCandidates: [{
          capabilityId: "vision.analyze",
          toolName: "vision_analyze",
          materializationStatus: "materializable",
          kind: "agent-backed",
        }],
      });
    } finally {
      await session.dispose();
    }
  });
});

function visionAttachment(): ManagedInvocationToolAttachment {
  return {
    options: {
      routes: [visionRoute()],
      agentCatalog: [{
        name: "vision-worker",
        role: "Vision specialist",
        goal: "Analyze governed images",
        tier: "reasoning",
        authorityProfileId: "authority:vision-readonly",
        access: "read-only",
        modalities: ["text", "image"],
        structured: true,
        routeId: "vision-route",
        providerRoute: { providerId: "openai", model: "gpt-vision" },
      }],
      invocationService: new RuntimeManagedAgentInvocationService(),
    },
    callerIdentity: {
      kind: "kiln-runtime",
      surface: "test",
      attachmentId: "attachment:provider-session-vision",
    },
  };
}

function visionRoute(): ManagedInvocationToolRoute {
  return {
    routeId: "vision-route",
    routeSource: "explicit-managed-route",
    providerId: "openai",
    model: "gpt-vision",
    capability: {
      identity: { routeId: "vision-route", revision: "vision-route-v1" },
      target: { providerId: "openai", modelId: "gpt-vision" },
      adapter: { kind: "direct-provider", capabilityId: "direct-runtime", capabilityVersion: "v1" },
      authorityCeiling: "read_only",
      toolNames: [],
      supportsRecursion: false,
      supportsAttachments: true,
      supportsWrite: false,
      externalRuntimeAttachment: {
        kind: "external-runtime",
        runtimeId: "vision-runtime",
        attachmentId: "vision-instance",
      },
      proof: {
        status: "configured",
        source: "provider-session-vision-test",
        provenAccess: ["read-only"],
      },
      capacity: { kind: "accountless" },
      settlement: { kind: "not-required" },
    },
    createAdapter: async () => undefined,
    externalRuntimeAttachment: {
      kind: "external-runtime",
      runtimeId: "vision-runtime",
      attachmentId: "vision-instance",
    },
    profiles: [{
      authorityProfileId: "authority:vision-readonly",
      access: "read-only",
      allowedToolNames: [],
      workingDirectory: { path: "C:/repo", mode: "read-only" },
      timeoutMs: 60_000,
      credentialRoute: { mode: "credentialless" },
      memoryScope: { scope: { kind: "project", id: "vision-test" }, access: "none" },
    }],
  };
}

function appConfig(): KilnAppConfig {
  return {
    createRegistry: () => {
      throw new Error("createRegistry should not be used");
    },
    kilnYaml: { version: "1" },
  };
}
