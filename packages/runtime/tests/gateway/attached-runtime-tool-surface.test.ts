import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultBuiltinToolSurface, createSessionBuiltinToolOptions } from "@kilnai/core";
import {
  buildAttachedRuntimePerCallToolConfig,
  createAttachedRuntimeBuiltinToolSurface,
} from "../../src/gateway/attached-runtime-tool-surface.js";

const ALWAYS_ON_RESOURCE_TOOLS = ["resource_list", "resource_template_list", "resource_read"];

function projectToolDefinitions(
  tools: readonly {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: Record<string, unknown>;
    readonly outputSchema?: Record<string, unknown>;
  }[],
): readonly {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
}[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
  }));
}

function countDeniedTools(
  toolAllowlist: ReadonlySet<string> | undefined,
  toolAuthority: ReadonlyMap<string, { readonly level: number; readonly allowed: boolean; readonly requiresApproval: boolean }> | undefined,
): number {
  if (!toolAllowlist || !toolAuthority) {
    return 0;
  }
  let denied = 0;
  for (const toolName of toolAllowlist) {
    const descriptor = toolAuthority.get(toolName);
    if (descriptor && (descriptor.level === 4 || descriptor.requiresApproval || !descriptor.allowed)) {
      denied += 1;
    }
  }
  return denied;
}

