import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventBus, SkillRegistry, coordinationStateToContextCandidates, textParts } from "@kilnai/core";
import type { TenantConfig } from "@kilnai/core";
import type { SkillConfig } from "@kilnai/core";
import { processAdmittedTurn, projectAdmittedTurnContext } from "../../src/gateway/message-pipeline.js";
import type { AdmittedTurnContext } from "../../src/gateway/message-pipeline.js";
import type { RuntimeSessionOrchestrator, OrchestrateResult } from "../../src/session/runtime-session-orchestrator.js";
import type { SessionRegistry } from "../../src/session/session-registry.js";
import type { RuntimeSession } from "../../src/session/runtime-session.js";
import type { ConversationEventEmitter } from "../../src/gateway/conversation-event-emitter.js";
import type { BillingConfig } from "../../src/gateway/budget-middleware.js";
import * as agentResolver from "../../src/tenant/agent-resolver.js";
import * as runtimeArtifacts from "../../src/session/support/artifacts/context-artifact-summary.js";
import { buildTenantSystemPrompt } from "../../src/tenant/system-prompt-builder.js";

const processInboundMessage = processAdmittedTurn;

const originalFetch = globalThis.fetch;

function makeMockSession(): RuntimeSession {
  let _userContext: Record<string, string> | undefined;
  let _sessionLedger: Record<string, unknown> = {};
  let _exactArtifacts: string[] = [];
  let _sessionEvents: Array<Record<string, unknown>> = [];
  let _systemPrompt = "You are a test assistant.";
  let _activeAgentId: string | undefined;
  const setSystemPrompt = vi.fn((prompt: string) => {
    _systemPrompt = prompt;
    (session as unknown as { systemPrompt: string }).systemPrompt = prompt;
  });
  const setActiveAgent = vi.fn((agentId: string) => {
    _activeAgentId = agentId;
    (session as unknown as { activeAgentId?: string }).activeAgentId = agentId;
  });

  const session = {
    id: "test-app:test-tenant:user-1:12345",
    appName: "test-app",
    tenantId: "test-tenant",
    userId: "user-1",
    sessionMode: "ai_active" as const,
    totalTokens: 0,
    userTurnCount: 0,
    conversationHistory: [] as any,
    messageCount: 0,
    activeAgentId: undefined as string | undefined,
    systemPrompt: _systemPrompt,
    accumulateTokens: vi.fn(),
    get userContext() { return _userContext; },
    updateUserContext(ctx: Record<string, string>) {
      _userContext = { ..._userContext, ...ctx };
    },
    updateSessionLedger(updates: Record<string, unknown>) {
      _sessionLedger = { ..._sessionLedger, ...updates };
    },
    get sessionLedger() { return _sessionLedger as any; },
    addExactArtifact(artifact: string) {
      _exactArtifacts.push(artifact);
    },
    get exactArtifacts() { return _exactArtifacts; },
    get sessionEvents() { return _sessionEvents as any; },
    nextSessionEventSequence() {
      const lastEvent = _sessionEvents[_sessionEvents.length - 1];
      return typeof lastEvent?.sequence === "number" ? (lastEvent.sequence as number) + 1 : 1;
    },
    appendSessionEvents(events: readonly Record<string, unknown>[]) {
      _sessionEvents = [..._sessionEvents, ...events];
    },
    setSystemPrompt,
    setActiveAgent,
    getActiveAgentId() {
      return _activeAgentId;
    },
  } as unknown as RuntimeSession;
  return session;
}

function makeMockOrchestrator(): RuntimeSessionOrchestrator {
  return {
    processMessage: vi.fn().mockResolvedValue({
      parts: textParts("mock response"),
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      queued: false,
    } satisfies OrchestrateResult),
    registerTools: vi.fn(),
    model: "claude-sonnet-4-20250514",
  } as unknown as RuntimeSessionOrchestrator;
}

function makeMockSessionRegistry(session?: RuntimeSession): SessionRegistry {
  const mockSession = session ?? makeMockSession();
  return {
    getOrCreate: vi.fn().mockResolvedValue(mockSession),
    save: vi.fn().mockResolvedValue(undefined),
  } as unknown as SessionRegistry;
}

function makeMockEventEmitter(): ConversationEventEmitter {
  return {
    emit: vi.fn(),
  } as unknown as ConversationEventEmitter;
}

function makeBillingConfig(): BillingConfig {
  return {
    budgetEndpoint: "https://api.example.com/users/{userId}/ai-budget",
    usageEndpoint: "https://api.example.com/users/{userId}/ai-usage",
    overBudgetMessage: "Budget exhausted.",
  };
}

function makeSkillConfig(overrides: Partial<SkillConfig> = {}): SkillConfig {
  return {
    name: "runtime-governed-skill",
    description: "Routes procedural instructions through governed context.",
    tools: ["lookup_customer"],
    triggers: [],
    tags: ["support", "runtime"],
    filePath: "memory://runtime-governed-skill",
    instructions: "Always verify the runtime customer record before responding.",
    ...overrides,
  };
}

function makeBaseContext(overrides: Partial<AdmittedTurnContext> = {}): AdmittedTurnContext {
  return {
    orchestrator: makeMockOrchestrator(),
    sessionRegistry: makeMockSessionRegistry(),
    appName: "test-app",
    tenantId: "test-tenant",
    userId: "user-1",
    systemPrompt: "You are a test assistant.",
    userParts: textParts("hello"),
    channel: "api",
    ...overrides,
  };
}

function getGovernedContextContent(orchestrator: RuntimeSessionOrchestrator): string {
  const callArgs = (orchestrator.processMessage as ReturnType<typeof vi.fn>).mock.calls[0];
  const governedContextArg = callArgs[2] as { readonly content?: string } | undefined;
  return governedContextArg?.content ?? "";
}