describe("attached runtime builtin tool surface", () => {
  it("projects default runtime tools from the canonical core builtin surface", () => {
    const coreSurface = createDefaultBuiltinToolSurface();
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface();

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual(coreSurface.toolNames);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual(coreSurface.toolNames);
    expect(Array.from(runtimeSurface.capabilities.keys())).toEqual(Array.from(coreSurface.capabilities.keys()));
    expect(projectToolDefinitions(runtimeSurface.toolDefinitions)).toEqual(projectToolDefinitions(coreSurface.toolDefinitions));
    expect(runtimeSurface.capabilities).toEqual(coreSurface.capabilities);
    expect(runtimeSurface.listResources()).toEqual(coreSurface.resources.list().map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      title: resource.title,
      mimeType: resource.mimeType,
    })));
    expect(runtimeSurface.listResourceTemplates().map((template) => template.uriTemplate)).toEqual(
      coreSurface.resources.listTemplates().map((template) => template.uriTemplate),
    );
  });

  it("builds executable per-call config from the same runtime surface projection", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface();
    const config = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: runtimeSurface,
    });

    const projectedToolNames = runtimeSurface.toolDefinitions.map((tool) => tool.name);
    expect(Array.from(config.toolAllowlist ?? [])).toEqual(projectedToolNames);
    expect(config.additionalTools?.map((tool) => tool.name)).toEqual(projectedToolNames);
    expect(config.perCallCapabilities).toBe(runtimeSurface.capabilities);
    expect(config.toolAuthority).toBe(runtimeSurface.toolAuthority);
  });

  it("fails closed for non-executable provider profiles and exposes no tools", () => {
    const config = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "openai",
      activeModel: "gpt-4.1",
      activeModelCapabilities: { supportsFunctionTools: false, supportsRuntimeTools: false },
    });

    expect(config.toolAllowlist?.size ?? 0).toBe(0);
    expect(config.toolAuthority?.size ?? 0).toBe(0);
    expect(config.effectiveTurnAuthority).toMatchObject({
      executionMode: "execute",
      requestedAuthority: "auto",
      admittedAuthority: "fail_closed",
      sourcePolicy: "provider_profile_gate",
      completeness: "authoritative",
      toolCount: 0,
      deniedToolCount: 0,
      sandboxProjection: "none",
    });

    const unresolvedConfig = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
    });
    expect(unresolvedConfig.toolAllowlist?.size ?? 0).toBe(0);
    expect(unresolvedConfig.toolAuthority?.size ?? 0).toBe(0);
    expect(unresolvedConfig.effectiveTurnAuthority).toMatchObject({
      admittedAuthority: "fail_closed",
      sourcePolicy: "provider_profile_gate",
      completeness: "authoritative",
      toolCount: 0,
      deniedToolCount: 0,
    });
    expect(unresolvedConfig.effectiveTurnAuthority?.reason).toContain("unresolved");
  });

  it("builds plan-mode per-call config from explicitly read-only tools and planning workflow tools", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface();
    const config = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: runtimeSurface,
      executionMode: "plan",
    });

    expect(config.toolAllowlist?.has("read")).toBe(true);
    expect(config.toolAllowlist?.has("tree")).toBe(true);
    expect(config.toolAllowlist?.has("submit_plan")).toBe(true);
    expect(config.toolAllowlist?.has("submit_specification")).toBe(true);
    expect(config.toolAllowlist?.has("record_clarification")).toBe(true);
    expect(config.toolAllowlist?.has("write")).toBe(false);
    expect(config.toolAllowlist?.has("edit")).toBe(false);
    expect(config.toolAllowlist?.has("patch")).toBe(false);
    expect(config.additionalTools?.map((tool) => tool.name)).toEqual(Array.from(config.toolAllowlist ?? []));
    expect(config.perCallCapabilities?.get("submit_plan")?.annotations?.readOnly).toBe(true);
    const allowlist = new Set(config.toolAllowlist ?? []);
    const perCallCapabilityNames = new Set(Array.from(config.perCallCapabilities?.keys() ?? []));
    expect(perCallCapabilityNames).toEqual(allowlist);
    expect(config.perCallCapabilities?.has("write")).toBe(false);
    expect(config.perCallCapabilities?.has("edit")).toBe(false);
    expect(config.perCallCapabilities?.has("patch")).toBe(false);
    expect(config.perCallCapabilities?.has("shell_command")).toBe(false);
    expect(config.effectiveTurnAuthority).toMatchObject({
      executionMode: "plan",
      requestedAuthority: "planning",
      admittedAuthority: "read_only",
      sourcePolicy: "plan_mode_projection",
      completeness: "authoritative",
      sandboxProjection: "read_only",
    });
    expect(config.effectiveTurnAuthority?.toolCount).toBe(config.toolAllowlist?.size ?? 0);
    expect(config.effectiveTurnAuthority?.deniedToolCount).toBe(0);
  });

  it("narrows execute-mode tools for requested read_only authority", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface();
    const requestedReadOnly = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: runtimeSurface,
      executionMode: "execute",
      requestedAuthority: "read_only",
    });

    expect(requestedReadOnly.effectiveTurnAuthority).toMatchObject({
      executionMode: "execute",
      requestedAuthority: "read_only",
      admittedAuthority: "read_only",
      sourcePolicy: "runtime_surface_projection",
      completeness: "authoritative",
    });

    const allowlist = requestedReadOnly.toolAllowlist ?? new Set<string>();
    expect(allowlist.size).toBeGreaterThan(0);
    expect(allowlist.has("write")).toBe(false);
    expect(allowlist.has("edit")).toBe(false);
    expect(allowlist.has("patch")).toBe(false);
    expect(allowlist.has("shell_command")).toBe(false);
    for (const toolName of allowlist) {
      expect(requestedReadOnly.perCallCapabilities?.get(toolName)?.annotations?.readOnly).toBe(true);
      expect(requestedReadOnly.toolAuthority?.get(toolName)).toMatchObject({
        allowed: true,
        requiresApproval: false,
      });
    }

    expect(requestedReadOnly.additionalTools?.map((tool) => tool.name)).toEqual(Array.from(allowlist));
    expect(requestedReadOnly.effectiveTurnAuthority?.toolCount).toBe(allowlist.size);
    expect(requestedReadOnly.effectiveTurnAuthority?.deniedToolCount).toBe(0);
  });

  it("rejects malformed requested authority in the shared per-call builder", () => {
    expect(() => buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      requestedAuthority: "invalid" as unknown as "auto",
    })).toThrow("Unknown requested authority 'invalid'.");
  });

  it("narrows execute-mode tools for requested audited authority to non-approval level <=2 tools", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface();
    const baseline = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: runtimeSurface,
      executionMode: "execute",
    });
    const requestedAudited = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: runtimeSurface,
      executionMode: "execute",
      requestedAuthority: "audited",
    });

    expect(requestedAudited.effectiveTurnAuthority).toMatchObject({
      executionMode: "execute",
      requestedAuthority: "audited",
      sourcePolicy: "runtime_surface_projection",
      completeness: "authoritative",
    });

    const allowlist = requestedAudited.toolAllowlist ?? new Set<string>();
    expect(allowlist.size).toBeGreaterThan(0);
    expect(allowlist.has("read")).toBe(true);
    expect(allowlist.has("shell_command")).toBe(false);
    for (const toolName of allowlist) {
      expect(requestedAudited.toolAuthority?.get(toolName)).toMatchObject({
        allowed: true,
        requiresApproval: false,
      });
      expect((requestedAudited.toolAuthority?.get(toolName)?.level ?? 99)).toBeLessThanOrEqual(2);
    }

    expect(requestedAudited.additionalTools?.map((tool) => tool.name)).toEqual(Array.from(allowlist));
    expect(requestedAudited.effectiveTurnAuthority?.toolCount).toBe(allowlist.size);
    expect(requestedAudited.effectiveTurnAuthority?.deniedToolCount).toBe(0);
    expect(allowlist.size).toBeLessThan(Array.from(baseline.toolAllowlist ?? []).length);
  });

  it("keeps plan-mode requestedAuthority as planning even when execute-mode escalation is requested", () => {
    const config = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: createAttachedRuntimeBuiltinToolSurface(),
      executionMode: "plan",
      requestedAuthority: "destructive",
    });

    expect(config.effectiveTurnAuthority).toMatchObject({
      executionMode: "plan",
      requestedAuthority: "planning",
      admittedAuthority: "read_only",
      sourcePolicy: "plan_mode_projection",
    });
  });

  it("derives execute-mode admitted authority from allowlist/toolAuthority and reports tool count", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface();
    const config = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: runtimeSurface,
      executionMode: "execute",
    });

    const expectedToolCount = runtimeSurface.toolDefinitions.length;
    const deniedToolCount = countDeniedTools(config.toolAllowlist, config.toolAuthority);
    expect(config.effectiveTurnAuthority).toMatchObject({
      executionMode: "execute",
      requestedAuthority: "auto",
      sourcePolicy: "runtime_surface_projection",
      toolCount: expectedToolCount,
      deniedToolCount,
      sandboxProjection: "workspace_write",
    });
    if (deniedToolCount > 0) {
      expect(config.effectiveTurnAuthority?.admittedAuthority).toBe("destructive");
      expect(config.effectiveTurnAuthority?.completeness).toBe("authoritative");
    }
  });

  it("keeps effectiveTurnAuthority in lockstep with returned allowlist and authority map", () => {
    const config = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: createAttachedRuntimeBuiltinToolSurface(),
    });

    const allowlist = Array.from(config.toolAllowlist ?? []);
    const additionalToolNames = config.additionalTools?.map((tool) => tool.name) ?? [];
    const deniedToolCount = countDeniedTools(config.toolAllowlist, config.toolAuthority);

    expect(new Set(additionalToolNames)).toEqual(new Set(allowlist));
    expect(config.effectiveTurnAuthority?.toolCount).toBe(allowlist.length);
    expect(config.effectiveTurnAuthority?.deniedToolCount).toBe(deniedToolCount);
  });

  it("isolates default plan-mode state stores across runtime surface instances", async () => {
    const firstSurface = createAttachedRuntimeBuiltinToolSurface({ executionMode: "plan" });
    const secondSurface = createAttachedRuntimeBuiltinToolSurface({ executionMode: "plan" });
    const submitSpecification = firstSurface.callBuiltinTools.get("submit_specification");
    const submitPlan = secondSurface.callBuiltinTools.get("submit_plan");

    const firstSpec = await submitSpecification?.({
      title: "Isolated surface spec",
      objective: "Ensure no cross-session state leakage.",
      nonGoals: ["No shared mutable store across surfaces."],
      successCriteria: ["Independent plan/spec artifacts per surface."],
      actors: ["operator"],
      dataLifecycle: "Session scoped only.",
      uxEdgeCases: [],
      securityPrivacy: "No secrets.",
      externalDependencies: [],
      completionSignals: ["plan submission succeeds only with local specification."],
      constitutionSnapshot: {
        instructionProfileHash: "hash-isolation",
        instructionProfileIds: ["sequel-engineering"],
      },
    }) as { readonly metadata?: Record<string, unknown> } | undefined;
    const firstSpecificationId = typeof firstSpec?.metadata?.specificationId === "string"
      ? firstSpec.metadata.specificationId
      : undefined;
    expect(firstSpecificationId).toBeDefined();

    const result = await submitPlan?.({
      objective: "Attempt cross-surface submit.",
      nonGoals: ["No execution changes."],
      operatorDecisionsRequired: ["Approve isolation test."],
      assumptions: ["Stores are isolated."],
      affectedSurfaces: ["runtime"],
      riskClassification: "low",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "State isolation check.",
        workflowProfile: "small-fix",
      },
      proposedWorkItems: [{
        id: "wi-1",
        summary: "Verify store isolation.",
        workflowProfile: "small-fix",
        risk: "low",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: [],
      }],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      managedAgentDelegationCandidates: [],
      approvalBoundaries: [],
      rollbackNotes: "",
      residualRisks: [],
      sourceSpecificationId: firstSpecificationId,
      clarificationRecordIds: [],
      constitutionSnapshot: {
        instructionProfileHash: "hash-isolation",
        instructionProfileIds: ["sequel-engineering"],
      },
    }) as { readonly isError?: boolean; readonly metadata?: Record<string, unknown> } | undefined;

    expect(result?.isError).toBe(true);
    expect(result?.metadata).toMatchObject({
      operation: "submit_plan",
      reason: "missing_specification",
      sourceSpecificationId: firstSpecificationId,
    });
  });

  it("fails closed when submit_plan required arrays or constitution ids are missing/invalid", async () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      executionMode: "plan",
      builtinToolOptions: createSessionBuiltinToolOptions(),
    });
    const submitPlan = runtimeSurface.callBuiltinTools.get("submit_plan");
    const submitSpecification = runtimeSurface.callBuiltinTools.get("submit_specification");

    await expect(submitPlan?.({
      objective: "Invalid payload missing assumptions.",
      nonGoals: ["none"],
      operatorDecisionsRequired: [],
      affectedSurfaces: ["runtime"],
      riskClassification: "low",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "strict validation",
        workflowProfile: "small-fix",
      },
      proposedWorkItems: [{
        id: "wi-1",
        summary: "Validate required fields.",
        workflowProfile: "small-fix",
        risk: "low",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: [],
      }],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      managedAgentDelegationCandidates: [],
      approvalBoundaries: [],
      rollbackNotes: "",
      residualRisks: [],
      sourceSpecificationId: "spec-any",
      clarificationRecordIds: [],
      constitutionSnapshot: {
        instructionProfileHash: "hash",
        instructionProfileIds: ["sequel-engineering"],
      },
    })).resolves.toMatchObject({
      isError: true,
      metadata: {
        reason: "invalid_input",
        toolName: "submit_plan",
      },
    });

    await expect(submitPlan?.({
      objective: "Invalid payload malformed affected surfaces.",
      nonGoals: ["none"],
      operatorDecisionsRequired: [],
      assumptions: [],
      affectedSurfaces: "runtime",
      riskClassification: "low",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "strict validation",
        workflowProfile: "small-fix",
      },
      proposedWorkItems: [{
        id: "wi-1",
        summary: "Validate required fields.",
        workflowProfile: "small-fix",
        risk: "low",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: [],
      }],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      managedAgentDelegationCandidates: [],
      approvalBoundaries: [],
      rollbackNotes: "",
      residualRisks: [],
      sourceSpecificationId: "spec-any",
      clarificationRecordIds: [],
      constitutionSnapshot: {
        instructionProfileHash: "hash",
        instructionProfileIds: ["sequel-engineering"],
      },
    })).resolves.toMatchObject({
      isError: true,
      metadata: {
        reason: "invalid_input",
        toolName: "submit_plan",
      },
    });

    await expect(submitPlan?.({
      objective: "Invalid payload missing rollback notes.",
      nonGoals: ["none"],
      operatorDecisionsRequired: [],
      assumptions: [],
      affectedSurfaces: ["runtime"],
      riskClassification: "low",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "strict validation",
        workflowProfile: "small-fix",
      },
      proposedWorkItems: [{
        id: "wi-1",
        summary: "Validate required fields.",
        workflowProfile: "small-fix",
        risk: "low",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: [],
      }],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      managedAgentDelegationCandidates: [],
      approvalBoundaries: [],
      residualRisks: [],
      sourceSpecificationId: "spec-any",
      clarificationRecordIds: [],
      constitutionSnapshot: {
        instructionProfileHash: "hash",
        instructionProfileIds: ["sequel-engineering"],
      },
    })).resolves.toMatchObject({
      isError: true,
      metadata: {
        reason: "invalid_input",
        toolName: "submit_plan",
      },
    });

    await expect(submitPlan?.({
      planId: 123,
      objective: "Invalid payload with malformed optional plan id.",
      nonGoals: ["none"],
      operatorDecisionsRequired: [],
      assumptions: [],
      affectedSurfaces: ["runtime"],
      riskClassification: "low",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "strict validation",
        workflowProfile: "small-fix",
      },
      proposedWorkItems: [{
        id: "wi-1",
        summary: "Validate required fields.",
        workflowProfile: "small-fix",
        risk: "low",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: [],
      }],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      managedAgentDelegationCandidates: [],
      approvalBoundaries: [],
      rollbackNotes: "",
      residualRisks: [],
      sourceSpecificationId: "spec-any",
      clarificationRecordIds: [],
      constitutionSnapshot: {
        instructionProfileHash: "hash",
        instructionProfileIds: ["sequel-engineering"],
      },
    })).resolves.toMatchObject({
      isError: true,
      metadata: {
        reason: "invalid_input",
        toolName: "submit_plan",
      },
    });

    await expect(submitPlan?.({
      objective: "Invalid payload with empty constitution ids.",
      nonGoals: ["none"],
      operatorDecisionsRequired: [],
      assumptions: [],
      affectedSurfaces: ["runtime"],
      riskClassification: "low",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "strict validation",
        workflowProfile: "small-fix",
      },
      proposedWorkItems: [{
        id: "wi-1",
        summary: "Validate required fields.",
        workflowProfile: "small-fix",
        risk: "low",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: [],
      }],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      managedAgentDelegationCandidates: [],
      approvalBoundaries: [],
      rollbackNotes: "",
      residualRisks: [],
      sourceSpecificationId: "spec-any",
      clarificationRecordIds: [],
      constitutionSnapshot: {
        instructionProfileHash: "hash",
        instructionProfileIds: [],
      },
    })).resolves.toMatchObject({
      isError: true,
      metadata: {
        reason: "invalid_input",
        toolName: "submit_plan",
      },
    });

    await expect(submitPlan?.({
      objective: "Invalid payload with mixed constitution id types.",
      nonGoals: ["none"],
      operatorDecisionsRequired: [],
      assumptions: [],
      affectedSurfaces: ["runtime"],
      riskClassification: "low",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "strict validation",
        workflowProfile: "small-fix",
      },
      proposedWorkItems: [{
        id: "wi-1",
        summary: "Validate required fields.",
        workflowProfile: "small-fix",
        risk: "low",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: [],
      }],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      managedAgentDelegationCandidates: [],
      approvalBoundaries: [],
      rollbackNotes: "",
      residualRisks: [],
      sourceSpecificationId: "spec-any",
      clarificationRecordIds: [],
      constitutionSnapshot: {
        instructionProfileHash: "hash",
        instructionProfileIds: ["sequel-engineering", 123],
      },
    })).resolves.toMatchObject({
      isError: true,
      metadata: {
        reason: "invalid_input",
        toolName: "submit_plan",
      },
    });

    await expect(submitPlan?.({
      objective: "Invalid payload with non-string assumptions entry.",
      nonGoals: ["none"],
      operatorDecisionsRequired: [],
      assumptions: [123],
      affectedSurfaces: ["runtime"],
      riskClassification: "low",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "strict validation",
        workflowProfile: "small-fix",
      },
      proposedWorkItems: [{
        id: "wi-1",
        summary: "Validate required fields.",
        workflowProfile: "small-fix",
        risk: "low",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: [],
      }],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      managedAgentDelegationCandidates: [],
      approvalBoundaries: [],
      rollbackNotes: "",
      residualRisks: [],
      sourceSpecificationId: "spec-any",
      clarificationRecordIds: [],
      constitutionSnapshot: {
        instructionProfileHash: "hash",
        instructionProfileIds: ["sequel-engineering"],
      },
    })).resolves.toMatchObject({
      isError: true,
      metadata: {
        reason: "invalid_input",
        toolName: "submit_plan",
      },
    });

    await expect(submitPlan?.({
      objective: "Invalid payload with malformed work-item dependencies.",
      nonGoals: ["none"],
      operatorDecisionsRequired: [],
      assumptions: [],
      affectedSurfaces: ["runtime"],
      riskClassification: "low",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "strict validation",
        workflowProfile: "small-fix",
      },
      proposedWorkItems: [{
        id: "wi-1",
        summary: "Validate required fields.",
        workflowProfile: "small-fix",
        risk: "low",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: "wi-2",
      }],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      managedAgentDelegationCandidates: [],
      approvalBoundaries: [],
      rollbackNotes: "",
      residualRisks: [],
      sourceSpecificationId: "spec-any",
      clarificationRecordIds: [],
      constitutionSnapshot: {
        instructionProfileHash: "hash",
        instructionProfileIds: ["sequel-engineering"],
      },
    })).resolves.toMatchObject({
      isError: true,
      metadata: {
        reason: "invalid_input",
        toolName: "submit_plan",
      },
    });

    await expect(submitSpecification?.({
      specificationId: 42,
      title: "Invalid optional specification id",
      objective: "Should fail closed on malformed optional id.",
      nonGoals: ["none"],
      successCriteria: ["criterion"],
      actors: ["operator"],
      dataLifecycle: "Session scoped.",
      uxEdgeCases: [],
      securityPrivacy: "No secrets.",
      externalDependencies: [],
      completionSignals: ["signal"],
      constitutionSnapshot: {
        instructionProfileHash: "hash",
        instructionProfileIds: ["sequel-engineering"],
      },
    })).resolves.toMatchObject({
      isError: true,
      metadata: {
        reason: "invalid_input",
        toolName: "submit_specification",
      },
    });
  });

  it("submits structured plans only when linked specification state is valid", async () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      executionMode: "plan",
      builtinToolOptions: createSessionBuiltinToolOptions(),
    });
    const submitSpecification = runtimeSurface.callBuiltinTools.get("submit_specification");
    const recordClarification = runtimeSurface.callBuiltinTools.get("record_clarification");
    const submitPlan = runtimeSurface.callBuiltinTools.get("submit_plan");

    const specResult = await submitSpecification?.({
      title: "Slice 2",
      objective: "Convert submit_plan to structured contract.",
      nonGoals: ["Do not execute implementation in plan mode."],
      successCriteria: ["Structured plan artifacts are validated and replayable."],
      actors: ["operator", "runtime"],
      dataLifecycle: "Plan artifacts remain session-scoped canonical resources.",
      uxEdgeCases: ["Missing approval boundaries for high-risk plans."],
      securityPrivacy: "No secrets stored in plan payload.",
      externalDependencies: ["none"],
      completionSignals: ["plan_submitted event contains structured fields."],
      constitutionSnapshot: {
        instructionProfileHash: "hash-2",
        instructionProfileIds: ["sequel-engineering"],
      },
    }) as { readonly isError?: boolean; readonly metadata?: Record<string, unknown> } | undefined;

    expect(specResult?.isError).toBe(false);
    const specificationId = typeof specResult?.metadata?.specificationId === "string"
      ? specResult.metadata.specificationId
      : undefined;
    expect(specificationId).toBeDefined();

    const clarificationResult = await recordClarification?.({
      specificationId,
      question: "Should high-risk plans require rollback notes?",
      answer: "Yes.",
      affectedSection: "verification",
      rationale: "High-risk slices must fail closed with explicit recovery guidance.",
    }) as { readonly isError?: boolean; readonly metadata?: Record<string, unknown> } | undefined;
    expect(clarificationResult?.isError).toBe(false);
    const clarificationId = typeof clarificationResult?.metadata?.clarificationId === "string"
      ? clarificationResult.metadata.clarificationId
      : undefined;

    const planResult = await submitPlan?.({
      objective: "Ship typed plan submission contract.",
      nonGoals: ["Do not materialize work items automatically in Slice 2."],
      operatorDecisionsRequired: ["Approve plan hash before execute transition."],
      assumptions: ["Operator profile hash is stable during planning turn."],
      affectedSurfaces: ["runtime", "core", "gateway-contracts", "cli"],
      riskClassification: "high",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "Cross-surface behavior and replay semantics.",
        workflowProfile: "architecture-change",
      },
      proposedWorkItems: [{
        id: "wi-1",
        summary: "Add structured plan schema and validation.",
        workflowProfile: "architecture-change",
        risk: "high",
        expectedEvidence: ["tests", "typecheck"],
        verificationGates: ["bun test", "bun run typecheck"],
        dependencies: [],
      }],
      expectedEvidence: ["tests", "typecheck", "review"],
      verificationGates: ["bun test", "bun run typecheck"],
      managedAgentDelegationCandidates: ["reviewer"],
      approvalBoundaries: ["Plan approval required before execute mode."],
      rollbackNotes: "Revert plan event payload and schema changes.",
      residualRisks: ["Presentation adapters may lag one schema revision."],
      sourceSpecificationId: specificationId,
      clarificationRecordIds: clarificationId ? [clarificationId] : [],
      constitutionSnapshot: {
        instructionProfileHash: "hash-2",
        instructionProfileIds: ["sequel-engineering"],
      },
    }) as { readonly isError?: boolean; readonly metadata?: Record<string, unknown> } | undefined;

    expect(planResult?.isError).toBe(false);
    expect(planResult?.metadata).toMatchObject({
      operation: "submit_plan",
      sourceSpecificationId: specificationId,
      riskClassification: "high",
      workflowProfile: "architecture-change",
    });

    const invalidPlanResult = await submitPlan?.({
      objective: "Invalid high-risk plan.",
      nonGoals: ["none"],
      operatorDecisionsRequired: [],
      assumptions: [],
      affectedSurfaces: ["runtime"],
      riskClassification: "high",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "high risk",
        workflowProfile: "architecture-change",
      },
      proposedWorkItems: [{
        id: "wi-bad",
        summary: "Bad",
        workflowProfile: "architecture-change",
        risk: "high",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: [],
      }],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      managedAgentDelegationCandidates: [],
      approvalBoundaries: [],
      rollbackNotes: "",
      residualRisks: [],
      sourceSpecificationId: specificationId,
      clarificationRecordIds: clarificationId ? [clarificationId] : [],
      constitutionSnapshot: {
        instructionProfileHash: "hash-2",
        instructionProfileIds: ["sequel-engineering"],
      },
    }) as { readonly isError?: boolean; readonly metadata?: Record<string, unknown> } | undefined;

    expect(invalidPlanResult?.isError).toBe(true);
    expect(invalidPlanResult?.metadata).toMatchObject({
      operation: "submit_plan",
      planStatus: "draft",
    });
    expect(typeof invalidPlanResult?.metadata?.blockingIssueCount).toBe("number");

    const analysisBlockedResult = await submitPlan?.({
      objective: "Plan with critical dependency inconsistency.",
      nonGoals: ["Do not auto-approve invalid dependency graphs."],
      operatorDecisionsRequired: ["Approve dependency correction before execution."],
      assumptions: ["Work item dependency graph must be valid."],
      affectedSurfaces: ["runtime"],
      riskClassification: "high",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "Critical workflow control path.",
        workflowProfile: "architecture-change",
      },
      proposedWorkItems: [{
        id: "wi-analysis",
        summary: "Analyze dependency graph.",
        workflowProfile: "architecture-change",
        risk: "high",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: ["wi-missing"],
      }],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      managedAgentDelegationCandidates: ["reviewer"],
      approvalBoundaries: ["Block approval on critical analysis findings."],
      rollbackNotes: "Re-run analysis after fixing dependencies.",
      residualRisks: ["none"],
      sourceSpecificationId: specificationId,
      clarificationRecordIds: clarificationId ? [clarificationId] : [],
      constitutionSnapshot: {
        instructionProfileHash: "hash-2",
        instructionProfileIds: ["sequel-engineering"],
      },
    }) as { readonly isError?: boolean; readonly metadata?: Record<string, unknown> } | undefined;

    expect(analysisBlockedResult?.isError).toBe(true);
    expect(analysisBlockedResult?.metadata).toMatchObject({
      operation: "submit_plan",
      analysisStatus: "blocked",
      analysisHighestSeverity: "critical",
      analysisBlockingFindingCount: 1,
    });
  });

  it("propagates deferred core tool projection to runtime consumers", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        toolProjection: {
          mode: "deferred",
          alwaysOnTools: ["read"],
        },
      },
    });

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual(["read", "tool_catalog_search", ...ALWAYS_ON_RESOURCE_TOOLS]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual(["read", "tool_catalog_search", ...ALWAYS_ON_RESOURCE_TOOLS]);
    expect(Array.from(runtimeSurface.capabilities.keys())).toEqual(["read", "tool_catalog_search", ...ALWAYS_ON_RESOURCE_TOOLS]);
  });

  it("can explicitly expose code intelligence in deferred runtime projection", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        toolProjection: {
          mode: "deferred",
          alwaysOnTools: ["read", "code_intelligence"],
        },
      },
    });

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual([
      "read",
      "code_intelligence",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
    ]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "code_intelligence",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
    ]);
  });

  it("can explicitly expose read_many in deferred runtime projection", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        toolProjection: {
          mode: "deferred",
          alwaysOnTools: ["read", "read_many"],
        },
      },
    });

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual([
      "read",
      "read_many",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
    ]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "read_many",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
    ]);
  });

  it("can explicitly expose monitor lifecycle tools in deferred runtime projection", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        toolProjection: {
          mode: "deferred",
          alwaysOnTools: ["read", "monitor_start", "monitor_read", "monitor_stop", "monitor_list"],
        },
      },
    });

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual([
      "read",
      "monitor_start",
      "monitor_read",
      "monitor_stop",
      "monitor_list",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
    ]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "monitor_start",
      "monitor_read",
      "monitor_stop",
      "monitor_list",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
    ]);
  });

  it("can explicitly expose task state tools in deferred runtime projection", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        toolProjection: {
          mode: "deferred",
          alwaysOnTools: ["read", "task_list", "task_update"],
        },
      },
    });

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual([
      "read",
      "task_list",
      "task_update",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
    ]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "task_list",
      "task_update",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
    ]);
  });

  it("can explicitly expose operator elicitation in deferred runtime projection", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        toolProjection: {
          mode: "deferred",
          alwaysOnTools: ["read", "operator_elicit"],
        },
      },
    });

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual([
      "read",
      "operator_elicit",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
    ]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "operator_elicit",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
    ]);
  });

  it("routes interactive browser and computer tools through runtime-injected providers", async () => {
    const browserRequests: Record<string, unknown>[] = [];
    const computerRequests: Record<string, unknown>[] = [];
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        browserUse: {
          provider: {
            async execute(request) {
              browserRequests.push(request);
              return {
                provider: "runtime-browser",
                sessionId: request.sessionId ?? "browser-1",
                output: "browser action routed",
                observation: {
                  url: request.url ?? "https://example.com",
                  title: "Example",
                  screenshotUri: "kiln://artifacts/interactive/browser-1/screenshot",
                },
              };
            },
          },
        },
        computerUse: {
          provider: {
            async execute(request) {
              computerRequests.push(request);
              return {
                provider: "runtime-computer",
                output: "computer action routed",
                observation: {
                  windowTitle: "Calculator",
                  screenshotUri: "kiln://artifacts/interactive/computer/screenshot",
                },
              };
            },
          },
        },
      },
    });

    await expect(runtimeSurface.callBuiltinTools.get("browser_navigate")?.({
      sessionId: "browser-1",
      url: "https://example.com",
    })).resolves.toMatchObject({
      output: "browser action routed",
      isError: false,
      metadata: {
        toolName: "browser_navigate",
        kind: "interactive",
        target: "browser",
        operation: "navigate",
        provider: "runtime-browser",
        sessionId: "browser-1",
      },
    });
    await expect(runtimeSurface.callBuiltinTools.get("computer_observe")?.({
      windowTitle: "Calculator",
    })).resolves.toMatchObject({
      output: "computer action routed",
      isError: false,
      metadata: {
        toolName: "computer_observe",
        kind: "interactive",
        target: "computer",
        operation: "observe",
        provider: "runtime-computer",
      },
    });

    expect(browserRequests).toHaveLength(1);
    expect(browserRequests[0]).toMatchObject({
      target: "browser",
      operation: "navigate",
      url: "https://example.com",
    });
    expect(computerRequests).toHaveLength(1);
    expect(computerRequests[0]).toMatchObject({
      target: "computer",
      operation: "observe",
      windowTitle: "Calculator",
    });
  });

  it("surfaces resource links from direct-provider builtin tool execution without injecting artifact content", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "kiln-runtime-resource-links-"));
    try {
      await writeFile(join(tempDir, "large.txt"), "runtime link\n".repeat(1_000), "utf8");
      const runtimeSurface = createAttachedRuntimeBuiltinToolSurface();

      const result = await runtimeSurface.callBuiltinTools.get("read_many")?.({
        paths: [join(tempDir, "large.txt")],
        maxBytes: 20_000,
      }) as {
        output: string;
        resourceLinks?: readonly { uri: string; title?: string }[];
        content?: readonly { type: string; uri?: string }[];
      };

      expect(result.output).toContain("Full tool output is available as resource links");
      expect(result.output).toContain("kiln://artifacts/tool-results/");
      expect(result.resourceLinks).toEqual([expect.objectContaining({
        uri: expect.stringMatching(/^kiln:\/\/artifacts\/tool-results\/artifact_\d+\/content$/),
        title: "read_many full output",
      })]);
      expect(result.content).toEqual([expect.objectContaining({
        type: "resource_link",
        uri: result.resourceLinks?.[0]?.uri,
      })]);
      expect(JSON.stringify(result)).not.toContain("runtime link");
      expect(runtimeSurface.listResources()).toContainEqual(expect.objectContaining({
        uri: "kiln://artifacts/tool-results",
        title: "Artifacts: tool-results",
      }));
      await expect(runtimeSurface.readResource(result.resourceLinks![0]!.uri)).resolves.toMatchObject({
        contents: [{
          uri: result.resourceLinks![0]!.uri,
          mimeType: "text/plain",
          text: expect.stringContaining("runtime link"),
        }],
      });
      await expect(runtimeSurface.callBuiltinTools.get("resource_read")?.({
        uri: result.resourceLinks![0]!.uri,
      })).resolves.toMatchObject({
        output: expect.stringContaining("runtime link"),
        isError: false,
        metadata: expect.objectContaining({
          toolName: "resource_read",
          kind: "resource",
          operation: "read",
          uri: result.resourceLinks![0]!.uri,
        }),
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