describe("processAdmittedTurn", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ allowed: true, remaining: 50000, unit: "tokens" }),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("projects visitor context as a separate governed candidate", () => {
    const projected = projectAdmittedTurnContext({
      userContext: undefined,
      cachedRuntimeSummary: undefined,
      recalledMemory: undefined,
      knowledgeContext: undefined,
      contactContext: "contact profile",
      visitorContext: "visitor browser state",
      groundingMode: undefined,
    });

    expect(projected.content).toContain("contact profile");
    expect(projected.content).toContain("visitor browser state");
    expect(projected.audit?.blocks).toContainEqual(expect.objectContaining({
      source: "runtime-contact-context",
      decision: "admitted",
    }));
    expect(projected.audit?.blocks).toContainEqual(expect.objectContaining({
      source: "runtime-visitor-context",
      decision: "admitted",
    }));
  });

  it("returns ok:true with result when budget is allowed", async () => {
    const ctx = makeBaseContext({ billing: makeBillingConfig() });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.inputTokens).toBe(100);
      expect(result.result.outputTokens).toBe(50);
      expect(result.result.cacheReadTokens).toBe(10);
      expect(result.result.cacheWriteTokens).toBe(5);
      expect(result.result.queued).toBe(false);
      expect(result.result.sessionId).toBe("test-app:test-tenant:user-1:12345");
      expect(result.result.sessionMode).toBe("ai_active");
    }
  });

  it("returns ok:false with budgetDenied when budget exhausted", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ allowed: false, remaining: 0, unit: "tokens" }),
    });

    const ctx = makeBaseContext({ billing: makeBillingConfig() });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.budgetDenied.budgetExhausted).toBe(true);
      expect(result.budgetDenied.message).toBe("Budget exhausted.");
    }
  });

  it("skips budget check when no billing configured", async () => {
    const ctx = makeBaseContext();

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("records submitted plans as canonical session events in plan execution mode", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    (orchestrator.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      parts: textParts("Plan submitted."),
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      queued: false,
      toolExecutions: [{
        toolCallId: "tool-plan",
        toolName: "submit_plan",
        input: {
          objective: "Implement execution mode lifecycle.",
          nonGoals: ["Do not execute implementation in plan mode."],
          operatorDecisionsRequired: ["Approve transition to execute mode."],
          assumptions: ["Existing event replay remains canonical."],
          affectedSurfaces: ["runtime", "cli"],
          riskClassification: "high",
          workGovernanceRecommendation: {
            posture: "orchestrate",
            rationale: "Multi-file runtime workflow change.",
            workflowProfile: "architecture-change",
          },
          proposedWorkItems: [{
            id: "wi-1",
            summary: "Add typed contract.",
            workflowProfile: "architecture-change",
            risk: "high",
            expectedEvidence: ["tests"],
            verificationGates: ["bun test"],
            dependencies: [],
          }],
          expectedEvidence: ["tests", "typecheck"],
          verificationGates: ["bun test", "bun run typecheck"],
          managedAgentDelegationCandidates: ["reviewer"],
          approvalBoundaries: ["approve plan before execution"],
          rollbackNotes: "Rollback event payload to prior shape if needed.",
          residualRisks: ["consumer parser drift"],
          sourceSpecificationId: "spec_1",
          clarificationRecordIds: ["clar_1"],
          constitutionSnapshot: {
            instructionProfileHash: "hash-1",
            instructionProfileIds: ["sequel-engineering"],
          },
        },
        durationMs: 1,
        success: true,
        output: JSON.stringify({
          output: "Plan submitted.",
          isError: false,
          metadata: {
            toolName: "submit_plan",
            operation: "submit_plan",
            planId: "tool-plan",
            analysisReportId: "analysis_report_1",
            analysisStatus: "ready",
            analysisHighestSeverity: "low",
            analysisFindingCount: 1,
            analysisBlockingFindingCount: 0,
            analysisFindingIds: ["analysis_finding_1"],
            analysisBlockingFindingIds: [],
            analysisFindings: [{
              id: "analysis_finding_1",
              fingerprint: "fingerprint-1",
              category: "terminology_drift",
              severity: "low",
              title: "Actor Terminology Drift",
              detail: "Actor is not referenced in the plan.",
              references: ["specification:spec_1", "plan:tool-plan"],
              status: "open",
            }],
            analysisSummary: "No critical findings. Ready for approval.",
            sourceSpecificationId: "spec_1",
          },
        }),
        resultSummary: "Plan submitted.",
        metadata: {
          operation: "submit_plan",
          planId: "tool-plan",
          analysisReportId: "analysis_report_1",
          analysisStatus: "ready",
          analysisHighestSeverity: "low",
          analysisFindingCount: 1,
          analysisBlockingFindingCount: 0,
          analysisFindingIds: ["analysis_finding_1"],
          analysisBlockingFindingIds: [],
          analysisFindings: [{
            id: "analysis_finding_1",
            fingerprint: "fingerprint-1",
            category: "terminology_drift",
            severity: "low",
            title: "Actor Terminology Drift",
            detail: "Actor is not referenced in the plan.",
            references: ["specification:spec_1", "plan:tool-plan"],
            status: "open",
          }],
          analysisSummary: "No critical findings. Ready for approval.",
          sourceSpecificationId: "spec_1",
        },
      }],
    } satisfies OrchestrateResult);

    const result = await processInboundMessage(makeBaseContext({
      executionMode: "plan",
      sessionRegistry: makeMockSessionRegistry(session),
      orchestrator,
    }));

    expect(result.ok).toBe(true);
    expect(session.sessionEvents).toContainEqual(expect.objectContaining({
      kind: "plan_submitted",
      planId: "tool-plan",
      mode: "plan",
      objective: "Implement execution mode lifecycle.",
      riskClassification: "high",
      workflowProfile: "architecture-change",
      sourceSpecificationId: "spec_1",
      proposedWorkItems: [{
        id: "wi-1",
        summary: "Add typed contract.",
        workflowProfile: "architecture-change",
        risk: "high",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: [],
      }],
    }));
    expect(session.sessionEvents).toContainEqual(expect.objectContaining({
      kind: "plan_analysis_reported",
      reportId: "analysis_report_1",
      planId: "tool-plan",
      specificationId: "spec_1",
      status: "ready",
      highestSeverity: "low",
      findings: [expect.objectContaining({
        id: "analysis_finding_1",
        category: "terminology_drift",
        status: "open",
      })],
    }));
  });

  it("projects normalized plan fields from submit_plan metadata over raw input", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    (orchestrator.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      parts: textParts("Plan submitted."),
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      queued: false,
      toolExecutions: [{
        toolCallId: "tool-plan-metadata",
        toolName: "submit_plan",
        input: {
          objective: "  Ship structured plan contract  ",
          nonGoals: ["  duplicate  ", "duplicate", "  legacy mode "],
          expectedEvidence: [" tests ", "tests"],
          verificationGates: ["bun test", " bun test "],
          sourceSpecificationId: " spec_1 ",
          riskClassification: "high",
          workGovernanceRecommendation: {
            posture: "orchestrate",
            workflowProfile: "architecture-change",
          },
        },
        durationMs: 1,
        success: true,
        output: "Plan submitted.",
        resultSummary: "Plan submitted.",
        metadata: {
          operation: "submit_plan",
          planId: "plan_1",
          summary: "Ship structured plan contract",
          objective: "Ship structured plan contract",
          nonGoals: ["duplicate", "legacy mode"],
          expectedEvidence: ["tests"],
          verificationGates: ["bun test"],
          sourceSpecificationId: "spec_1",
          riskClassification: "high",
          workGovernancePosture: "orchestrate",
          workflowProfile: "architecture-change",
          proposedWorkItemCount: 1,
          constitutionSnapshotHash: "hash-1",
          clarificationRecordIds: ["clar_1"],
        },
      }],
    } satisfies OrchestrateResult);

    const result = await processInboundMessage(makeBaseContext({
      executionMode: "plan",
      sessionRegistry: makeMockSessionRegistry(session),
      orchestrator,
    }));

    expect(result.ok).toBe(true);
    expect(session.sessionEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "plan_submitted",
        planId: "plan_1",
        objective: "Ship structured plan contract",
        nonGoals: ["duplicate", "legacy mode"],
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        sourceSpecificationId: "spec_1",
        summary: "Ship structured plan contract",
      }),
    ]));
  });

  it("records specification and clarification events in plan execution mode", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    (orchestrator.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      parts: textParts("Specification captured."),
      inputTokens: 12,
      outputTokens: 7,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      queued: false,
      toolExecutions: [{
        toolCallId: "tool-spec",
        toolName: "submit_specification",
        input: {
          specificationId: "spec_1",
          title: "Slice 1",
          objective: "Implement structured specification intake.",
        },
        durationMs: 2,
        success: true,
        output: "Specification submitted.",
        resultSummary: "Specification spec_1 is ready for planning.",
        metadata: {
          toolName: "submit_specification",
          operation: "submit_specification",
          specificationId: "spec_1",
          specificationStatus: "ready_for_plan",
          issues: [],
          blockingIssueCodes: [],
        },
      }, {
        toolCallId: "tool-clar",
        toolName: "record_clarification",
        input: {
          specificationId: "spec_1",
          question: "Should plan mode remain read-only?",
          answer: "Yes.",
          affectedSection: "authority",
          rationale: "Plan mode must not mutate workspace files.",
        },
        durationMs: 1,
        success: true,
        output: "Clarification recorded.",
        resultSummary: "Clarification recorded.",
        metadata: {
          toolName: "record_clarification",
          operation: "record_clarification",
          specificationId: "spec_1",
          clarificationId: "clar_1",
          affectedSection: "authority",
        },
      }, {
        toolCallId: "tool-plan",
        toolName: "submit_plan",
        input: {
          objective: "Validate schema and add resources.",
          nonGoals: ["Do not execute implementation work in plan mode."],
          operatorDecisionsRequired: ["Approve execution transition."],
          assumptions: ["Specification schema remains stable."],
          affectedSurfaces: ["core", "runtime"],
          riskClassification: "medium",
          workGovernanceRecommendation: {
            posture: "orchestrate",
            rationale: "Cross-package updates.",
            workflowProfile: "verification-heavy",
          },
          proposedWorkItems: [{
            id: "wi-2",
            summary: "Validate schema projection.",
            workflowProfile: "verification-heavy",
            risk: "medium",
            expectedEvidence: ["tests"],
            verificationGates: ["bun test"],
            dependencies: [],
          }],
          expectedEvidence: ["tests"],
          verificationGates: ["bun test"],
          managedAgentDelegationCandidates: ["reviewer"],
          approvalBoundaries: ["Require approval before execute mode."],
          rollbackNotes: "Revert contract changes.",
          residualRisks: ["presentation drift"],
          sourceSpecificationId: "spec_1",
          clarificationRecordIds: ["clar_1"],
          constitutionSnapshot: {
            instructionProfileHash: "hash-1",
            instructionProfileIds: ["sequel-engineering"],
          },
        },
        durationMs: 1,
        success: true,
        output: "Plan submitted.",
        resultSummary: "Plan submitted.",
      }],
    } satisfies OrchestrateResult);

    const result = await processInboundMessage(makeBaseContext({
      executionMode: "plan",
      sessionRegistry: makeMockSessionRegistry(session),
      orchestrator,
    }));

    expect(result.ok).toBe(true);
    expect(session.sessionEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "specification_submitted",
        specificationId: "spec_1",
        status: "ready_for_plan",
      }),
      expect.objectContaining({
        kind: "clarification_recorded",
        specificationId: "spec_1",
        clarificationId: "clar_1",
        affectedSection: "authority",
      }),
    ]));
  });

  it("projects specification validation issue codes from submit_specification metadata", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    (orchestrator.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      parts: textParts("Specification captured."),
      inputTokens: 10,
      outputTokens: 6,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      queued: false,
      toolExecutions: [{
        toolCallId: "tool-spec-draft",
        toolName: "submit_specification",
        input: {
          specificationId: "spec_2",
          title: "Draft spec",
        },
        durationMs: 1,
        success: true,
        output: "Specification submitted.",
        resultSummary: "Specification submitted with blocking issues.",
        metadata: {
          operation: "submit_specification",
          specificationId: "spec_2",
          specificationStatus: "draft",
          blockingIssueCodes: ["missing_non_goals", "vague_success_criteria"],
          issues: [
            { code: "missing_non_goals", field: "nonGoals", blocking: true },
            { code: "vague_success_criteria", field: "successCriteria", blocking: true },
          ],
        },
      }],
    } satisfies OrchestrateResult);

    const result = await processInboundMessage(makeBaseContext({
      executionMode: "plan",
      sessionRegistry: makeMockSessionRegistry(session),
      orchestrator,
    }));

    expect(result.ok).toBe(true);
    expect(session.sessionEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "specification_submitted",
        specificationId: "spec_2",
        status: "draft",
        issueCodes: ["missing_non_goals", "vague_success_criteria"],
        blockingIssueCodes: ["missing_non_goals", "vague_success_criteria"],
      }),
    ]));
  });

  it("does not record plan_submitted when submit_plan returns an error envelope", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    (orchestrator.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      parts: textParts("Plan blocked."),
      inputTokens: 8,
      outputTokens: 6,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      queued: false,
      toolExecutions: [{
        toolCallId: "tool-plan-failed",
        toolName: "submit_plan",
        input: {
          objective: "Invalid high-risk plan",
          riskClassification: "high",
          sourceSpecificationId: "spec_1",
          workGovernanceRecommendation: {
            posture: "orchestrate",
            workflowProfile: "architecture-change",
          },
        },
        durationMs: 1,
        success: false,
        output: "Plan plan_1 submitted with blocking validation issues.",
        resultSummary: "Plan blocked.",
        metadata: {
          operation: "submit_plan",
          planId: "plan_1",
          planStatus: "draft",
          blockingIssueCodes: ["missing_operator_decisions"],
          analysisReportId: "analysis_report_2",
          analysisStatus: "blocked",
          analysisHighestSeverity: "critical",
          analysisFindingCount: 1,
          analysisBlockingFindingCount: 1,
          analysisFindingIds: ["analysis_finding_9"],
          analysisBlockingFindingIds: ["analysis_finding_9"],
          analysisSummary: "1 critical finding blocks approval.",
          sourceSpecificationId: "spec_1",
        },
      }],
    } satisfies OrchestrateResult);

    const result = await processInboundMessage(makeBaseContext({
      executionMode: "plan",
      sessionRegistry: makeMockSessionRegistry(session),
      orchestrator,
    }));

    expect(result.ok).toBe(true);
    expect(session.sessionEvents.some((event) => event.kind === "plan_submitted")).toBe(false);
    expect(session.sessionEvents).toContainEqual(expect.objectContaining({
      kind: "plan_analysis_reported",
      reportId: "analysis_report_2",
      planId: "plan_1",
      specificationId: "spec_1",
      status: "blocked",
      highestSeverity: "critical",
      blockingFindingIds: ["analysis_finding_9"],
    }));
  });

  it("reports usage when billing is configured", async () => {
    const ctx = makeBaseContext({ billing: makeBillingConfig() });

    await processInboundMessage(ctx);

    // fetch called twice: budget check + usage report
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    const usageCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(usageCall[0]).toBe("https://api.example.com/users/{userId}/ai-usage");
    expect(usageCall[1]).toMatchObject({ method: "POST" });
    const usageBody = JSON.parse(usageCall[1].body as string);
    expect(usageBody.tenantId).toBe("test-tenant");
    expect(usageBody.messages).toBe(1);
    expect(usageBody.tokens).toBe(150); // 100 input + 50 output
    expect(usageBody.model).toBe("claude-sonnet-4-20250514");
  });

  it("emits MESSAGE_RECEIVED event when eventEmitter is present", async () => {
    const emitter = makeMockEventEmitter();
    const ctx = makeBaseContext({
      eventEmitter: emitter,
      tenantId: "tenant-1",
    });

    await processInboundMessage(ctx);

    expect(emitter.emit).toHaveBeenCalledTimes(1);
    expect(emitter.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "MESSAGE_RECEIVED",
        tenantId: "tenant-1",
        channel: "api",
        externalUserId: "user-1",
      }),
    );
  });

  it("creates session via sessionRegistry.getOrCreate", async () => {
    const sessionRegistry = makeMockSessionRegistry();
    const ctx = makeBaseContext({ sessionRegistry });

    await processInboundMessage(ctx);

    expect(sessionRegistry.getOrCreate).toHaveBeenCalledWith({
      appName: "test-app",
      tenantId: "test-tenant",
      userId: "user-1",
      systemPrompt: "You are a test assistant.",
      idleTimeoutMs: undefined,
    });
  });

  it("hydrates an expired persisted operator session before orchestration", async () => {
    const session = makeMockSession();
    const sessionRegistry = {
      getById: vi.fn().mockResolvedValue(undefined),
      getOrCreate: vi.fn().mockResolvedValue(session),
      save: vi.fn().mockResolvedValue(undefined),
    } as unknown as SessionRegistry;
    const orchestrator = makeMockOrchestrator();
    const resumeSessionHydrator = vi.fn().mockResolvedValue({
      rehydrated: true,
      messageCount: 4,
      reason: "transcript-store",
      sourceSequence: 12,
    });

    await processInboundMessage(makeBaseContext({
      sessionId: "persisted-session-1",
      sessionRegistry,
      orchestrator,
      resumeSessionHydrator,
    }));

    expect(sessionRegistry.getById).toHaveBeenCalledWith("persisted-session-1");
    expect(resumeSessionHydrator).toHaveBeenCalledWith({
      sessionId: "persisted-session-1",
      session,
    });
    expect(session.exactArtifacts).toContain("Runtime session rehydrated from transcript: 4 messages");
    expect(orchestrator.processMessage).toHaveBeenCalledWith(
      session,
      textParts("hello"),
      expect.anything(),
      undefined,
      undefined,
    );
  });

  it("builds session bootstrap prompt from tenant when systemPrompt is omitted", async () => {
    const sessionRegistry = makeMockSessionRegistry();
    const now = new Date().toISOString();
    const tenant: TenantConfig = {
      tenantId: "tenant-1",
      appName: "test-app",
      name: "Tenant One",
      enabled: true,
      tone: "friendly",
      language: "es-MX",
      createdAt: now,
      updatedAt: now,
    };
    const ctx = makeBaseContext({
      sessionRegistry,
      tenantId: "tenant-1",
      systemPrompt: undefined,
      tenant,
    });

    await processInboundMessage(ctx);

    expect(sessionRegistry.getOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: buildTenantSystemPrompt(tenant),
      }),
    );
  });

  it("passes tenantId to sessionRegistry.getOrCreate", async () => {
    const sessionRegistry = makeMockSessionRegistry();
    const ctx = makeBaseContext({ sessionRegistry, tenantId: "tenant-1" });

    await processInboundMessage(ctx);

    expect(sessionRegistry.getOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1" }),
    );
  });

  it("passes recalledMemory to orchestrator as governed context", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const ctx = makeBaseContext({
      orchestrator,
      sessionRegistry,
      recalledMemory: "Previous context here.",
    });

    await processInboundMessage(ctx);

    expect(orchestrator.processMessage).toHaveBeenCalledWith(
      expect.anything(),
      textParts("hello"),
      expect.objectContaining({
        content: "Previous context here.",
        audit: expect.objectContaining({ governor: "DefaultContextGovernor" }),
      }),
      undefined,
      undefined,
    );
  });

  it("passes callBuiltinTools to orchestrator", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const builtinTools = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>([
      ["test_tool", vi.fn().mockResolvedValue("result")],
    ]);
    const ctx = makeBaseContext({
      orchestrator,
      sessionRegistry,
      callBuiltinTools: builtinTools,
    });

    await processInboundMessage(ctx);

    expect(orchestrator.processMessage).toHaveBeenCalledWith(
      expect.anything(),
      textParts("hello"),
      expect.objectContaining({
        content: undefined,
        audit: expect.objectContaining({ governor: "DefaultContextGovernor" }),
      }),
      builtinTools,
      undefined,
    );
  });

  it("retrieves knowledge context in auto mode and appends it to governed context", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const knowledgePipeline = {
      retrieve: vi.fn().mockResolvedValue([
        { content: "Fact A" },
        { content: "Fact B" },
      ]),
    };
    const ctx = makeBaseContext({
      orchestrator,
      sessionRegistry,
      knowledgePipeline: knowledgePipeline as AdmittedTurnContext["knowledgePipeline"],
      knowledgeMode: "auto",
    });

    await processInboundMessage(ctx);

    expect(knowledgePipeline.retrieve).toHaveBeenCalledWith("hello", { topK: 5 });
    const governedContextContent = getGovernedContextContent(orchestrator);
    expect(governedContextContent).toContain("[Knowledge context]:");
    expect(governedContextContent).toContain("Fact A");
    expect(governedContextContent).toContain("Fact B");
  });

  it("resolves tenant agent context in pipeline and forwards tenant tool context to orchestrator call", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry(session);
    const emitter = makeMockEventEmitter();
    const callBuiltinTools = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>([
      ["mock_tool", vi.fn(async (input) => input)],
    ]);
    const toolDefinitions = [{
      name: "mock_tool",
      description: "Mock tool",
      inputSchema: {
        type: "object",
        properties: {
          value: { type: "string" },
        },
      },
      tags: new Set(["builtin"]),
    }];
    const capabilities = new Map<string, unknown>([
      ["mock_tool", { name: "mock_tool" }],
    ]);
    const toolAuthority = new Map<string, unknown>([
      ["mock_tool", {
        level: 2,
        allowed: true,
        requiresApproval: false,
        reason: "Audited execution",
      }],
    ]);
    const toolAllowlist = new Set(["mock_tool"]);
    const rateLimiter = {
      check: vi.fn().mockReturnValue({ allowed: true }),
      record: vi.fn(),
    };

    const resolveSpy = vi.spyOn(agentResolver, "resolveAgentContextAsync").mockResolvedValue({
      systemPrompt: "Tenant-specific system prompt",
      tenantToolContext: {
        callBuiltinTools,
        toolDefinitions,
        capabilities,
        toolAuthority,
        toolAuthorityClassification: undefined,
        integrationAuthorityRollup: undefined,
        toolAllowlist,
        rateLimiter,
        maxToolRounds: undefined,
      },
      activeAgentId: "agent-support",
      activeAgentName: "Support Agent",
      routingResult: {
        agentId: "agent-support",
        confidence: 0.88,
        tier: "rule",
      },
      previousAgentId: "agent-router",
      isHandoff: true,
      handoffBrief: "handoff brief",
    });

    const tenant = {
      tenantId: "tenant-1",
      displayName: "Tenant One",
    } as AdmittedTurnContext["tenant"];
    const ctx = makeBaseContext({
      orchestrator,
      sessionRegistry,
      eventEmitter: emitter,
      tenantId: "_default",
      tenant,
    });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(orchestrator.registerTools).toHaveBeenCalledWith(toolDefinitions);
    expect(orchestrator.processMessage).toHaveBeenCalledWith(
      expect.anything(),
      textParts("hello"),
      expect.objectContaining({
        content: undefined,
        audit: expect.objectContaining({ governor: "DefaultContextGovernor" }),
      }),
      callBuiltinTools,
      expect.objectContaining({
        tenantId: "tenant-1",
        toolAuthority,
        toolAllowlist,
        rateLimiter,
        additionalTools: toolDefinitions,
        perCallCapabilities: capabilities,
      }),
    );
    expect(session.setSystemPrompt).toHaveBeenCalledWith("Tenant-specific system prompt");
    expect(session.setActiveAgent).toHaveBeenCalledWith("agent-support", "handoff brief");

    if (result.ok) {
      expect(result.result.activeAgentId).toBe("agent-support");
    }
    const emitted = (emitter.emit as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(emitted).toContainEqual(expect.objectContaining({
      eventType: "AGENT_ROUTED",
      tenantId: "tenant-1",
      activeAgentId: "agent-support",
      activeAgentName: "Support Agent",
      routingTier: "rule",
      routingConfidence: 0.88,
    }));

    resolveSpy.mockRestore();
  });

  it("prepends [User Context] block first in governed context when userContext is present", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const ctx = makeBaseContext({
      orchestrator,
      sessionRegistry,
      userContext: { role: "admin" },
      recalledMemory: "Previous context here.",
    });

    await processInboundMessage(ctx);

    const governedContextContent = getGovernedContextContent(orchestrator);
    expect(governedContextContent).toBeDefined();
    expect(governedContextContent.startsWith("[User Context]:")).toBe(true);
    expect(governedContextContent).toContain("Previous context here.");
  });

  it("omits [User Context] block from governed context when userContext is absent", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const ctx = makeBaseContext({
      orchestrator,
      sessionRegistry,
      recalledMemory: "Previous context here.",
    });

    await processInboundMessage(ctx);

    const governedContextContent = getGovernedContextContent(orchestrator);
    expect(governedContextContent).not.toContain("[User Context]");
  });

  it("preserves admitted-turn context projection ordering and grounding directive application", async () => {
    const supportSpy = vi.spyOn(runtimeArtifacts, "readRuntimeSupportArtifactsDetailed").mockReturnValue({
      content: "cached runtime summary",
      supportArtifactCount: 0,
      supportArtifactSources: [],
      fallbackLabel: undefined,
      usedCachedSupport: false,
      selectionReason: "none",
      decision: {
        resumeStrategy: "none",
        cachedResumeSignalCount: 0,
      },
    } as ReturnType<typeof runtimeArtifacts.readRuntimeSupportArtifactsDetailed>);
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const ctx = makeBaseContext({
      orchestrator,
      sessionRegistry,
      userContext: { role: "admin" },
      recalledMemory: "recalled memory",
      knowledgeContext: "knowledge context",
      contactContext: "contact context",
      groundingMode: "strict",
    });

    await processInboundMessage(ctx);

    const governedContextContent = getGovernedContextContent(orchestrator);
    expect(governedContextContent).toBeDefined();
    expect(governedContextContent).toContain("[User Context]:\nrole: admin");
    expect(governedContextContent).toContain("cached runtime summary");
    expect(governedContextContent).toContain("recalled memory");
    expect(governedContextContent).toContain("knowledge context");
    expect(governedContextContent).toContain("contact context");
    expect(governedContextContent).toMatch(
      /\[User Context\]:\nrole: admin[\s\S]*cached runtime summary[\s\S]*recalled memory[\s\S]*knowledge context[\s\S]*contact context/,
    );
    expect(governedContextContent).toContain("--- Grounding Rules ---");

    supportSpy.mockRestore();
  });

  it("governs admitted-turn context under the core budget instead of replaying oversized memory", async () => {
    const supportSpy = vi.spyOn(runtimeArtifacts, "readRuntimeSupportArtifactsDetailed").mockReturnValue({
      content: "cached runtime summary",
      supportArtifactCount: 0,
      supportArtifactSources: [],
      fallbackLabel: undefined,
      usedCachedSupport: false,
      selectionReason: "none",
      decision: {
        resumeStrategy: "none",
        cachedResumeSignalCount: 0,
      },
    } as ReturnType<typeof runtimeArtifacts.readRuntimeSupportArtifactsDetailed>);
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const oversizedMemory = `oversized-memory-${"x".repeat(12_000)}`;
    const ctx = makeBaseContext({
      orchestrator,
      sessionRegistry,
      recalledMemory: oversizedMemory,
      knowledgeContext: "compact knowledge context",
    });

    const result = await processInboundMessage(ctx);

    const governedContextContent = getGovernedContextContent(orchestrator);
    expect(governedContextContent).toBeDefined();
    expect(governedContextContent).toContain("cached runtime summary");
    expect(governedContextContent).toContain("compact knowledge context");
    expect(governedContextContent).not.toContain("oversized-memory-");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.contextAudit).toMatchObject({
        governor: "DefaultContextGovernor",
        overflow: true,
        overflowReason: "budget-cap",
      });
      expect(result.result.contextAudit?.blocks.some((block) => (
        block.decision === "deferred"
        && block.source === "runtime-recalled-memory"
        && block.reason === "budget-cap"
      ))).toBe(true);
    }

    supportSpy.mockRestore();
  });

  it("routes active skill instructions through governed context instead of perCallConfig.skillInstructions", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const skillRegistry = new SkillRegistry();
    skillRegistry.registerFull(makeSkillConfig());
    const ctx = makeBaseContext({
      orchestrator,
      sessionRegistry,
      skillRegistry,
      activeSkills: ["runtime-governed-skill"],
      perCallConfig: {
        tenantId: "tenant-override",
      },
    });

    const result = await processInboundMessage(ctx);

    const callArgs = (orchestrator.processMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    const governedContextContent = getGovernedContextContent(orchestrator);
    const perCallConfigArg = callArgs[4] as Record<string, unknown> | undefined;

    expect(governedContextContent).toBeDefined();
    expect(governedContextContent).toContain("Skill");
    expect(governedContextContent).toContain("name: runtime-governed-skill");
    expect(governedContextContent).toContain("Always verify the runtime customer record before responding.");
    expect(perCallConfigArg).toBeDefined();
    expect(perCallConfigArg).not.toHaveProperty("skillInstructions");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.contextAudit?.blocks).toContainEqual(expect.objectContaining({
        kind: "procedural",
        source: "runtime-skill:memory://runtime-governed-skill",
      }));
    }
  });

  it("defers oversized active skills under budget pressure and records the procedural deferral in contextAudit", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const skillRegistry = new SkillRegistry();
    const oversizedInstructionMarker = "oversized-runtime-skill-marker";
    skillRegistry.registerFull(makeSkillConfig({
      name: "oversized-runtime-skill",
      filePath: "memory://oversized-runtime-skill",
      instructions: `${oversizedInstructionMarker}-${"x".repeat(12_000)}`,
    }));
    const ctx = makeBaseContext({
      orchestrator,
      sessionRegistry,
      skillRegistry,
      activeSkills: ["oversized-runtime-skill"],
      userContext: { role: "admin" },
      knowledgeContext: "compact knowledge context",
    });

    const result = await processInboundMessage(ctx);

    const governedContextContent = getGovernedContextContent(orchestrator);

    expect(governedContextContent).toBeDefined();
    expect(governedContextContent).toContain("[User Context]:");
    expect(governedContextContent).toContain("compact knowledge context");
    expect(governedContextContent).not.toContain(oversizedInstructionMarker);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.contextAudit).toMatchObject({
        governor: "DefaultContextGovernor",
        overflow: true,
        overflowReason: "budget-cap",
      });
      expect(result.result.contextAudit?.blocks).toContainEqual(expect.objectContaining({
        kind: "procedural",
        source: "runtime-skill:memory://oversized-runtime-skill",
        decision: "deferred",
        reason: "budget-cap",
      }));
    }
  });

  it("injects coordination provider candidates into governed context and audits them as coordination blocks", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const coordinationContextProvider = vi.fn().mockResolvedValue(
      coordinationStateToContextCandidates({
        crossAgentMemory: [{
          id: "handoff-1",
          agentId: "agent-ops",
          role: "ops",
          summary: "Escalation stays with billing specialist.",
          updatedAt: "2026-04-27T10:00:00.000Z",
        }],
      }),
    );
    const ctx = {
      ...makeBaseContext({
        orchestrator,
        sessionRegistry,
      }),
      coordinationContextProvider,
    } as AdmittedTurnContext;

    const result = await processInboundMessage(ctx);

    expect(coordinationContextProvider).toHaveBeenCalledTimes(1);
    const governedContextContent = getGovernedContextContent(orchestrator);
    expect(governedContextContent).toBeDefined();
    expect(governedContextContent).toContain("Cross-agent memory");
    expect(governedContextContent).toContain("summary: Escalation stays with billing specialist.");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const coordinationBlock = result.result.contextAudit?.blocks.find((block) => block.kind === "coordination");
      expect(coordinationBlock).toEqual(expect.objectContaining({
        decision: "admitted",
      }));
      expect(coordinationBlock?.source).toContain("runtime-coordination-provider:0");
    }
  });

  it("defers oversized coordination candidates under budget pressure while preserving user and knowledge context", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const oversizedCoordinationMarker = "oversized-coordination-marker";
    const coordinationContextProvider = vi.fn().mockResolvedValue([
      {
        kind: "coordination" as const,
        source: "runtime-cross-agent-memory:oversized-handoff",
        content: `Cross-agent memory\nsummary: ${oversizedCoordinationMarker}-${"x".repeat(12_000)}`,
        score: 0.5,
      },
    ]);
    const ctx = {
      ...makeBaseContext({
        orchestrator,
        sessionRegistry,
        userContext: { role: "admin" },
        knowledgeContext: "compact knowledge context",
      }),
      coordinationContextProvider,
    } as AdmittedTurnContext;

    const result = await processInboundMessage(ctx);

    expect(coordinationContextProvider).toHaveBeenCalledTimes(1);
    const governedContextContent = getGovernedContextContent(orchestrator);

    expect(governedContextContent).toBeDefined();
    expect(governedContextContent).toContain("[User Context]:");
    expect(governedContextContent).toContain("compact knowledge context");
    expect(governedContextContent).not.toContain(oversizedCoordinationMarker);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.contextAudit).toMatchObject({
        governor: "DefaultContextGovernor",
        overflow: true,
        overflowReason: "budget-cap",
      });
      const coordinationBlock = result.result.contextAudit?.blocks.find((block) => block.kind === "coordination");
      expect(coordinationBlock).toEqual(expect.objectContaining({
        decision: "deferred",
        reason: "budget-cap",
      }));
      expect(coordinationBlock?.source).toContain("runtime-coordination-provider:0");
    }
  });

  it("normalizes coordination provider candidates so they cannot force admission or relabel audit kind", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const forcedAdmissionMarker = "forced-coordination-admission-marker";
    const coordinationContextProvider = vi.fn().mockResolvedValue([
      {
        kind: "memory" as const,
        source: "runtime-cross-agent-memory:spoofed-first-party-source",
        content: `Cross-agent memory\nsummary: ${forcedAdmissionMarker}-${"x".repeat(12_000)}`,
        required: true,
        score: 1,
        estimatedTokens: 1,
      },
    ]);
    const ctx = {
      ...makeBaseContext({
        orchestrator,
        sessionRegistry,
        knowledgeContext: "compact knowledge context",
      }),
      coordinationContextProvider,
    } as AdmittedTurnContext;

    const result = await processInboundMessage(ctx);

    const governedContextContent = getGovernedContextContent(orchestrator);
    expect(governedContextContent).toContain("compact knowledge context");
    expect(governedContextContent).not.toContain(forcedAdmissionMarker);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const coordinationBlock = result.result.contextAudit?.blocks.find((block) => block.kind === "coordination");
      expect(coordinationBlock).toEqual(expect.objectContaining({
        required: false,
        decision: "deferred",
      }));
      expect(coordinationBlock?.source).toContain("runtime-coordination-provider:0");
    }
  });

  it("drops non-finite coordination provider scores before governor ranking", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const coordinationContextProvider = vi.fn().mockResolvedValue([
      {
        kind: "coordination" as const,
        source: "runtime-cross-agent-memory:bad-score",
        content: "Cross-agent memory\nsummary: Provider score must not bypass ranking.",
        score: Number.POSITIVE_INFINITY,
      },
    ]);
    const ctx = {
      ...makeBaseContext({
        orchestrator,
        sessionRegistry,
      }),
      coordinationContextProvider,
    } as AdmittedTurnContext;

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const coordinationBlock = result.result.contextAudit?.blocks.find((block) => block.kind === "coordination");
      expect(coordinationBlock).toEqual(expect.objectContaining({
        baseScore: 0,
        effectiveScore: 0,
      }));
    }
  });

  it("fails closed when the coordination provider throws without leaking fallback text into model context", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const rawFailureMarker = "coordination provider raw failure text";
    const coordinationContextProvider = vi.fn().mockRejectedValue(new Error(rawFailureMarker));
    const ctx = {
      ...makeBaseContext({
        orchestrator,
        sessionRegistry,
        recalledMemory: "safe recalled memory",
      }),
      coordinationContextProvider,
    } as AdmittedTurnContext;

    const result = await processInboundMessage(ctx);

    expect(coordinationContextProvider).toHaveBeenCalledTimes(1);
    expect(orchestrator.processMessage).toHaveBeenCalledTimes(1);
    const governedContextContent = getGovernedContextContent(orchestrator);
    expect(governedContextContent).toContain("safe recalled memory");
    expect(governedContextContent).not.toContain(rawFailureMarker);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.contextAudit?.blocks.some((block) => block.kind === "coordination")).toBe(false);
      expect(result.result.contextAudit?.coordinationProviderFailures).toContainEqual({
        source: "runtime-coordination-provider",
        reason: "provider-error",
      });
    }
  });

  it("fails closed when the coordination provider returns malformed candidates without leaking raw markers into model context", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const rawFailureMarker = "coordination-provider-raw-marker";
    const coordinationContextProvider = vi.fn().mockResolvedValue([
      {
        kind: "coordination" as const,
        source: `runtime-cross-agent-memory:${rawFailureMarker}`,
        content: { summary: rawFailureMarker },
        score: 0.9,
      },
    ]);
    const ctx = {
      ...makeBaseContext({
        orchestrator,
        sessionRegistry,
        recalledMemory: "safe recalled memory",
      }),
      coordinationContextProvider,
    } as AdmittedTurnContext;

    const result = await processInboundMessage(ctx);

    expect(coordinationContextProvider).toHaveBeenCalledTimes(1);
    expect(orchestrator.processMessage).toHaveBeenCalledTimes(1);
    const governedContextContent = getGovernedContextContent(orchestrator);
    expect(governedContextContent).toContain("safe recalled memory");
    expect(governedContextContent).not.toContain(rawFailureMarker);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.contextAudit?.blocks.some((block) => block.kind === "coordination")).toBe(false);
      expect(result.result.contextAudit?.coordinationProviderFailures).toEqual(expect.arrayContaining([
        expect.objectContaining({
          source: "runtime-coordination-provider",
          reason: expect.stringMatching(/validation|error/),
        }),
      ]));
      expect(JSON.stringify(result.result.contextAudit?.coordinationProviderFailures)).not.toContain(rawFailureMarker);
    }
  });

  it("preserves sanitized coordination provenance in the audit block without trusting provider source strings", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const coordinationContextProvider = vi.fn().mockResolvedValue([
      {
        kind: "coordination" as const,
        source: "runtime-cross-agent-memory:handoff-123",
        content: "Cross-agent memory\nsummary: Billing handoff remains active.",
        score: 0.7,
      },
    ]);
    const ctx = {
      ...makeBaseContext({
        orchestrator,
        sessionRegistry,
      }),
      coordinationContextProvider,
    } as AdmittedTurnContext;

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const coordinationBlock = result.result.contextAudit?.blocks.find((block) => block.kind === "coordination");
      expect(coordinationBlock).toBeDefined();
      expect(coordinationBlock?.decision).toBe("admitted");
      expect(coordinationBlock?.source).toContain("runtime-coordination-provider:0");
      expect(coordinationBlock?.source).toContain("handoff-123");
      expect(coordinationBlock?.source).not.toBe("runtime-cross-agent-memory:handoff-123");
    }
  });

  it("uses tenantId for billing", async () => {
    const ctx = makeBaseContext({
      billing: makeBillingConfig(),
      tenantId: "tenant-1",
    });

    await processInboundMessage(ctx);

    // Budget check should use tenantId
    const budgetCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(budgetCall[0]).toBe("https://api.example.com/users/tenant-1/ai-budget");
  });

  it("allow egress decision keeps assistant response unchanged", async () => {
    const ctx = makeBaseContext({
      orchestrator: {
        processMessage: vi.fn().mockResolvedValue({
          parts: textParts("original assistant response"),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
        } satisfies OrchestrateResult),
        model: "claude-sonnet-4-20250514",
      } as unknown as RuntimeSessionOrchestrator,
      evaluateEgressPermission: vi.fn().mockResolvedValue("allow"),
    });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.parts).toEqual(textParts("original assistant response"));
    }
  });

  it("deny egress decision replaces returned assistant text with safe fallback", async () => {
    const emitter = makeMockEventEmitter();
    const ctx = makeBaseContext({
      eventEmitter: emitter,
      orchestrator: {
        processMessage: vi.fn().mockResolvedValue({
          parts: textParts("sensitive assistant response"),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
          escalation: { reason: "custom", confidence: 0.9, detail: "policy escalation" },
          contextSummary: "sensitive escalation summary",
          toolExecutions: [{
            toolName: "lookup_customer",
            durationMs: 12,
            success: true,
            resultSummary: "sensitive tool result",
          }],
        } satisfies OrchestrateResult),
        model: "claude-sonnet-4-20250514",
      } as unknown as RuntimeSessionOrchestrator,
      evaluateEgressPermission: vi.fn().mockResolvedValue("deny"),
    });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.parts).toEqual(textParts("I cannot share that response."));
      expect(result.result.contextSummary).toBeUndefined();
      expect(result.result.toolExecutions?.[0]?.resultSummary).toBe("");
    }

    const emitted = (emitter.emit as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    const escalationEvent = emitted.find((event) => event.eventType === "ESCALATION_DETECTED");
    expect(escalationEvent?.summary).toBeUndefined();
    const toolEvent = emitted.find((event) => event.eventType === "TOOL_EXECUTED");
    expect(toolEvent?.resultSummary).toBeUndefined();
  });

  it("redact egress decision redacts returned assistant text and text-bearing event summaries", async () => {
    const emitter = makeMockEventEmitter();
    const ctx = makeBaseContext({
      eventEmitter: emitter,
      orchestrator: {
        processMessage: vi.fn().mockResolvedValue({
          parts: textParts("sensitive assistant response"),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
          escalation: { reason: "custom", confidence: 0.9, detail: "policy escalation" },
          contextSummary: "sensitive escalation summary",
          toolExecutions: [{
            toolName: "lookup_customer",
            durationMs: 12,
            success: true,
            resultSummary: "sensitive tool result",
          }],
        } satisfies OrchestrateResult),
        model: "claude-sonnet-4-20250514",
      } as unknown as RuntimeSessionOrchestrator,
      evaluateEgressPermission: vi.fn().mockResolvedValue("redact"),
    });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.parts).toEqual(textParts("[REDACTED]"));
      expect(result.result.contextSummary).toBe("[REDACTED]");
      expect(result.result.toolExecutions?.[0]?.resultSummary).toBe("[REDACTED]");
    }

    const emitted = (emitter.emit as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    const escalationEvent = emitted.find((event) => event.eventType === "ESCALATION_DETECTED");
    expect(escalationEvent?.summary).toBe("[REDACTED]");
    const toolEvent = emitted.find((event) => event.eventType === "TOOL_EXECUTED");
    expect(toolEvent?.resultSummary).toBe("[REDACTED]");
  });

  it("captures approval transitions from runtime event bus into canonical turn artifacts", async () => {
    const session = makeMockSession();
    const eventBus = new EventBus();
    const orchestrator = {
      processMessage: vi.fn().mockImplementation(async () => {
        eventBus.emit({
          type: "approval_requested",
          approvalId: "approval-main",
          taskId: "",
          description: "Need confirmation",
          timestamp: new Date(),
          sessionId: session.id,
        });
        eventBus.emit({
          type: "approval_requested",
          approvalId: "approval-other",
          taskId: "",
          description: "Other session request",
          timestamp: new Date(),
          sessionId: "other-session",
        });
        eventBus.emit({
          type: "approval_received",
          approvalId: "approval-main",
          taskId: "",
          approved: false,
          reason: "Denied by policy",
          timestamp: new Date(),
          sessionId: session.id,
        });
        return {
          parts: textParts("ok"),
          inputTokens: 7,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
        } satisfies OrchestrateResult;
      }),
      model: "claude-sonnet-4-20250514",
      eventBus,
    } as unknown as RuntimeSessionOrchestrator;
    const sessionRegistry = makeMockSessionRegistry(session);
    const ctx = makeBaseContext({ orchestrator, sessionRegistry });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    const artifacts = (session as unknown as { exactArtifacts: string[] }).exactArtifacts;
    expect(artifacts).toContain(`Approval requested: approval-main - ${session.id} (Need confirmation)`);
    expect(artifacts).toContain(`Approval rejected: approval-main - ${session.id} (Denied by policy)`);
    expect(artifacts).not.toContain("Approval requested: approval-other - other-session (Other session request)");
  });

  it("captures tool_authorized decisions scoped to current session into canonical turn artifacts", async () => {
    const session = makeMockSession();
    const eventBus = new EventBus();
    const orchestrator = {
      processMessage: vi.fn().mockImplementation(async () => {
        eventBus.emit({
          type: "tool_authorized",
          toolName: "read_file",
          level: 1,
          allowed: true,
          reason: "Read-only tool, auto-execute",
          timestamp: new Date(),
          sessionId: session.id,
        });
        eventBus.emit({
          type: "tool_authorized",
          toolName: "delete_file",
          level: 4,
          allowed: false,
          reason: "Destructive operation denied",
          timestamp: new Date(),
          sessionId: "other-session",
        });
        return {
          parts: textParts("ok"),
          inputTokens: 7,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
        } satisfies OrchestrateResult;
      }),
      model: "claude-sonnet-4-20250514",
      eventBus,
    } as unknown as RuntimeSessionOrchestrator;
    const sessionRegistry = makeMockSessionRegistry(session);
    const ctx = makeBaseContext({ orchestrator, sessionRegistry });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    const artifacts = (session as unknown as { exactArtifacts: string[] }).exactArtifacts;
    expect(artifacts).toContain("Tool authority: read_file L1 allow (Read-only tool, auto-execute)");
    expect(artifacts).not.toContain("Tool authority: delete_file L4 deny (Destructive operation denied)");
  });

  it("persists structured file changes from tool executions into canonical turn artifacts", async () => {
    const session = makeMockSession();
    const orchestrator = {
      processMessage: vi.fn().mockResolvedValue({
        parts: textParts("updated"),
        inputTokens: 9,
        outputTokens: 4,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        queued: false,
        toolExecutions: [{
          toolName: "write",
          durationMs: 12,
          success: true,
          resultSummary: "Wrote file",
          fileChanges: [{ path: "C:/workspace/src/demo.txt", changeType: "modified" }],
        }],
      } satisfies OrchestrateResult),
      model: "claude-sonnet-4-20250514",
    } as unknown as RuntimeSessionOrchestrator;
    const sessionRegistry = makeMockSessionRegistry(session);
    const ctx = makeBaseContext({ orchestrator, sessionRegistry });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    const artifacts = (session as unknown as { exactArtifacts: string[] }).exactArtifacts;
    expect(artifacts).toContain("File changed: C:/workspace/src/demo.txt");
  });

  it("persists dangerous-command outcomes into canonical turn artifacts", async () => {
    const session = makeMockSession();
    const orchestrator = {
      processMessage: vi.fn().mockResolvedValue({
        parts: textParts("blocked"),
        inputTokens: 9,
        outputTokens: 4,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        queued: false,
        toolExecutions: [
          {
            toolName: "bash",
            durationMs: 0,
            success: false,
            resultSummary: "Dangerous command blocked: Detected destructive Unix command pattern. (destructive_unix)",
          },
          {
            toolName: "bash",
            durationMs: 0,
            success: false,
            resultSummary: "Command requires approval: Command contains shell expansion/substitution and requires approval. (ambiguous_expansion)",
          },
        ],
      } satisfies OrchestrateResult),
      model: "claude-sonnet-4-20250514",
    } as unknown as RuntimeSessionOrchestrator;
    const sessionRegistry = makeMockSessionRegistry(session);
    const ctx = makeBaseContext({ orchestrator, sessionRegistry });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    const artifacts = (session as unknown as { exactArtifacts: string[] }).exactArtifacts;
    expect(artifacts).toContain(
      "Dangerous command deny: bash (destructive_unix) Detected destructive Unix command pattern.",
    );
    expect(artifacts).toContain(
      "Dangerous command ask: bash (ambiguous_expansion) Command contains shell expansion/substitution and requires approval.",
    );
  });

  it("captures canonical session ledger events in turn order from runtime bus emissions", async () => {
    const session = makeMockSession();
    const eventBus = new EventBus();
    const startedAt = new Date("2026-04-23T19:00:00.000Z");
    const orchestrator = {
      processMessage: vi.fn().mockImplementation(async () => {
        eventBus.emit({
          type: "model_routed",
          provider: "codex-oauth",
          model: "gpt-5.4-mini",
          routingTier: "default",
          reason: "configured",
          timestamp: new Date("2026-04-23T19:00:01.000Z"),
          sessionId: session.id,
        });
        eventBus.emit({
          type: "tool_called",
          toolName: "write",
          toolInput: { filePath: "src/demo.txt", content: "hello" },
          timestamp: new Date("2026-04-23T19:00:02.000Z"),
          sessionId: session.id,
        });
        eventBus.emit({
          type: "tool_result",
          toolName: "write",
          durationMs: 12,
          success: true,
          resultSummary: "Wrote src/demo.txt",
          timestamp: new Date("2026-04-23T19:00:03.000Z"),
          sessionId: session.id,
        });
        eventBus.emit({
          type: "cost_update",
          provider: "codex-oauth",
          model: "gpt-5.4-mini",
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          totalCostUsd: 0,
          byRoleModel: {},
          timestamp: new Date("2026-04-23T19:00:04.000Z"),
          sessionId: session.id,
        });
        eventBus.emit({
          type: "error",
          code: "MODE_B_ERROR",
          message: "Synthetic runtime error",
          taskId: null,
          timestamp: new Date("2026-04-23T19:00:05.000Z"),
          sessionId: session.id,
        });
        return {
          parts: textParts("done"),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
          toolExecutions: [{
            toolName: "write",
            durationMs: 12,
            success: true,
            resultSummary: "Wrote src/demo.txt",
            fileChanges: [{ path: "src/demo.txt", changeType: "modified", linesAdded: 3, linesRemoved: 1 }],
          }],
        } satisfies OrchestrateResult;
      }),
      model: "gpt-5.4-mini",
      eventBus,
    } as unknown as RuntimeSessionOrchestrator;
    const sessionRegistry = makeMockSessionRegistry(session);

    const result = await processInboundMessage(makeBaseContext({ orchestrator, sessionRegistry }));

    expect(result.ok).toBe(true);
    const ledger = (session as unknown as { sessionEvents: Array<Record<string, unknown>> }).sessionEvents;
    expect(ledger.map((event) => event.kind)).toEqual([
      "turn_started",
      "user_message",
      "continuity_decided",
      "provider_routed",
      "tool_call_started",
      "tool_call_completed",
      "cost_updated",
      "error_recorded",
      "file_changed",
      "assistant_message",
      "turn_completed",
    ]);
    expect(ledger.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(ledger[3]).toMatchObject({
      kind: "provider_routed",
      provider: {
        provider: "codex-oauth",
        model: "gpt-5.4-mini",
      },
    });
    expect(ledger[4]).toMatchObject({
      kind: "tool_call_started",
      toolName: "write",
      input: { filePath: "src/demo.txt", content: "hello" },
    });
    expect(ledger[8]).toMatchObject({
      kind: "file_changed",
      change: {
        path: "src/demo.txt",
        changeType: "updated",
        linesAdded: 3,
        linesRemoved: 1,
      },
    });
    expect(ledger[9]).toMatchObject({
      kind: "assistant_message",
      content: "done",
    });
  });
});
