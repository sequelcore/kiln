import { describe, expect, it } from "vitest";
import {
  formatOperatorEventValue,
  operatorEventTargetsConversation,
  operatorEventTargetsSurface,
  presentOperatorEventPayload,
} from "../src/operator-event-presentation.js";
import { managedAccountLeaseSettledEvent } from "./fixtures/managed-account-lease.js";

const turnPolicy = {
  policyId: "kiln.test.turn-convergence",
  configurationHash: `sha256:${"a".repeat(64)}`,
  providerRequests: 10,
  toolRounds: 8,
  toolCalls: 24,
  cumulativeInputTokens: 256_000,
  elapsedMs: 600_000,
  activeMs: 600_000,
  recoveryAttempts: 3,
  consecutiveNoProgressSteps: 3,
} as const;

function turnPayload(disposition: Record<string, unknown>): Record<string, unknown> {
  return {
    routedProvider: "codex-oauth",
    routedModel: "gpt-5.4-mini",
    runtimeContinuity: {
      strategy: "fallback-replay",
      selectionReason: "no-sources",
    },
    authorityStatus: {
      effective: "destructive",
    },
    inputTokens: 1398,
    outputTokens: 11,
    convergence: {
      policy: turnPolicy,
      progressEvidence: [],
    },
    ...disposition,
  };
}

describe("operator event presentation", () => {
  it("projects Dafny observations as formal verification evidence with proof effort", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "formal-1",
      toolName: "formal_verify",
      output: JSON.stringify({
        output: "1/2 correctness checks discharged.",
        isError: false,
        metadata: {
          schema: "kiln.formal-verification-observation/v3",
          toolName: "formal_verify",
          kind: "formal_verification",
          verifier: { name: "dafny", version: "4.11.0" },
          artifact: { contentDigest: digest },
          subjects: [{ path: "policy.dfy", contentDigest: digest }],
          checks: [
            { symbol: "Allow", check: "correctness", outcome: "proved", durationMs: 12, resourceCount: 1_840 },
            { symbol: "Deny", check: "correctness", outcome: "refuted", detail: "postcondition might not hold", durationMs: 8, resourceCount: 920 },
          ],
          establishes: [],
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "verification",
      title: "Dafny formal verification",
      verification: {
        kind: "formal",
        engine: { name: "dafny", version: "4.11.0" },
        candidate: { digest, subjects: [{ path: "policy.dfy", contentDigest: digest }] },
        outcome: "refuted",
        totals: { total: 2, proved: 1, refuted: 1, unresolved: 0 },
        checks: [
          { label: "Allow", outcome: "proved", durationMs: 12, resourceCount: 1_840 },
          { label: "Deny", outcome: "refuted", detail: "postcondition might not hold", durationMs: 8, resourceCount: 920 },
        ],
        authority: { kind: "evidence_only", establishes: [] },
      },
    });
  });

  it("projects Oxlint observations as static verification evidence", () => {
    const digest = `sha256:${"b".repeat(64)}`;
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "static-1",
      toolName: "static_analyze",
      output: JSON.stringify({
        output: "1 diagnostic.",
        isError: false,
        metadata: {
          schema: "kiln.static-analysis-observation/v1",
          toolName: "static_analyze",
          kind: "static_analysis",
          analyzer: { name: "oxlint", version: "1.80.0" },
          profile: { id: "oxlint.correctness+suspicious/v1", rulesAnalyzed: 245 },
          outcome: "violations",
          subjects: [{ path: "policy.ts", contentDigest: digest }],
          diagnostics: [{ rule: "no-unused-vars", severity: "warning", message: "Unused parameter", file: "policy.ts", line: 4, column: 8 }],
          establishes: [],
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "verification",
      title: "Oxlint static analysis",
      verification: {
        kind: "static",
        engine: { name: "oxlint", version: "1.80.0" },
        candidate: { digest, subjects: [{ path: "policy.ts", contentDigest: digest }] },
        outcome: "violations",
        profile: { id: "oxlint.correctness+suspicious/v1", rulesAnalyzed: 245 },
        diagnostics: [{ rule: "no-unused-vars", severity: "warning", message: "Unused parameter", file: "policy.ts", line: 4, column: 8 }],
        authority: { kind: "evidence_only", establishes: [] },
      },
    });
  });

  it("projects Gentle status as inferential review evidence without inventing findings", () => {
    const digest = `sha256:${"c".repeat(64)}`;
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "gentle-1",
      toolName: "gentle_review",
      output: JSON.stringify({
        output: "Review status observed.",
        isError: false,
        metadata: {
          schema: "kiln.gentle-review-observation/v2",
          toolName: "gentle_review",
          kind: "inferential_review",
          engine: { name: "gentle-ai", version: "2.5.0-rc.1", releaseChannel: "prerelease", executableDigest: digest },
          contract: { id: "gentle-ai.review-integration/v2", protocol: { major: 2, minor: 2 }, capabilitiesSchema: "gentle-ai.review-integration.capabilities/v2.2", statusSchema: "gentle-ai.review-integration.status/v5" },
          candidate: { targetIdentity: digest, projection: "workspace", baseTree: "a".repeat(40), candidateTree: "b".repeat(40), pathsDigest: `sha256:${"d".repeat(64)}`, paths: ["policy.ts"] },
          authority: { lineageId: "review-demo", state: "reviewing", generation: 1, revision: digest },
          outcome: { applicability: "current_target", action: "collect", replayability: "exact", nextTransition: { kind: "collect", reasonCode: "review_pending" } },
          findings: [],
          establishes: [],
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "verification",
      title: "Gentle AI review status",
      verification: {
        kind: "inferential",
        engine: { name: "gentle-ai", version: "2.5.0-rc.1" },
        candidate: { digest, subjects: [{ path: "policy.ts" }] },
        outcome: { applicability: "current_target", action: "collect", replayability: "exact" },
        transaction: { lineageId: "review-demo", state: "reviewing", generation: 1, revision: digest },
        authority: { kind: "evidence_only", establishes: [] },
      },
    });
    expect(JSON.stringify(presentation.toolPresentation)).not.toContain("findings");
  });

  it("projects deterministic quality profiles without inventing an overall pass", () => {
    const digest = `sha256:${"d".repeat(64)}`;
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "quality-1",
      toolName: "quality_analyze",
      output: JSON.stringify({ output: "3 configured quality diagnostics.", isError: false, metadata: {
        schema: "kiln.quality-analysis-observation/v1",
        toolName: "quality_analyze",
        kind: "static_quality_analysis",
        analyzer: { name: "kiln-quality", version: "3.0.0-beta.1", parser: { name: "@typescript/typescript6", version: "6.0.3" } },
        artifact: { kind: "typescript", path: "policy.ts", contentDigest: digest },
        outcome: "diagnostics",
        profiles: [
          {
            name: "type-integrity",
            revision: "v1",
            rules: [{ name: "chained-type-assertion", revision: "v1" }, { name: "widen-then-assert", revision: "v1" }],
            diagnostics: [{ rule: { name: "widen-then-assert", revision: "v1" }, message: "Avoid widening through unknown before asserting a narrower type.", line: 2, column: 15 }],
          },
          {
            name: "complexity",
            revision: "v1",
            rules: [{ name: "high-cyclomatic-complexity", revision: "v1" }],
            diagnostics: [{ rule: { name: "high-cyclomatic-complexity", revision: "v1" }, message: "route has cyclomatic complexity 21; review its control flow.", line: 4, column: 1 }],
          },
          {
            name: "test-integrity",
            revision: "v1",
            rules: [{ name: "focused-test", revision: "v1" }, { name: "empty-test-body", revision: "v1" }],
            diagnostics: [{ rule: { name: "focused-test", revision: "v1" }, message: "Focused Vitest call excludes other collected tests.", line: 8, column: 1 }],
          },
        ],
        establishes: [],
      }}),
      status: { state: "succeeded" },
    });
    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "verification",
      title: "TypeScript quality analysis",
      summary: "3 configured quality diagnostics",
      verification: {
        kind: "quality",
        engine: { name: "kiln-quality", version: "3.0.0-beta.1", parser: { name: "@typescript/typescript6", version: "6.0.3" } },
        candidate: { digest, subjects: [{ path: "policy.ts", contentDigest: digest }] },
        outcome: "diagnostics",
        authority: { kind: "evidence_only", establishes: [] },
      },
    });
    expect(presentation.toolPresentation?.verification).toMatchObject({
      kind: "quality",
      profiles: [
        { name: "type-integrity", revision: "v1" },
        { name: "complexity", revision: "v1" },
        { name: "test-integrity", revision: "v1" },
      ],
    });
    expect(JSON.stringify(presentation.toolPresentation)).not.toMatch(/quality passed/iu);
  });

  it("presents canonical managed account affinity commit evidence", () => {
    const completed = structuredClone(managedAccountLeaseSettledEvent);
    const payload = completed.payload as Record<string, unknown> & {
      managedInvocationEvidence: {
        lifecycle: {
          accountLease: {
            affinityCommitOutcome?: string;
          };
        };
      };
    };
    payload.managedInvocationEvidence.lifecycle.accountLease.affinityCommitOutcome = "conflict";

    const presentation = presentOperatorEventPayload(completed.kind, completed.payload);

    expect(presentation.details).toContainEqual({
      label: "Account affinity commit",
      value: "conflict",
    });
    expect(presentation.details).toContainEqual({
      label: "Account usage freshness",
      value: "fresh",
    });
    expect(presentation.details).toContainEqual({
      label: "Account usage availability",
      value: "available",
    });
  });

  it("projects structured tool errors as diagnostics even when the transport reports success", () => {
    const message = "goal.create cannot combine preferredRouteId and managedAgentProfile.";
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-goal-create",
      toolName: "goal.create",
      output: JSON.stringify({
        error: {
          code: "invalid_input",
          message,
          recoverable: true,
          suggestedNextTool: "goal.create",
          requiredInputShape: {
            objective: "string",
            workItemIds: ["existing work item id"],
          },
        },
      }, null, 2),
      status: { state: "succeeded" },
    });

    expect(presentation).toMatchObject({
      title: "Failed goal.create",
      summary: message,
      tone: "error",
      conversationDisposition: "exception",
      toolPresentation: {
        outputKind: "diagnostic",
        title: "Invalid input",
        summary: message,
        diagnostic: {
          code: "invalid_input",
          message,
          recoverable: true,
          suggestedNextTool: "goal.create",
          requiredInput: [
            { name: "objective", expected: "string" },
            { name: "workItemIds", expected: "existing work item id[]" },
          ],
        },
      },
    });
    expect(presentation.toolPresentation?.preview).toBeUndefined();
    expect(presentation.details).toContainEqual({ label: "Status", value: "failed" });
  });

  it("projects work item updates from canonical output instead of raw JSON", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-work-item-update",
      toolName: "work_item.update",
      output: JSON.stringify({
        item: {
          id: "work-1",
          summary: "Inspect composer activity ownership.",
          status: "pending",
          workflowProfile: "verification-heavy",
          risk: "medium",
          surface: "gui",
          authorityProfile: "foundation-readonly-plan",
          expectedEvidence: ["surface-map", "tests"],
          providedEvidence: ["surface-map"],
          pauseRequirements: [],
        },
        nextRequiredTools: ["goal.create", "work_item.execution.start"],
      }),
      metadata: { kind: "work_item", operation: "update" },
      status: { state: "succeeded" },
    });

    expect(presentation).toMatchObject({
      title: "Completed work_item.update",
      summary: "Inspect composer activity ownership.",
      tone: "success",
      toolPresentation: {
        outputKind: "work_item",
        title: "Inspect composer activity ownership.",
        summary: "Inspect composer activity ownership.",
        workItem: {
          id: "work-1",
          summary: "Inspect composer activity ownership.",
          status: "pending",
          workflowProfile: "verification-heavy",
          risk: "medium",
          surface: "gui",
          authorityProfile: "foundation-readonly-plan",
          evidence: [
            { label: "surface-map", status: "completed" },
            { label: "tests", status: "pending" },
          ],
          nextTools: ["goal.create", "work_item.execution.start"],
        },
      },
    });
    expect(presentation.toolPresentation?.preview).toBeUndefined();
  });

  it("projects created goals as governed goal summaries instead of raw JSON", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-goal-create",
      toolName: "goal.create",
      output: JSON.stringify({
        goal: {
          id: "goal-1",
          objective: "Perform evidence-backed UX verification.",
          source: { kind: "operator_direct", turnId: "turn-ux-verification" },
          status: "active",
          workItemIds: ["work-1", "work-2", "work-3"],
          authorityEnvelope: {
            maximumAuthority: "read_only",
            escalationPolicy: "deny",
          },
          routePolicy: { workflowProfile: "verification-heavy" },
          evidenceRequirements: [
            { id: "repo-inspection", description: "Inspect the requested files.", required: true },
          ],
          currentPhase: "prepare",
        },
      }),
      metadata: { kind: "goal", operation: "create" },
      status: { state: "succeeded" },
    });

    expect(presentation).toMatchObject({
      title: "Completed goal.create",
      summary: "Perform evidence-backed UX verification.",
      tone: "success",
      toolPresentation: {
        outputKind: "goal",
        title: "Perform evidence-backed UX verification.",
        goal: {
          id: "goal-1",
          objective: "Perform evidence-backed UX verification.",
          status: "active",
          phase: "prepare",
          workItemIds: ["work-1", "work-2", "work-3"],
          authority: "read_only",
          escalationPolicy: "deny",
          workflowProfile: "verification-heavy",
          evidenceRequirements: [
            { id: "repo-inspection", description: "Inspect the requested files.", required: true },
          ],
        },
      },
    });
    expect(presentation.toolPresentation?.preview).toBeUndefined();
  });

  it("projects nested work item execution state and evidence from the live envelope", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-work-item-start",
      toolName: "work_item.execution.start",
      output: JSON.stringify({
        status: "started",
        item: {
          id: "work-1",
          summary: "Inspect composer activity ownership.",
          status: "in_progress",
          expectedEvidence: ["surface-map", "tests"],
          providedEvidence: ["surface-map"],
        },
        attempt: {
          id: "goal-1:work-1:attempt:1",
          executionMode: "direct",
          status: "started",
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation).toMatchObject({
      title: "Execution started",
      summary: "Inspect composer activity ownership.",
      tone: "running",
      toolPresentation: {
        outputKind: "task",
        title: "Inspect composer activity ownership.",
        task: {
          status: "in_progress",
          workItemId: "work-1",
          items: [
            { label: "surface-map", status: "completed" },
            { label: "tests", status: "pending" },
          ],
        },
      },
    });
  });

  it("projects failed file reads as diagnostics instead of text output", () => {
    const path = "C:\\repo\\missing.ts";
    const message = `ENOENT: no such file or directory, open '${path}'`;
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-read",
      toolName: "read",
      output: message,
      metadata: { kind: "file", operation: "read", filePath: path, code: "ENOENT" },
      status: { state: "failed" },
    });

    expect(presentation).toMatchObject({
      title: "Failed to read files",
      summary: message,
      tone: "error",
      toolPresentation: {
        outputKind: "diagnostic",
        title: "Read failed",
        diagnostic: {
          code: "ENOENT",
          message,
          requiredInput: [],
        },
        fields: [{ label: "Path", value: path }],
      },
    });
    expect(presentation.toolPresentation?.preview).toBeUndefined();
  });

  it("classifies unknown JSON as structured data instead of text output", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-custom-inspection",
      toolName: "custom.inspect",
      output: JSON.stringify({ status: "ready", count: 3, items: ["one", "two", "three"] }),
      status: { state: "succeeded" },
    });

    expect(presentation).toMatchObject({
      title: "Completed custom.inspect",
      summary: "3 fields",
      toolPresentation: {
        outputKind: "data",
        summary: "3 fields",
        preview: {
          language: "json",
        },
      },
    });
    expect(presentation.toolPresentation?.classification).toMatchObject({
      source: "content-heuristic",
      reason: "structured JSON output classified from content",
    });
  });

  it("projects paused work item execution results as structured task state", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-work-item-start",
      toolName: "work_item.execution.start",
      output: JSON.stringify({
        status: "paused",
        reason: "managedInvocationId is required before starting managed-delegation execution.",
        workItemId: "inspect-composer-activity-ownership",
        routeId: "opencode-go-qwen3-7-max-readonly",
        nextTool: "managed_agent.invoke",
        requiredEvidence: ["surface-map", "risk-hypothesis", "visual-reference-research", "tests"],
      }, null, 2),
      status: { state: "succeeded" },
    });

    expect(presentation).toMatchObject({
      title: "Execution paused",
      summary: "managedInvocationId is required before starting managed-delegation execution.",
      tone: "warning",
      conversationDisposition: "exception",
      toolPresentation: {
        outputKind: "task",
        title: "Work item execution",
        summary: "managedInvocationId is required before starting managed-delegation execution.",
        task: {
          status: "paused",
          workItemId: "inspect-composer-activity-ownership",
          routeId: "opencode-go-qwen3-7-max-readonly",
          nextTool: "managed_agent.invoke",
          items: [
            { label: "surface-map", status: "pending" },
            { label: "risk-hypothesis", status: "pending" },
            { label: "visual-reference-research", status: "pending" },
            { label: "tests", status: "pending" },
          ],
        },
      },
    });
    expect(presentation.title).not.toContain("Completed");
    expect(presentation.details).toContainEqual({ label: "Status", value: "paused" });
    expect(presentation.toolPresentation?.preview).toBeUndefined();
    expect(JSON.stringify(presentation.toolPresentation)).not.toContain("{\n");
  });

  it("presents plan lifecycle events without raw payload syntax", () => {
    const submitted = presentOperatorEventPayload("plan_submitted", {
      planId: "plan-1",
      mode: "plan",
      objective: "Implement shared execution mode",
      summary: "Implement shared execution mode",
      workflowProfile: "architecture-change",
      riskClassification: "high",
      sourceSpecificationId: "spec_1",
      proposedWorkItemCount: 3,
    });
    const approved = presentOperatorEventPayload("plan_approved", {
      planId: "plan-1",
      approvalId: "plan_approval_1",
      planHash: "sha256:abc123",
      approvedAt: "2026-05-11T12:00:00.000Z",
      fromMode: "plan",
      toMode: "execute",
    });
    const analysis = presentOperatorEventPayload("plan_analysis_reported", {
      reportId: "analysis_report_1",
      planId: "plan-1",
      specificationId: "spec-1",
      status: "blocked",
      highestSeverity: "critical",
      findingCount: 2,
      blockingFindingIds: ["analysis_finding_1"],
      summary: "1 critical finding blocks approval.",
    });

    expect(submitted.title).toBe("Plan submitted");
    expect(submitted.summary).toBe("Implement shared execution mode");
    expect(submitted.compactText).toBe("Implement shared execution mode");
    expect(submitted.surfaces).toEqual(["conversation_inline", "activity_panel", "inspector"]);
    expect(submitted.conversationDisposition).toBe("none");
    expect(operatorEventTargetsConversation(submitted)).toBe(false);
    expect(submitted.details).toEqual([
      { label: "Plan", value: "plan-1" },
      { label: "Mode", value: "plan" },
      { label: "Workflow", value: "architecture-change" },
      { label: "Risk", value: "high" },
      { label: "Source spec", value: "spec_1" },
      { label: "Work items", value: "3" },
    ]);
    expect(JSON.stringify(submitted)).not.toContain("\\\"objective\\\"");

    expect(approved.title).toBe("Plan approved");
    expect(approved.summary).toBe("plan -> execute");
    expect(approved.surfaces).toEqual(["conversation_inline", "activity_panel", "inspector"]);
    expect(approved.conversationDisposition).toBe("none");
    expect(operatorEventTargetsConversation(approved)).toBe(false);
    expect(approved.details).toContainEqual({ label: "Plan hash", value: "sha256:abc123" });

    expect(analysis.title).toBe("Plan Analysis Reported");
    expect(analysis.summary).toBe("blocked · 1 critical finding blocks approval.");
    expect(analysis.tone).toBe("error");
    expect(analysis.conversationDisposition).toBe("none");
    expect(analysis.details).toEqual([
      { label: "Report", value: "analysis_report_1" },
      { label: "Plan", value: "plan-1" },
      { label: "Specification", value: "spec-1" },
      { label: "Status", value: "blocked" },
      { label: "Highest severity", value: "critical" },
      { label: "Findings", value: "2" },
      { label: "Blocking findings", value: "analysis_finding_1" },
    ]);
  });

  it("presents provider routing without exposing raw payload syntax", () => {
    const presentation = presentOperatorEventPayload("provider_routed", {
      provider: {
        provider: "codex-oauth",
        model: "gpt-5.5",
      },
      reason: "Explicit model override",
    });

    expect(presentation.title).toBe("Provider routed");
    expect(presentation.summary).toBe("codex-oauth · gpt-5.5");
    expect(presentation.details).toEqual([
      { label: "Provider", value: "codex-oauth" },
      { label: "Model", value: "gpt-5.5" },
      { label: "Why", value: "Explicit model override" },
    ]);
    expect(JSON.stringify(presentation.details)).not.toContain("\\\"provider\\\"");
  });

  it("presents multimodal routing evidence as operator-visible audit detail", () => {
    const presentation = presentOperatorEventPayload("multimodal_routed", {
      provider: {
        provider: "openai",
        model: "gpt-4o",
      },
      strategy: "native",
      reasonCode: "native_supported",
      reason: "The active provider/model can accept the required modality.",
      requestedCapability: "vision",
      requiredModalities: ["text", "image"],
      artifactUris: ["kiln://runtime/session-artifact/0"],
      diagnostics: [],
    });

    expect(presentation.title).toBe("Multimodal routed");
    expect(presentation.summary).toBe("native · vision · openai · gpt-4o");
    expect(presentation.tone).toBe("success");
    expect(presentation.details).toEqual([
      { label: "Strategy", value: "native" },
      { label: "Capability", value: "vision" },
      { label: "Modalities", value: "text, image" },
      { label: "Provider", value: "openai" },
      { label: "Model", value: "gpt-4o" },
      { label: "Reason", value: "native_supported" },
      { label: "Artifacts", value: "kiln://runtime/session-artifact/0" },
    ]);
    expect(presentation.surfaces).toEqual(["conversation_inline", "activity_panel", "inspector"]);
  });

  it("presents delegated multimodal route identity and authority evidence", () => {
    const presentation = presentOperatorEventPayload("multimodal_routed", {
      provider: {
        provider: "openai",
        model: "gpt-4o",
      },
      strategy: "delegated",
      reasonCode: "delegation_route_available",
      requestedCapability: "vision",
      requiredModalities: ["text", "image"],
      artifactUris: ["kiln://runtime/session-artifact/0"],
      delegation: {
        routeId: "managed-vision-readonly",
        authorityProfileId: "authority:managed-vision:readonly",
      },
      diagnostics: [],
    });

    expect(presentation.summary).toBe("delegated · vision · openai · gpt-4o");
    expect(presentation.details).toContainEqual({ label: "Delegation route", value: "managed-vision-readonly" });
    expect(presentation.details).toContainEqual({ label: "Authority profile", value: "authority:managed-vision:readonly" });
  });

  it("presents goal lifecycle events as operator-visible previews", () => {
    const presentation = presentOperatorEventPayload("goal.completed", {
      goal: {
        id: "goal-1",
        objective: "Finish roadmap slice 6 with verified goal resources.",
        source: { kind: "approved_plan", planId: "plan-1" },
        status: "completed",
        workItemIds: ["wi-1", "wi-2"],
        authorityEnvelope: {
          maximumAuthority: "audited",
          escalationPolicy: "approval_required",
        },
        routePolicy: {
          workflowProfile: "architecture-change",
        },
        closeoutSummary: "Goal resources verified.",
      },
      closeoutSummary: "Goal resources verified.",
    });

    expect(presentation.title).toBe("Goal completed");
    expect(presentation.summary).toBe("completed · Finish roadmap slice 6 with verified goal resources.");
    expect(presentation.tone).toBe("success");
    expect(presentation.surfaces).toEqual(["conversation_inline", "activity_panel", "inspector"]);
    expect(presentation.details).toEqual([
      { label: "Goal", value: "goal-1" },
      { label: "Status", value: "completed" },
      { label: "Source", value: "Approved plan plan-1" },
      { label: "Work items", value: "wi-1, wi-2" },
      { label: "Workflow", value: "architecture-change" },
      { label: "Authority", value: "audited" },
      { label: "Escalation", value: "approval_required" },
      { label: "Closeout", value: "Goal resources verified." },
    ]);
  });

  it("presents work-item materialization as an operator-visible checkpoint", () => {
    const presentation = presentOperatorEventPayload("work_items.materialized", {
      materialization: {
        id: "mat-1",
        planId: "plan-1",
        planHash: "sha256:plan",
        approvalId: "approval-1",
        goalRunId: "goal-1",
        workItemIds: ["wi-1", "wi-2"],
        createdWorkItemIds: ["wi-1"],
        reusedWorkItemIds: ["wi-2"],
      },
    });

    expect(presentation.title).toBe("Work items materialized");
    expect(presentation.summary).toBe("2 work items · plan plan-1");
    expect(presentation.tone).toBe("success");
    expect(presentation.surfaces).toEqual(["conversation_inline", "activity_panel", "inspector"]);
    expect(presentation.details).toEqual([
      { label: "Materialization", value: "mat-1" },
      { label: "Plan", value: "plan-1" },
      { label: "Plan hash", value: "sha256:plan" },
      { label: "Approval", value: "approval-1" },
      { label: "Goal", value: "goal-1" },
      { label: "Work items", value: "wi-1, wi-2" },
      { label: "Created", value: "wi-1" },
      { label: "Reused", value: "wi-2" },
    ]);
  });

  it("presents work-item execution attempts as operator-visible checkpoints", () => {
    const updated = presentOperatorEventPayload("work_item_updated", {
      operation: "update",
      workItem: {
        id: "work-1",
        summary: "Run Slice 9 verification",
        status: "blocked",
        workflowProfile: "verification-heavy",
        authorityProfile: "authority:foundation-readonly-plan",
        expectedEvidence: ["surface-map", "tests"],
        providedEvidence: ["surface-map"],
        missingResidualRisk: true,
      },
    });
    const started = presentOperatorEventPayload("work_item_execution_started", {
      workItem: {
        id: "work-1",
        summary: "Run Slice 9 verification",
        status: "in_progress",
        workflowProfile: "verification-heavy",
        authorityProfile: "authority:foundation-readonly-plan",
      },
      attempt: {
        id: "goal-1:work-1:attempt:1",
        status: "started",
        executionMode: "managed_delegation",
        managedInvocationId: "invocation-1",
        startedAt: "2026-05-12T20:00:00.000Z",
      },
    });
    const finished = presentOperatorEventPayload("work_item_execution_finished", {
      workItem: {
        id: "work-1",
        summary: "Run Slice 9 verification",
        status: "completed",
        workflowProfile: "verification-heavy",
        referenceRoots: ["/workspace/references/cloned"],
      },
      attempt: {
        id: "goal-1:work-1:attempt:1",
        status: "completed",
        executionMode: "managed_delegation",
        managedInvocationId: "invocation-1",
        startedAt: "2026-05-12T20:00:00.000Z",
        completedAt: "2026-05-12T20:05:00.000Z",
      },
      missingEvidence: [],
      missingGoalEvidence: ["typecheck"],
      missingVerificationGates: ["adversarial managed-agent review"],
      failedVerificationGates: ["bun run typecheck"],
      missingResidualRisk: false,
    });

    expect(started).toMatchObject({
      title: "Work item execution started",
      summary: "started · managed_delegation · Run Slice 9 verification",
      tone: "running",
    });
    expect(updated.details).toContainEqual({ label: "Resource", value: "kiln://session/work-items/work-1" });
    expect(updated.details).toContainEqual({ label: "Missing evidence", value: "tests, residual-risk" });
    expect(started.details).toContainEqual({ label: "Resource", value: "kiln://session/work-items/work-1" });
    expect(started.details).toContainEqual({ label: "Authority", value: "authority:foundation-readonly-plan" });
    expect(started.details).toContainEqual({ label: "Attempt", value: "goal-1:work-1:attempt:1" });
    expect(started.details).toContainEqual({ label: "Managed invocation", value: "invocation-1" });
    expect(finished).toMatchObject({
      title: "Work item execution completed",
      summary: "completed · managed_delegation · Run Slice 9 verification",
      tone: "warning",
    });
    expect(finished.details).toContainEqual({ label: "Missing goal evidence", value: "typecheck" });
    expect(finished.details).toContainEqual({
      label: "Missing verification gates",
      value: "adversarial managed-agent review",
    });
    expect(finished.details).toContainEqual({ label: "Failed verification gates", value: "bun run typecheck" });
    expect(finished.details).toContainEqual({ label: "Reference roots", value: "/workspace/references/cloned" });
  });

  it("presents a completion-eligible turn with its canonical policy and evidence", () => {
    const presentation = presentOperatorEventPayload("turn_completed", turnPayload({
      outcome: "completed",
      dispositionReason: "completion_eligible",
      completion: {
        obligations: [],
        producerEvidence: [],
        eligibility: { status: "eligible" },
      },
    }));

    expect(presentation).toMatchObject({
      title: "Turn completed",
      summary: expect.stringContaining("completion_eligible"),
      tone: "success",
      conversationDisposition: "result",
    });
    expect(presentation.details).toEqual(expect.arrayContaining([
      { label: "Provider", value: "codex-oauth" },
      { label: "Model", value: "gpt-5.4-mini" },
      { label: "Outcome", value: "completed" },
      { label: "Disposition reason", value: "completion_eligible" },
      { label: "Completion eligibility", value: "eligible" },
      { label: "Convergence policy", value: "kiln.test.turn-convergence" },
      { label: "Convergence policy hash", value: `sha256:${"a".repeat(64)}` },
      { label: "Continuity", value: "fallback-replay" },
      { label: "Why", value: "no-sources" },
      { label: "Authority", value: "destructive" },
      { label: "Input tokens", value: "1398" },
      { label: "Output tokens", value: "11" },
    ]));
  });

  it.each([
    ["no_progress", "No progress detected"],
    ["tool_round_limit", "Tool round limit reached"],
  ] as const)("presents a %s pause with triggering convergence evidence", (reason, reasonLabel) => {
    const presentation = presentOperatorEventPayload("turn_completed", turnPayload({
      outcome: "paused",
      dispositionReason: reason,
      convergence: {
        policy: turnPolicy,
        progressEvidence: [],
        pause: {
          status: "pause",
          reason,
          metric: reason === "no_progress" ? "consecutiveNoProgressSteps" : "toolRounds",
          observed: reason === "no_progress" ? 3 : 8,
          limit: reason === "no_progress" ? 3 : 8,
        },
      },
    }));

    expect(presentation).toMatchObject({
      title: "Turn paused",
      summary: expect.stringContaining(`${reasonLabel} (${reason})`),
      tone: "warning",
    });
    expect(presentation.details).toEqual(expect.arrayContaining([
      { label: "Disposition reason", value: reason },
      { label: "Convergence pause", value: `${reasonLabel} (${reason})` },
      {
        label: "Convergence metric",
        value: reason === "no_progress" ? "consecutiveNoProgressSteps" : "toolRounds",
      },
      { label: "Convergence observed", value: reason === "no_progress" ? "3" : "8" },
      { label: "Convergence limit", value: reason === "no_progress" ? "3" : "8" },
    ]));
  });

  it("presents an unavailable convergence observation without inventing a numeric bound", () => {
    const presentation = presentOperatorEventPayload("turn_completed", turnPayload({
      outcome: "paused",
      dispositionReason: "observation_unavailable",
      convergence: {
        policy: turnPolicy,
        progressEvidence: [],
        pause: {
          status: "pause",
          reason: "observation_unavailable",
          metric: "cumulativeInputTokens",
          unknownReason: "Provider did not report cumulative input usage.",
        },
      },
    }));

    expect(presentation.tone).toBe("warning");
    expect(presentation.details).toEqual(expect.arrayContaining([
      { label: "Convergence metric", value: "cumulativeInputTokens" },
      { label: "Convergence unknown reason", value: "Provider did not report cumulative input usage." },
    ]));
    expect(presentation.details).not.toContainEqual({ label: "Convergence observed", value: "0" });
  });

  it.each([
    ["required_producer_not_run", "paused", "warning"],
    ["required_producer_unavailable", "failed", "error"],
  ] as const)("presents required producer status %s without treating it as success", (reason, titleOutcome, tone) => {
    const status = reason === "required_producer_not_run" ? "not_run" : "unavailable";
    const presentation = presentOperatorEventPayload("turn_completed", turnPayload({
      outcome: titleOutcome,
      dispositionReason: reason,
      completion: {
        obligations: [{
          kind: "required_producer",
          obligationId: "required-producer:formal_verify",
          canonicalToolId: "formal_verify",
          acceptedEquivalentToolIds: [],
          sourceAlias: "Dafny",
        }],
        producerEvidence: [{ canonicalProducerId: "formal_verify", status }],
        eligibility: {
          status: "ineligible",
          unmet: [{
            obligationId: "required-producer:formal_verify",
            canonicalToolId: "formal_verify",
            sourceAlias: "Dafny",
            status,
          }],
        },
      },
    }));

    expect(presentation).toMatchObject({
      title: `Turn ${titleOutcome}`,
      tone,
      summary: expect.stringContaining(`(${reason})`),
    });
    expect(presentation.details).toEqual(expect.arrayContaining([
      { label: "Completion eligibility", value: "ineligible" },
      { label: "Unmet completion obligations", value: `formal_verify: ${status}` },
      { label: "Producer evidence", value: `formal_verify: ${status} (evidence)` },
    ]));
  });

  it("presents governed and runtime failures as distinct dangerous outcomes", () => {
    const governed = presentOperatorEventPayload("turn_completed", turnPayload({
      outcome: "failed",
      dispositionReason: "governed_work_incomplete",
      convergence: {
        policy: turnPolicy,
        progressEvidence: [],
      },
    }));
    const runtime = presentOperatorEventPayload("turn_completed", {
      outcome: "failed",
      dispositionReason: "runtime_failure",
    });

    expect(governed).toMatchObject({
      title: "Turn failed",
      summary: expect.stringContaining("governed_work_incomplete"),
      tone: "error",
    });
    expect(governed.details).toEqual(expect.arrayContaining([
      { label: "Convergence policy", value: "kiln.test.turn-convergence" },
    ]));
    expect(runtime).toMatchObject({
      title: "Turn failed",
      summary: expect.stringContaining("runtime_failure"),
      tone: "error",
    });
    expect(runtime.details).toContainEqual({ label: "Disposition reason", value: "runtime_failure" });
  });

  it.each([
    ["operator_cancelled", "Cancelled by operator"],
    ["runtime_cancelled", "Cancelled by runtime"],
  ] as const)("presents %s as a neutral cancellation", (reason, reasonLabel) => {
    const presentation = presentOperatorEventPayload("turn_completed", {
      outcome: "cancelled",
      dispositionReason: reason,
    });

    expect(presentation).toMatchObject({
      title: "Turn cancelled",
      summary: expect.stringContaining(`${reasonLabel} (${reason})`),
      tone: "info",
    });
  });

  it("does not treat an outcome-only terminal payload as a successful turn", () => {
    expect(presentOperatorEventPayload("turn_completed", { outcome: "completed" })).toMatchObject({
      title: "Turn disposition unavailable",
      tone: "error",
    });
  });

  it("presents managed child invocation identity across surfaces", () => {
    const presentation = presentOperatorEventPayload("agent_invocation_completed", {
      invocationId: "inv-1",
      agentId: "codex-oauth:foundation-readonly-plan",
      parentTurnId: "session-1:turn:2",
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "codex-oauth",
        model: "gpt-5.4-mini",
        surface: "direct-provider",
      },
      adapterKind: "direct",
      executionMode: "runtime-direct",
      authorityProfileId: "authority:foundation-readonly-plan",
      capabilitySnapshot: {
        snapshotId: "inv-1:capability-snapshot",
        capturedAt: "2026-05-07T08:00:00.000Z",
        routeId: "codex-oauth-readonly",
        routeSource: "explicit-managed-route",
        routeHealth: {
          status: "healthy",
          reason: "Configured managed invocation route selected.",
        },
        providerModelProof: {
          status: "live-proven",
          source: "managed-invocation-route-health",
        },
        resourcePlane: {
          available: true,
          resourceUris: [],
        },
        resourceLease: {
          leaseId: "inv-1:resource-lease",
          createdAt: "2026-05-07T08:00:00.000Z",
          healthStatus: "healthy",
          cleanupStatus: "not-required",
          workingDirectoryPath: "C:/workspace/kiln",
          workingDirectoryMode: "read-only",
          resourceUris: ["kiln://resources/context.md"],
          diagnosticUris: [],
        },
        childIdentity: {
          agentId: "codex-oauth:foundation-readonly-plan",
          displayName: "Piama",
        },
      },
      managedInvocationEvidence: {
        lifecycle: {
          routeSource: "explicit-managed-route",
          sourceResourceUris: ["kiln://managed-agents/invocations/inv-1/content"],
          resourceLease: {
            leaseId: "inv-1:resource-lease",
            createdAt: "2026-05-07T08:00:00.000Z",
            healthStatus: "released",
            cleanupStatus: "completed",
            workingDirectoryPath: "C:/workspace/kiln",
            workingDirectoryMode: "read-only",
            resourceUris: ["kiln://resources/context.md"],
            diagnosticUris: ["kiln://artifacts/inv-1/lease-diagnostics"],
          },
        },
      },
      durationMs: 950,
      resultSummary: "Inspection completed.",
    });

    expect(presentation.summary).toBe(
      "foundation-readonly-plan via codex-oauth/gpt-5.4-mini (direct-provider) · Inspection completed.",
    );
    expect(presentation.details).toEqual([
      { label: "Agent", value: "codex-oauth:foundation-readonly-plan" },
      { label: "Profile", value: "foundation-readonly-plan" },
      { label: "Provider", value: "codex-oauth" },
      { label: "Model", value: "gpt-5.4-mini" },
      { label: "Surface", value: "direct-provider" },
      { label: "Adapter", value: "direct" },
      { label: "Execution", value: "runtime-direct" },
      { label: "Authority", value: "authority:foundation-readonly-plan" },
      { label: "Capability snapshot", value: "inv-1:capability-snapshot" },
      { label: "Captured", value: "2026-05-07T08:00:00.000Z" },
      { label: "Route ID", value: "codex-oauth-readonly" },
      { label: "Route source", value: "explicit-managed-route" },
      { label: "Route health", value: "healthy" },
      { label: "Route health reason", value: "Configured managed invocation route selected." },
      { label: "Provider proof", value: "live-proven" },
      { label: "Provider proof source", value: "managed-invocation-route-health" },
      { label: "Resource plane", value: "available" },
      { label: "Resource lease", value: "read-only · C:/workspace/kiln" },
      { label: "Lease ID", value: "inv-1:resource-lease" },
      { label: "Lease created", value: "2026-05-07T08:00:00.000Z" },
      { label: "Lease health", value: "released" },
      { label: "Lease cleanup", value: "completed" },
      { label: "Lease resources", value: "kiln://resources/context.md" },
      { label: "Lease diagnostics", value: "kiln://artifacts/inv-1/lease-diagnostics" },
      { label: "Source resources", value: "kiln://managed-agents/invocations/inv-1/content" },
      { label: "Child identity", value: "Piama" },
      { label: "Invocation ID", value: "inv-1" },
      { label: "Parent turn", value: "session-1:turn:2" },
      { label: "Duration", value: "950 ms" },
      { label: "Result", value: "Inspection completed." },
    ]);
    expect(presentation.surfaces).toEqual(["conversation_inline", "activity_panel", "inspector"]);
  });

  it("presents remote harness route limitations from capability snapshots", () => {
    const presentation = presentOperatorEventPayload("agent_invocation_completed", {
      invocationId: "inv-remote-1",
      agentId: "codex-cloud:foundation-readonly-plan",
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "codex-cloud",
        model: "gpt-5.5",
        surface: "remote-harness",
      },
      adapterKind: "harness",
      executionMode: "remote-harness",
      authorityProfileId: "authority:codex-cloud-remote:foundation-readonly-plan",
      capabilitySnapshot: {
        snapshotId: "inv-remote-1:capability-snapshot",
        capturedAt: "2026-05-07T08:00:00.000Z",
        routeHealth: {
          status: "healthy",
          reason: "Remote harness endpoint admitted by managed invocation policy.",
        },
        providerModelProof: {
          status: "configured",
          source: "remote-harness-config",
        },
        adapterDescriptor: {
          limitations: [
            "Remote harness reports aggregate token classes only.",
            "Remote harness cannot expose local live terminal streaming.",
          ],
        },
        resourcePlane: {
          available: true,
          resourceUris: [],
        },
        resourceLease: {
          leaseId: "inv-remote-1:resource-lease",
          createdAt: "2026-05-07T08:00:00.000Z",
          healthStatus: "healthy",
          cleanupStatus: "pending",
          workingDirectoryPath: "C:/workspace/kiln",
          workingDirectoryMode: "sandbox",
          resourceUris: [],
          diagnosticUris: [],
        },
        childIdentity: {
          agentId: "codex-cloud:foundation-readonly-plan",
        },
      },
      resultSummary: "Remote inspection completed.",
    });

    expect(presentation.summary).toBe(
      "foundation-readonly-plan via codex-cloud/gpt-5.5 (remote-harness) · Remote inspection completed.",
    );
    expect(presentation.details).toContainEqual({
      label: "Route limitations",
      value: "Remote harness reports aggregate token classes only., Remote harness cannot expose local live terminal streaming.",
    });
    expect(presentation.details).toContainEqual({ label: "Execution", value: "remote-harness" });
  });

  it("presents config mutation events as operator-visible audit evidence", () => {
    const proposed = presentOperatorEventPayload("config_change_proposed", {
      proposalId: "cfg_skill",
      operation: "skill.upsert",
      status: "valid",
      affectedCanonicalPaths: ["C:/repo/.kiln/skills/repo-review/SKILL.md"],
      authorityImpact: "none",
    });
    const applied = presentOperatorEventPayload("config_change_applied", {
      proposalId: "cfg_skill",
      approvalId: "cfgap_skill",
      appliedWrites: [
        {
          path: "C:/repo/.kiln/skills/repo-review/SKILL.md",
          previousHash: null,
          nextHash: "sha256-next",
        },
      ],
      projectionEffects: [
        {
          target: "native-skills",
          status: "ok",
          summary: "1 native skill projections synced",
          errors: [],
        },
      ],
    });

    expect(proposed.title).toBe("Config change proposed");
    expect(proposed.summary).toBe("skill.upsert · valid · cfg_skill");
    expect(proposed.surfaces).toEqual(["conversation_inline", "activity_panel", "inspector"]);
    expect(applied.title).toBe("Config change applied");
    expect(applied.summary).toBe("cfg_skill");
    expect(applied.surfaces).toEqual(["conversation_inline", "activity_panel", "inspector"]);
  });

  it("formats nested values as structured values for compact surfaces", () => {
    expect(formatOperatorEventValue({ nested: true })).toBe("Structured value");
  });

  it("marks live tool calls as inline conversation events and audit events", () => {
    const started = presentOperatorEventPayload("tool_call_started", {
      toolCallId: "tool-1",
      toolName: "read_many",
      input: {
        paths: ["docs"],
        maxBytes: 200000,
      },
    });
    const completed = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "read_many",
      outputSummary: "24 files read, 109 skipped",
      status: { state: "succeeded" },
    });

    expect(started.title).toBe("Reading files");
    expect(started.surfaces).toEqual(["conversation_inline", "activity_panel", "inspector"]);
    expect(operatorEventTargetsSurface(started, "conversation_inline")).toBe(true);

    expect(completed.title).toBe("Read files");
    expect(completed.summary).toBe("24 files read, 109 skipped");
    expect(completed.surfaces).toEqual(["conversation_inline", "activity_panel", "inspector"]);
  });

  it("uses human action labels for common tool families while retaining tool identity in details", () => {
    const cases = [
      { toolName: "web_search", started: "Searching the web", completed: "Searched the web" },
      { toolName: "shell_command", started: "Running command", completed: "Ran command" },
      { toolName: "rg", started: "Searching files", completed: "Searched files" },
      { toolName: "patch", started: "Editing files", completed: "Edited files" },
      { toolName: "browser_navigate", started: "Opening page", completed: "Opened page" },
    ] as const;

    for (const item of cases) {
      const started = presentOperatorEventPayload("tool_call_started", {
        toolCallId: `started-${item.toolName}`,
        toolName: item.toolName,
        input: {},
      });
      const completed = presentOperatorEventPayload("tool_call_completed", {
        toolCallId: `completed-${item.toolName}`,
        toolName: item.toolName,
        status: { state: "succeeded" },
      });

      expect(started.title).toBe(item.started);
      expect(completed.title).toBe(item.completed);
      expect(completed.details).toContainEqual({ label: "Tool", value: item.toolName });
    }
  });

  it("surfaces tool usage counts on completed tool events", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "web_search",
      outputSummary: "Found 4 sources",
      toolUsage: {
        toolName: "web_search",
        calls: 3,
      },
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("Found 4 sources · web_search 3");
    expect(presentation.details).toContainEqual({ label: "Tool usage", value: "web_search 3" });
  });

  it("projects enforced freshness and dated-source evidence for web search results", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "web_search",
      outputSummary: "Found 1 source",
      metadata: {
        toolName: "web_search",
        kind: "web",
        operation: "search",
        provider: "tavily",
        freshnessRequired: true,
        freshnessEnforcement: "enforced",
        retrievedAt: "2026-07-19T04:45:46.720Z",
        sources: [{
          title: "Match result",
          url: "https://example.com/match",
          publishedAt: "2026-07-18T23:00:00.000Z",
        }],
      },
      status: { state: "succeeded" },
    });

    expect(presentation.toolPresentation?.fields).toContainEqual({ label: "Freshness", value: "required · enforced" });
    expect(presentation.toolPresentation?.fields).toContainEqual({ label: "Retrieved at", value: "2026-07-19T04:45:46.720Z" });
    expect(presentation.toolPresentation?.fields).toContainEqual({ label: "Dated sources", value: "1 of 1" });
  });

  it("projects provider routing and strict postcondition evidence", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "web_search",
      outputSummary: "Found one governed source",
      metadata: {
        toolName: "web_search",
        kind: "web",
        operation: "search",
        provider: "brave",
        providerRequestId: "req-brave",
        providerDurationMs: 84,
        providerAttempts: [
          {
            providerId: "tavily-primary",
            outcome: "contract_rejected",
            omittedPreferences: ["country_targeting", "language_targeting"],
          },
          { providerId: "brave-fallback-1", outcome: "accepted" },
        ],
        domainPostcondition: {
          enforcement: "strict",
          acceptedCount: 1,
          rejectedCount: 0,
          rejectedSourceIds: [],
        },
        sources: [{ title: "Docs", url: "https://docs.example.com/kiln" }],
      },
      status: { state: "succeeded" },
    });

    expect(presentation.toolPresentation?.fields).toContainEqual({ label: "Provider route", value: "brave via 2 attempts" });
    expect(presentation.toolPresentation?.fields).toContainEqual({
      label: "Omitted preferences",
      value: "country targeting, language targeting",
    });
    expect(presentation.toolPresentation?.fields).toContainEqual({ label: "Domain compliance", value: "strict · 1 accepted · 0 rejected" });
    expect(presentation.toolPresentation?.fields).toContainEqual({ label: "Provider request", value: "req-brave" });
    expect(presentation.toolPresentation?.fields).toContainEqual({ label: "Provider latency", value: "84 ms" });
  });

  it("projects fail-closed freshness rejection even when a web search returns no sources", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "web_search",
      outputSummary: "Web search requires a provider that enforces recency filtering.",
      metadata: {
        toolName: "web_search",
        kind: "web",
        operation: "search",
        provider: "searxng",
        freshnessRequired: true,
        freshnessEnforcement: "not_enforced",
        errorCode: "freshness_not_enforced",
      },
      status: { state: "failed" },
    });

    expect(presentation.toolPresentation?.fields).toContainEqual({ label: "Freshness", value: "required · not enforced" });
    expect(presentation.toolPresentation?.fields).toContainEqual({ label: "Freshness rejection", value: "Provider cannot enforce recency filtering" });
  });

  it("projects semantic event consensus separately from provider freshness", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "web_search",
      outputSummary: "Verified event evidence",
      metadata: {
        toolName: "web_search",
        kind: "web",
        operation: "search",
        freshnessRequired: true,
        freshnessEnforcement: "enforced",
        temporalRequirement: {
          exactLocalDate: "2026-07-18",
          requiredIdentityTerms: ["guadalajara", "toluca"],
          eventStatus: "completed",
          minimumIndependentSources: 2,
        },
        temporalEvidence: {
          accepted: true,
          acceptedSourceIds: ["https://espn.com.mx/match", "https://tudn.com/match"],
          rejectedSourceIds: [],
        },
        sources: [{ title: "Final", url: "https://espn.com.mx/match" }],
      },
      status: { state: "succeeded" },
    });

    expect(presentation.toolPresentation?.fields).toContainEqual({ label: "Event evidence", value: "verified" });
    expect(presentation.toolPresentation?.fields).toContainEqual({ label: "Independent sources", value: "2" });
    expect(presentation.toolPresentation?.fields).toContainEqual({ label: "Event date", value: "2026-07-18" });
  });

  it("projects progressive recovery when exact-date evidence is insufficient", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "web_search",
      outputSummary: "Event evidence is insufficient",
      metadata: {
        toolName: "web_search",
        kind: "web",
        operation: "search",
        errorCode: "temporal_evidence_rejected",
        temporalRequirement: {
          exactLocalDate: "2026-07-18",
          requiredIdentityTerms: ["chivas", "toluca"],
          eventStatus: "completed",
          minimumIndependentSources: 2,
        },
        temporalEvidence: {
          accepted: false,
          reason: "independent_source_consensus_missing",
          acceptedSourceIds: [],
          rejectedSourceIds: ["https://record.example/index"],
        },
        recoveryDirective: {
          kind: "progressive_web_research",
          action: "broaden_search",
          constraintPolicy: "relax_only_agent_added",
          preserveTemporalRequirement: true,
          nextActions: ["broaden_search", "extract_candidates"],
        },
      },
      status: { state: "failed" },
    });

    expect(presentation.toolPresentation?.fields).toContainEqual({
      label: "Recovery",
      value: "Broaden search, then extract candidates",
    });
  });

  it("projects semantic consensus verified from extracted full pages", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "web_extract",
      outputSummary: "Extracted two pages",
      metadata: {
        toolName: "web_extract",
        kind: "web",
        operation: "extract",
        temporalRequirement: {
          exactLocalDate: "2026-07-18",
          requiredIdentityTerms: ["guadalajara", "toluca"],
          eventStatus: "completed",
          minimumIndependentSources: 2,
        },
        temporalEvidence: {
          accepted: true,
          acceptedSourceIds: ["https://espn.com.mx/match", "https://tudn.com/match"],
          rejectedSourceIds: [],
        },
      },
      status: { state: "succeeded" },
    });

    expect(presentation.toolPresentation?.fields).toContainEqual({ label: "Event evidence", value: "verified" });
    expect(presentation.toolPresentation?.fields).toContainEqual({ label: "Independent sources", value: "2" });
  });

  it("marks completed tool events as failed when the tool result envelope is an error", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "computer_observe",
      outputSummary: JSON.stringify({
        output: "Computer automation denied for active application 'msedge'.",
        isError: true,
        metadata: {
          toolName: "computer_observe",
          kind: "interactive",
          operation: "observe",
          provider: "windows-uia",
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.title).toBe("Failed computer_observe");
    expect(presentation.tone).toBe("error");
    expect(presentation.details).toContainEqual({ label: "Status", value: "failed" });
    expect(presentation.summary).toBe("Computer automation denied for active application 'msedge'.");
  });

  it("projects validated presentation intents from tool result envelopes", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "managed_agent.invoke",
      outputSummary: JSON.stringify({
        output: "All 3 managed children completed.",
        isError: false,
        metadata: {
          toolName: "managed_agent.invoke",
          kind: "managed-invocation",
          presentationIntent: {
            kind: "comparison_table",
            title: "Managed child comparison",
            summary: "3 child routes compared",
            source: "managed_agent.invoke",
            columns: [
              { key: "routeId", label: "Route" },
              { key: "provider", label: "Provider" },
              { key: "model", label: "Model" },
              { key: "status", label: "Status", valueKind: "status" },
              { key: "substantiveEvidence", label: "Evidence", valueKind: "boolean" },
            ],
            rows: [
              {
                routeId: "codex-oauth-readonly",
                provider: "codex-oauth",
                model: "gpt-5.4-mini",
                status: "completed",
                substantiveEvidence: true,
              },
            ],
          },
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("3 child routes compared");
    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "table",
      classification: {
        source: "presentation-intent",
        reason: "validated presentation intent selected renderer",
      },
      title: "Managed child comparison",
      summary: "3 child routes compared",
      presentationIntent: {
        kind: "comparison_table",
        rows: [
          expect.objectContaining({
            routeId: "codex-oauth-readonly",
            substantiveEvidence: true,
          }),
        ],
      },
    });
    expect(presentation.toolPresentation?.preview).toBeUndefined();
  });

  it("projects validated resource bundle intents as resource link presentations", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-resource-bundle",
      toolName: "managed_agent.invoke",
      outputSummary: JSON.stringify({
        output: "Artifacts are available for inspection.",
        isError: false,
        metadata: {
          toolName: "managed_agent.invoke",
          presentationIntent: {
            kind: "resource_bundle",
            title: "Managed invocation artifacts",
            summary: "2 artifacts",
            source: "managed_agent.invoke",
            resources: [
              {
                uri: "kiln://artifacts/inv-1/plan",
                title: "Plan",
                mimeType: "text/markdown",
                relation: "plan",
              },
              {
                uri: "kiln://artifacts/inv-1/review",
                title: "Review",
                mimeType: "application/json",
                relation: "review",
              },
            ],
          },
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("2 artifacts");
    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "resource_links",
      classification: {
        source: "presentation-intent",
        reason: "validated presentation intent selected renderer",
      },
      title: "Managed invocation artifacts",
      summary: "2 artifacts",
      presentationIntent: {
        kind: "resource_bundle",
        resources: [
          expect.objectContaining({ uri: "kiln://artifacts/inv-1/plan" }),
          expect.objectContaining({ uri: "kiln://artifacts/inv-1/review" }),
        ],
      },
    });
    expect(presentation.toolPresentation?.resourceLinks).toEqual([
      expect.objectContaining({ uri: "kiln://artifacts/inv-1/plan" }),
      expect.objectContaining({ uri: "kiln://artifacts/inv-1/review" }),
    ]);
  });

  it("classifies every closed presentation intent kind before renderer selection", () => {
    const cases = [
      {
        kind: "summary",
        outputKind: "text",
        intent: {
          kind: "summary",
          title: "Summary output",
          summary: "Summary ready",
          bullets: ["One fact"],
        },
      },
      {
        kind: "comparison_table",
        outputKind: "table",
        intent: {
          kind: "comparison_table",
          title: "Table output",
          columns: [{ key: "route", label: "Route" }],
          rows: [{ route: "codex" }],
        },
      },
      {
        kind: "risk_matrix",
        outputKind: "text",
        intent: {
          kind: "risk_matrix",
          title: "Risk output",
          risks: [{ risk: "Renderer fork", severity: "high" }],
        },
      },
      {
        kind: "timeline",
        outputKind: "text",
        intent: {
          kind: "timeline",
          title: "Timeline output",
          items: [{ order: 1, label: "Classified" }],
        },
      },
      {
        kind: "resource_bundle",
        outputKind: "resource_links",
        intent: {
          kind: "resource_bundle",
          title: "Bundle output",
          resources: [{ uri: "kiln://artifacts/tool-output", title: "Tool output" }],
        },
      },
      {
        kind: "diagnostic_report",
        outputKind: "text",
        intent: {
          kind: "diagnostic_report",
          title: "Diagnostic output",
          sections: [{ title: "Classification", status: "success" }],
        },
      },
    ] as const;

    for (const testCase of cases) {
      const presentation = presentOperatorEventPayload("tool_call_completed", {
        toolCallId: `tool-${testCase.kind}`,
        toolName: "managed_agent.invoke",
        output: JSON.stringify({
          output: `${testCase.kind} fallback text`,
          isError: false,
          metadata: {
            toolName: "managed_agent.invoke",
            presentationIntent: testCase.intent,
          },
        }),
        status: { state: "succeeded" },
      });

      expect(presentation.toolPresentation).toMatchObject({
        outputKind: testCase.outputKind,
        classification: {
          source: "presentation-intent",
          reason: "validated presentation intent selected renderer",
        },
        presentationIntent: {
          kind: testCase.kind,
        },
      });
    }
  });

  it("projects route-unavailable managed tool results as structured operator tables", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "managed_agent.start",
      outputSummary: JSON.stringify({
        output: "Managed invocation route 'openrouter-readonly' is unavailable for provider 'openrouter' and profile 'foundation-readonly-plan': Direct provider route is not eligible.",
        isError: true,
        metadata: {
          toolName: "managed_agent.start",
          kind: "managed-invocation",
          routeId: "openrouter-readonly",
          profile: "foundation-readonly-plan",
          providerRoute: {
            providerId: "openrouter",
            model: "openrouter/free",
          },
          status: "unavailable",
          presentationIntent: {
            kind: "comparison_table",
            title: "Managed child invocation",
            summary: "openrouter-readonly unavailable",
            source: "managed_agent.start",
            confidence: "medium",
            columns: [
              { key: "routeId", label: "Route", valueKind: "text" },
              { key: "provider", label: "Provider", valueKind: "text" },
              { key: "model", label: "Model", valueKind: "text" },
              { key: "profile", label: "Profile", valueKind: "text" },
              { key: "status", label: "Status", valueKind: "status" },
              { key: "substantiveEvidence", label: "Evidence", valueKind: "boolean" },
              { key: "failureReason", label: "Failure", valueKind: "text" },
            ],
            rows: [
              {
                routeId: "openrouter-readonly",
                provider: "openrouter",
                model: "openrouter/free",
                profile: "foundation-readonly-plan",
                status: "unavailable",
                substantiveEvidence: false,
                failureReason: "Direct provider route is not eligible.",
              },
            ],
          },
        },
      }),
      status: { state: "failed" },
    });

    expect(presentation.title).toBe("Failed managed_agent.start");
    expect(presentation.tone).toBe("error");
    expect(presentation.summary).toBe("openrouter-readonly unavailable");
    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "table",
      title: "Managed child invocation",
      summary: "openrouter-readonly unavailable",
      presentationIntent: {
        kind: "comparison_table",
        source: "managed_agent.start",
        rows: [
          expect.objectContaining({
            routeId: "openrouter-readonly",
            status: "unavailable",
            substantiveEvidence: false,
            failureReason: "Direct provider route is not eligible.",
          }),
        ],
      },
    });
    expect(presentation.toolPresentation?.preview).toBeUndefined();
  });

  it("ignores invalid presentation intents and keeps fallback rendering", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "read",
      outputSummary: JSON.stringify({
        output: "# Session Model\n\nKiln session identity is provider-agnostic.",
        isError: false,
        metadata: {
          toolName: "read",
          kind: "file",
          operation: "read",
          filePath: "docs/architecture/session-model.md",
          presentationIntent: {
            kind: "html",
            title: "unsafe",
            html: "<script>alert(1)</script>",
          },
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "markdown",
      title: "docs/architecture/session-model.md",
    });
    expect(presentation.toolPresentation).not.toHaveProperty("presentationIntent");
  });

  it("presents managed invocation tool route details without structured placeholders", () => {
    const started = presentOperatorEventPayload("tool_call_started", {
      toolCallId: "tool-1",
      toolName: "managed_agent.invoke",
      input: {
        profile: "foundation-readonly-plan",
        providerRoute: {
          providerId: "codex-oauth",
        },
        agentProfile: "architecture-reviewer",
        skills: ["ddd-review"],
        contextMode: "isolated",
        task: "Inspect docs/architecture/coordination/agent-tasks.md.",
        summary: "Inspect managed agents architecture doc",
      },
      metadata: {
        kind: "managed-invocation",
        profile: "foundation-readonly-plan",
        routeId: "codex-oauth-readonly",
        routeSource: "explicit-managed-route",
        parentTurnId: "session-1:turn:7",
        providerRoute: {
          providerId: "codex-oauth",
          model: "gpt-5.4-mini",
          surface: "direct-provider",
        },
        adapterKind: "direct",
        executionMode: "runtime-direct",
        authorityProfileId: "authority:foundation-readonly-plan",
      },
    });
    const completed = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "managed_agent.invoke",
      input: {
        profile: "foundation-readonly-plan",
        providerRoute: {
          providerId: "codex-oauth",
          model: "gpt-5.4-mini",
        },
        agentProfile: "architecture-reviewer",
        skills: ["ddd-review"],
        contextMode: "isolated",
        task: "Inspect docs/architecture/coordination/agent-tasks.md.",
        summary: "Inspect managed agents architecture doc",
      },
      outputSummary: JSON.stringify({
        output: "Inspection completed.",
        isError: false,
        metadata: {
          kind: "managed-invocation",
          invocationId: "inv-1",
          routeId: "codex-oauth",
          routeSource: "explicit-managed-route",
          parentTurnId: "session-1:turn:7",
          status: "completed",
          profile: "foundation-readonly-plan",
          providerRoute: {
            providerId: "codex-oauth",
            model: "gpt-5.4-mini",
            surface: "direct-provider",
          },
          context: {
            mode: "isolated",
            agentProfile: "architecture-reviewer",
            skills: ["ddd-review"],
            admittedAgentProfile: "architecture-reviewer",
            admittedSkills: ["ddd-review"],
          },
          adapterKind: "direct",
          executionMode: "runtime-direct",
          authorityProfileId: "authority:foundation-readonly-plan",
          capabilitySnapshot: {
            snapshotId: "inv-1:capability-snapshot",
            capturedAt: "2026-05-07T08:00:00.000Z",
            routeId: "codex-oauth",
            routeSource: "explicit-managed-route",
            routeHealth: {
              status: "healthy",
              reason: "Configured managed invocation route selected.",
            },
            providerModelProof: {
              status: "live-proven",
              source: "managed-invocation-route-health",
            },
            resourcePlane: {
              available: true,
              resourceUris: [],
            },
            resourceLease: {
              leaseId: "inv-1:resource-lease",
              createdAt: "2026-05-07T08:00:00.000Z",
              healthStatus: "healthy",
              cleanupStatus: "not-required",
              workingDirectoryPath: "C:/workspace/kiln",
              workingDirectoryMode: "read-only",
              resourceUris: ["kiln://resources/context.md"],
              diagnosticUris: ["kiln://artifacts/inv-1/lease-diagnostics"],
            },
            childIdentity: {
              agentId: "codex-oauth:foundation-readonly-plan",
              admittedAgentProfile: "architecture-reviewer",
            },
          },
          childSessionId: "child-session-1",
        },
      }),
      status: { state: "succeeded" },
    });

    expect(started.summary).toBe("foundation-readonly-plan via codex-oauth/gpt-5.4-mini (direct-provider) · Execution in progress");
    expect(started.details).toEqual([
      { label: "Tool", value: "managed_agent.invoke" },
      { label: "Tool call ID", value: "tool-1" },
      { label: "Profile", value: "foundation-readonly-plan" },
      { label: "Provider", value: "codex-oauth" },
      { label: "Model", value: "gpt-5.4-mini" },
      { label: "Surface", value: "direct-provider" },
      { label: "Context mode", value: "isolated" },
      { label: "Agent profile", value: "architecture-reviewer" },
      { label: "Skills", value: "ddd-review" },
      { label: "Task", value: "Inspect docs/architecture/coordination/agent-tasks.md." },
      { label: "Summary", value: "Inspect managed agents architecture doc" },
    ]);
    expect(completed.summary).toBe("foundation-readonly-plan via codex-oauth/gpt-5.4-mini (direct-provider) · Inspection completed.");
    expect(completed.details).toEqual([
      { label: "Tool", value: "managed_agent.invoke" },
      { label: "Tool call ID", value: "tool-1" },
      { label: "Status", value: "succeeded" },
      { label: "Result", value: "Inspection completed." },
      { label: "Profile", value: "foundation-readonly-plan" },
      { label: "Provider", value: "codex-oauth" },
      { label: "Model", value: "gpt-5.4-mini" },
      { label: "Surface", value: "direct-provider" },
      { label: "Context mode", value: "isolated" },
      { label: "Agent profile", value: "architecture-reviewer" },
      { label: "Skills", value: "ddd-review" },
      { label: "Admitted profile", value: "architecture-reviewer" },
      { label: "Admitted skills", value: "ddd-review" },
      { label: "Adapter", value: "direct" },
      { label: "Execution", value: "runtime-direct" },
      { label: "Authority", value: "authority:foundation-readonly-plan" },
      { label: "Capability snapshot", value: "inv-1:capability-snapshot" },
      { label: "Captured", value: "2026-05-07T08:00:00.000Z" },
      { label: "Route ID", value: "codex-oauth" },
      { label: "Route source", value: "explicit-managed-route" },
      { label: "Route health", value: "healthy" },
      { label: "Route health reason", value: "Configured managed invocation route selected." },
      { label: "Provider proof", value: "live-proven" },
      { label: "Provider proof source", value: "managed-invocation-route-health" },
      { label: "Resource plane", value: "available" },
      { label: "Resource lease", value: "read-only · C:/workspace/kiln" },
      { label: "Lease ID", value: "inv-1:resource-lease" },
      { label: "Lease created", value: "2026-05-07T08:00:00.000Z" },
      { label: "Lease health", value: "healthy" },
      { label: "Lease cleanup", value: "not-required" },
      { label: "Lease resources", value: "kiln://resources/context.md" },
      { label: "Lease diagnostics", value: "kiln://artifacts/inv-1/lease-diagnostics" },
      { label: "Child identity", value: "architecture-reviewer" },
      { label: "Invocation ID", value: "inv-1" },
      { label: "Parent turn", value: "session-1:turn:7" },
      { label: "Child session", value: "child-session-1" },
      { label: "Task", value: "Inspect docs/architecture/coordination/agent-tasks.md." },
      { label: "Summary", value: "Inspect managed agents architecture doc" },
    ]);
    expect(completed.details).not.toContainEqual({ label: "Provider Route", value: "Structured value" });
  });

  it("presents denied skills from managed invocation context details", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "managed_agent.invoke",
      input: {
        profile: "foundation-readonly-plan",
        providerRoute: {
          providerId: "opencode",
          model: "model-a",
        },
        agentProfile: "architecture-reviewer",
        skills: ["workspace-write"],
        contextMode: "isolated",
        task: "Prepare a managed write review.",
      },
      outputSummary: JSON.stringify({
        output: "Managed invocation denied: Managed invocation denied skill(s): workspace-write",
        isError: true,
        metadata: {
          kind: "managed-invocation",
          routeId: "opencode-readonly",
          status: "denied",
          profile: "foundation-readonly-plan",
          providerRoute: {
            providerId: "opencode",
            model: "model-a",
            surface: "cli-harness",
          },
          context: {
            mode: "isolated",
            agentProfile: "architecture-reviewer",
            skills: ["workspace-write"],
            admittedAgentProfile: "architecture-reviewer",
            deniedSkills: ["workspace-write"],
          },
          adapterKind: "harness",
          executionMode: "cli-harness",
          authorityProfileId: "authority:opencode:readonly",
        },
      }),
      status: { state: "failed" },
    });

    expect(presentation.title).toBe("Failed managed_agent.invoke");
    expect(presentation.details).toContainEqual({ label: "Denied skills", value: "workspace-write" });
    expect(JSON.stringify(presentation.details)).not.toContain("deniedSkills");
  });

  it("presents lifecycle-only managed resource lease evidence in operator details", () => {
    const completed = presentOperatorEventPayload("agent_invocation_completed", {
      invocationId: "inv-lease-only",
      agentId: "agent-reviewer",
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "codex-oauth",
        model: "gpt-5.4-mini",
        surface: "direct-provider",
      },
      managedInvocationEvidence: {
        lifecycle: {
          resourceLease: {
            leaseId: "inv-lease-only:resource-lease",
            createdAt: "2026-05-07T08:00:00.000Z",
            healthStatus: "leaked",
            cleanupStatus: "failed",
            workingDirectoryPath: "C:/workspace/kiln/.kiln/worktrees/inv-lease-only",
            workingDirectoryMode: "isolated-worktree",
            resourceUris: ["kiln://artifacts/inv-lease-only/worktree-lease"],
            diagnosticUris: [
              "kiln://artifacts/inv-lease-only/worktree-lease-cleanup-failed",
              "kiln://artifacts/inv-lease-only/worktree-review-required",
            ],
            worktreeReview: {
              status: "required",
              reason: "dirty-worktree-preserved",
              resourceUris: ["kiln://artifacts/inv-lease-only/worktree-review"],
              diagnosticUris: ["kiln://artifacts/inv-lease-only/worktree-review-required"],
            },
          },
        },
      },
      resultSummary: "Inspection completed.",
    });

    expect(completed.details).toContainEqual({ label: "Resource lease", value: "isolated-worktree · C:/workspace/kiln/.kiln/worktrees/inv-lease-only" });
    expect(completed.details).toContainEqual({ label: "Lease ID", value: "inv-lease-only:resource-lease" });
    expect(completed.details).toContainEqual({ label: "Lease created", value: "2026-05-07T08:00:00.000Z" });
    expect(completed.details).toContainEqual({ label: "Lease health", value: "leaked" });
    expect(completed.details).toContainEqual({ label: "Lease cleanup", value: "failed" });
    expect(completed.details).toContainEqual({ label: "Lease resources", value: "kiln://artifacts/inv-lease-only/worktree-lease" });
    expect(completed.details).toContainEqual({
      label: "Lease diagnostics",
      value: "kiln://artifacts/inv-lease-only/worktree-lease-cleanup-failed, kiln://artifacts/inv-lease-only/worktree-review-required",
    });
    expect(completed.details).toContainEqual({ label: "Worktree review", value: "required · dirty-worktree-preserved" });
    expect(completed.details).toContainEqual({ label: "Worktree review resources", value: "kiln://artifacts/inv-lease-only/worktree-review" });
    expect(completed.details).toContainEqual({ label: "Worktree review diagnostics", value: "kiln://artifacts/inv-lease-only/worktree-review-required" });
  });

  it("presents denied worktree conflict evidence in operator details", () => {
    const failed = presentOperatorEventPayload("agent_invocation_failed", {
      invocationId: "inv-conflict",
      agentId: "agent-reviewer",
      profile: "foundation-apply-approved-writes",
      providerRoute: {
        providerId: "codex-oauth",
        model: "gpt-5.5",
        surface: "cli-harness",
      },
      managedInvocationEvidence: {
        lifecycle: {
          resourceLease: {
            leaseId: "inv-conflict:resource-lease",
            createdAt: "2026-05-07T08:00:00.000Z",
            healthStatus: "stale",
            cleanupStatus: "not-required",
            workingDirectoryPath: "C:/workspace/kiln",
            workingDirectoryMode: "workspace-write",
            resourceUris: ["kiln://artifacts/inv-conflict/worktree-conflict-resource"],
            diagnosticUris: ["kiln://artifacts/inv-conflict/worktree-conflict"],
            worktreeConflict: {
              status: "blocked",
              reason: "same-checkout-write-conflict",
              requestedInvocationId: "inv-conflict",
              conflictingInvocationId: "inv-active",
              workingDirectoryPath: "C:/workspace/kiln",
              workingDirectoryMode: "workspace-write",
              policyId: "managed-agent.worktree.single-active-writer",
              retryAfterInvocationIds: ["inv-active"],
              resourceUris: ["kiln://artifacts/inv-conflict/worktree-conflict-resource"],
              diagnosticUris: ["kiln://artifacts/inv-conflict/worktree-conflict"],
            },
          },
        },
      },
      errorMessage: "Managed invocation denied.",
    });

    expect(failed.details).toContainEqual({ label: "Worktree conflict", value: "blocked · same-checkout-write-conflict" });
    expect(failed.details).toContainEqual({ label: "Requested invocation", value: "inv-conflict" });
    expect(failed.details).toContainEqual({ label: "Conflicting invocation", value: "inv-active" });
    expect(failed.details).toContainEqual({ label: "Conflict worktree", value: "workspace-write · C:/workspace/kiln" });
    expect(failed.details).toContainEqual({ label: "Conflict policy", value: "managed-agent.worktree.single-active-writer" });
    expect(failed.details).toContainEqual({ label: "Retry after", value: "inv-active" });
    expect(failed.details).toContainEqual({ label: "Conflict resources", value: "kiln://artifacts/inv-conflict/worktree-conflict-resource" });
    expect(failed.details).toContainEqual({ label: "Conflict diagnostics", value: "kiln://artifacts/inv-conflict/worktree-conflict" });
  });

  it("does not merge incomplete lifecycle lease deltas into operator details", () => {
    const completed = presentOperatorEventPayload("agent_invocation_completed", {
      invocationId: "inv-partial-lease-delta",
      agentId: "agent-reviewer",
      profile: "foundation-apply-approved-writes",
      providerRoute: {
        providerId: "codex-oauth",
        model: "gpt-5.4-mini",
        surface: "direct-provider",
      },
      capabilitySnapshot: {
        snapshotId: "inv-partial-lease-delta:capability-snapshot",
        capturedAt: "2026-05-07T08:00:00.000Z",
        resourceLease: {
          leaseId: "inv-partial-lease-delta:resource-lease",
          createdAt: "2026-05-07T08:00:00.000Z",
          healthStatus: "healthy",
          cleanupStatus: "pending",
          workingDirectoryPath: "C:/workspace/kiln",
          workingDirectoryMode: "workspace-write",
          resourceUris: ["kiln://resources/context.md"],
          diagnosticUris: [],
        },
      },
      managedInvocationEvidence: {
        lifecycle: {
          resourceLease: {
            healthStatus: "released",
            cleanupStatus: "completed",
            diagnosticUris: ["kiln://artifacts/inv-partial-lease-delta/lease-diagnostics"],
          },
        },
      },
      resultSummary: "Inspection completed.",
    });

    expect(completed.details).not.toContainEqual({ label: "Resource lease", value: "workspace-write · C:/workspace/kiln" });
    expect(completed.details).not.toContainEqual({ label: "Lease health", value: "released" });
    expect(completed.details).not.toContainEqual({ label: "Lease cleanup", value: "completed" });
    expect(completed.details).not.toContainEqual({ label: "Lease diagnostics", value: "kiln://artifacts/inv-partial-lease-delta/lease-diagnostics" });
  });

  it("keeps low-signal runtime telemetry out of the inline transcript", () => {
    const routed = presentOperatorEventPayload("provider_routed", {
      provider: {
        provider: "codex-oauth",
        model: "gpt-5.5",
      },
    });
    const cost = presentOperatorEventPayload("cost_updated", {
      cost: { deltaUsd: 0.0012 },
      usage: { inputTokens: 100, outputTokens: 25 },
    });

    expect(operatorEventTargetsSurface(routed, "conversation_inline")).toBe(false);
    expect(operatorEventTargetsSurface(cost, "conversation_inline")).toBe(false);
    expect(operatorEventTargetsSurface(routed, "activity_panel")).toBe(true);
    expect(operatorEventTargetsSurface(cost, "activity_panel")).toBe(true);
  });

  it("presents lifecycle attribution without exposing raw ledger syntax inline", () => {
    const presentation = presentOperatorEventPayload("lifecycle_attribution_recorded", {
      ledger: {
        sourceEventId: "event-cost-1",
        context: {
          route: "codex-oauth/gpt-5.5",
        },
        records: [
          { source: "unknown", tokenClass: "raw", tokens: 100 },
          { source: "unknown", tokenClass: "generated", tokens: 20 },
          { source: "unknown", tokenClass: "cached", tokens: 30 },
        ],
      },
      summary: {
        totalTokens: 150,
        totalCostUsd: 0.0123,
        bySource: {
          unknown: 150,
        },
      },
      efficiencyEvidence: {
        schemaVersion: "verified-efficiency-evidence-v1",
        sessionId: "session-1",
        turnId: "turn-1",
        observedAt: "2026-07-14T20:00:01.000Z",
        provider: { providerId: "codex-oauth", modelId: "gpt-5.5", billingMode: "metered" },
        policy: {
          owner: "ContextGovernor",
          policyId: "context-whole-block-static-v1",
          configurationHash: `sha256:${"a".repeat(64)}`,
        },
        totals: {
          providerTotalTokens: 150,
          providerTotalCostUsd: 0.0123,
          measured: { tokens: 20, costUsd: 0.002 },
          estimated: { tokens: 50, costUsd: 0.004 },
          cached: { tokens: 30, costUsd: 0.0023 },
          unknown: { tokens: 40, costUsd: 0.003 },
          cacheWritten: { tokens: 10, costUsd: 0.001 },
          avoided: { tokens: 0, costUsd: 0 },
        },
        outcome: "succeeded",
        verification: { status: "not_run", results: [] },
        actions: [],
        savings: [],
        evidenceUris: [],
      },
    });

    expect(presentation.title).toBe("Verified efficiency evidence");
    expect(presentation.summary).toBe("Efficiency: 20 measured · 50 estimated · 30 cached · 0 avoided · verification not_run · context-whole-block-static-v1");
    expect(presentation.details).toEqual([
      { label: "Provider total tokens", value: "150" },
      { label: "Measured tokens", value: "20" },
      { label: "Estimated tokens", value: "50" },
      { label: "Cached tokens", value: "30" },
      { label: "Avoided tokens", value: "0" },
      { label: "Unknown tokens", value: "40" },
      { label: "Policy", value: "ContextGovernor/context-whole-block-static-v1" },
      { label: "Policy configuration", value: `sha256:${"a".repeat(64)}` },
      { label: "Outcome", value: "succeeded" },
      { label: "Verification", value: "not_run" },
      { label: "Savings evidence", value: "0" },
      { label: "Evidence resources", value: "0" },
      { label: "Source event", value: "event-cost-1" },
    ]);
    expect(operatorEventTargetsSurface(presentation, "conversation_inline")).toBe(false);
    expect(operatorEventTargetsSurface(presentation, "activity_panel")).toBe(true);
    expect(JSON.stringify(presentation)).not.toContain("\"records\"");
  });

  it("summarizes JSON-shaped tool output before it reaches inline surfaces", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "read",
      outputSummary: JSON.stringify({
        output: "# Session Model\n\nKiln session identity is provider-agnostic.",
        isError: false,
        metadata: {
          toolName: "read",
          operation: "read",
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("# Session Model");
    expect(presentation.summary).not.toContain("\"output\"");
    expect(presentation.summary).not.toContain("metadata");
  });

  it("unwraps nested JSON tool envelopes before rendering read previews", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "read",
      outputSummary: JSON.stringify({
        output: JSON.stringify({
          output: "# Session Model\n\nKiln session identity is provider-agnostic.",
          isError: false,
          metadata: {
            toolName: "read",
            kind: "file",
            operation: "read",
            filePath: "docs/architecture/session-model.md",
          },
        }),
        isError: false,
        metadata: {
          toolName: "read",
          kind: "file",
          operation: "read",
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("# Session Model");
    expect(presentation.summary).not.toContain("\"output\"");
    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "markdown",
      classification: {
        source: "tool-metadata",
        reason: "read output classified from file metadata and content",
      },
      title: "docs/architecture/session-model.md",
      summary: "# Session Model",
      preview: {
        text: "# Session Model\n\nKiln session identity is provider-agnostic.",
      },
    });
    expect(presentation.toolPresentation?.preview?.text).not.toContain("\"output\"");
  });

  it("uses the full live tool output envelope when outputSummary is a raw JSON summary slice", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "read",
      output: JSON.stringify({
        output: "# Session Model\n\nKiln session identity is provider-agnostic.",
        isError: false,
        metadata: {
          toolName: "read",
          kind: "file",
          operation: "read",
          filePath: "docs/architecture/session-model.md",
        },
      }),
      outputSummary: "{\"output\":\"# Session Model\\n\\nKiln session identity is provider-agnostic.\",\"isError\":false,\"metadata\":{\"toolName\":\"read\"",
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("# Session Model");
    expect(presentation.summary).not.toContain("\"output\"");
    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "markdown",
      title: "docs/architecture/session-model.md",
      preview: {
        text: "# Session Model\n\nKiln session identity is provider-agnostic.",
      },
    });
  });

  it("presents known source files as code with language and file metrics", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "read",
      output: JSON.stringify({
        output: "{\n  \"name\": \"kiln\"\n}",
        isError: false,
        metadata: {
          toolName: "read",
          kind: "file",
          operation: "read",
          filePath: "package.json",
          totalLines: 3,
          totalBytes: 22,
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("3 lines · 22 bytes");
    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "code",
      classification: {
        source: "tool-metadata",
        reason: "read output classified from file metadata and content",
      },
      title: "package.json",
      summary: "3 lines · 22 bytes",
      preview: {
        text: "{\n  \"name\": \"kiln\"\n}",
        language: "json",
      },
    });
  });

  it("uses top-level persisted tool metadata when output is plain text", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-write",
      toolName: "write",
      output: "Wrote 32 characters to C:\\workspace\\kiln\\live_test_visibility.txt",
      outputSummary: "{\"output\":\"Wrote 32 characters",
      metadata: {
        toolName: "write",
        kind: "file",
        operation: "write",
        filePath: "C:\\workspace\\kiln\\live_test_visibility.txt",
        changeType: "modified",
        bytesWritten: 32,
        linesAdded: 1,
        linesRemoved: 1,
        diffPreview: "- kiln gui visibility baseline\n+ kiln gui visibility edit passed",
        diffTruncated: false,
      },
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("1 file changed, 1 addition, 1 removal");
    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "diff",
      classification: {
        source: "tool-metadata",
        reason: "file mutation metadata carries diff evidence",
      },
      title: "C:\\workspace\\kiln\\live_test_visibility.txt",
      preview: {
        text: "- kiln gui visibility baseline\n+ kiln gui visibility edit passed",
      },
    });
    expect(JSON.stringify(presentation.toolPresentation)).not.toContain("Wrote 32 characters");
  });

  it("keeps resource-linked tree results as tree previews instead of generic links", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "tree",
      output: JSON.stringify({
        output: ".\npackages/\n  gui/\n    src/",
        isError: false,
        metadata: {
          toolName: "tree",
          kind: "inspection",
          operation: "tree",
          path: "C:\\workspace\\kiln",
          depth: 2,
          entryCount: 55,
          resourceLinks: [
            {
              uri: "kiln://artifacts/tool-results/artifact_tree/content",
              title: "tree full output",
              mimeType: "text/plain",
              size: 9000,
              relation: "full_output",
            },
          ],
        },
      }),
      outputSummary: "{\"output\":\".\\npackages/\\n  gui/\",\"isError\":false,\"metadata\":{\"toolName\":\"tree\"",
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("55 entries under C:\\workspace\\kiln");
    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "tree",
      classification: {
        source: "tool-metadata",
        reason: "inspection metadata identifies tree output",
      },
      title: "C:\\workspace\\kiln",
      preview: {
        text: ".\npackages/\n  gui/\n    src/",
      },
      resourceLinks: [
        expect.objectContaining({
          uri: "kiln://artifacts/tool-results/artifact_tree/content",
        }),
      ],
    });
    expect(presentation.toolPresentation?.preview?.text).not.toContain("\"output\"");
  });

  it("does not render tree summary output as a tree preview", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "tree",
      output: JSON.stringify({
        output: "20 entries under C:\\workspace\\kiln",
        isError: false,
        metadata: {
          toolName: "tree",
          kind: "inspection",
          operation: "tree",
          path: "C:\\workspace\\kiln",
          entryCount: 20,
          verbosity: "summary",
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("20 entries under C:\\workspace\\kiln");
    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "tree",
      title: "C:\\workspace\\kiln",
      summary: "20 entries under C:\\workspace\\kiln",
    });
    expect(presentation.toolPresentation?.preview).toBeUndefined();
  });

  it("builds tree previews from structured tree output entries", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "tree",
      output: JSON.stringify({
        output: JSON.stringify({
          root: "C:\\workspace\\kiln",
          entries: [
            { name: "docs", type: "directory", depth: 1 },
            { name: "architecture.md", type: "file", depth: 2 },
          ],
          entryCount: 2,
          truncated: false,
        }, null, 2),
        isError: false,
        metadata: {
          toolName: "tree",
          kind: "inspection",
          operation: "tree",
          path: "C:\\workspace\\kiln",
          entryCount: 2,
          verbosity: "structured",
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.toolPresentation?.preview).toEqual({
      text: ".\ndocs/\n  architecture.md",
    });
  });

  it("projects patch results as first-class diff presentations", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "patch",
      outputSummary: JSON.stringify({
        output: "1 file changed, 18 additions, 6 removals",
        isError: false,
        metadata: {
          toolName: "patch",
          kind: "file",
          operation: "patch",
          filePath: "packages/gui/src/components/transcript.tsx",
          fileCount: 1,
          linesAdded: 18,
          linesRemoved: 6,
          diffPreview: "@@ ToolEventDetails @@\n- raw json\n+ typed preview",
          diffTruncated: true,
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "diff",
      title: "packages/gui/src/components/transcript.tsx",
      summary: "1 file changed, 18 additions, 6 removals",
      raw: { available: false },
    });
    expect(presentation.toolPresentation?.fields).toEqual(expect.arrayContaining([
      { label: "Files", value: "1" },
      { label: "Additions", value: "18" },
      { label: "Removals", value: "6" },
    ]));
    expect(presentation.toolPresentation?.preview).toEqual({
      text: "@@ ToolEventDetails @@\n- raw json\n+ typed preview",
      truncated: true,
    });
  });

  it("projects high-volume resource linked outputs without exposing raw packets inline", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "read_many",
      outputSummary: JSON.stringify({
        output: "--- C:\\workspace\\kiln\\docs\\architecture.md\n# Kiln Architecture",
        isError: false,
        metadata: {
          toolName: "read_many",
          kind: "file",
          operation: "read_many",
          fileCount: 24,
          skippedCount: 109,
          totalBytes: 200000,
          truncated: true,
          resourceLinks: [
            {
              uri: "kiln://artifacts/tool-results/artifact_1/content",
              title: "read_many full output",
              mimeType: "text/plain",
              size: 200000,
              relation: "full_output",
            },
          ],
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("24 files read, 109 skipped, 200000 bytes, truncated");
    expect(presentation.summary).not.toContain("--- C:");
    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "resource_links",
      classification: {
        source: "resource-link",
        reason: "large read_many output is represented by resource links",
      },
      title: "read_many full output",
      summary: "24 files read, 109 skipped, 200000 bytes, truncated",
    });
    expect(presentation.toolPresentation?.resourceLinks).toEqual([
      expect.objectContaining({
        uri: "kiln://artifacts/tool-results/artifact_1/content",
        title: "read_many full output",
      }),
    ]);
    expect(presentation.toolPresentation?.raw).toEqual({
      available: true,
      resourceUri: "kiln://artifacts/tool-results/artifact_1/content",
    });
  });

  it("projects browser screenshot resources as numbered transcript capture evidence", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-browser-1",
      toolName: "browser_observe",
      output: JSON.stringify({
        output: "observe: https://example.com",
        isError: false,
        metadata: {
          toolName: "browser_observe",
          kind: "interactive",
          target: "browser",
          operation: "observe",
          provider: "playwright",
          sessionId: "browser-1",
          observation: {
            url: "https://example.com",
            title: "Example Domain",
            screenshotUri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
          },
          resourceLinks: [
            {
              uri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
              title: "browser_observe screenshot",
              mimeType: "image/png",
              size: 1234,
              relation: "snapshot",
              label: "Capture 1",
              sequence: 1,
            },
            {
              uri: "kiln://artifacts/browser-debug/artifact_2/content",
              title: "browser diagnostic payload",
              mimeType: "application/json",
              size: 456,
              relation: "full_output",
            },
          ],
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("Capture 1: Example Domain");
    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "image",
      classification: {
        source: "resource-link",
        reason: "browser snapshot resource links identify image output",
      },
      title: "Browser screenshots",
      summary: "Capture 1: Example Domain",
      raw: {
        available: true,
        resourceUri: "kiln://artifacts/browser-debug/artifact_2/content",
      },
    });
    expect(presentation.toolPresentation?.resourceLinks).toEqual([
      expect.objectContaining({
        uri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
        label: "Capture 1",
        sequence: 1,
        relation: "snapshot",
      }),
      expect.objectContaining({
        uri: "kiln://artifacts/browser-debug/artifact_2/content",
        relation: "full_output",
      }),
    ]);
    expect(JSON.stringify(presentation)).not.toContain("data:image");
  });

  it("does not invent raw availability or diff previews for write summaries", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "write",
      output: JSON.stringify({
        output: "Wrote 9 characters to C:\\workspace\\kiln\\example.txt",
        isError: false,
        metadata: {
          toolName: "write",
          kind: "file",
          operation: "write",
          filePath: "C:\\workspace\\kiln\\example.txt",
          bytesWritten: 9,
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "diff",
      title: "C:\\workspace\\kiln\\example.txt",
      raw: { available: false },
    });
    expect(presentation.toolPresentation?.preview).toBeUndefined();
  });

  it("projects write diff evidence when the canonical payload carries it", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "write",
      output: JSON.stringify({
        output: "Wrote 9 characters to C:\\workspace\\kiln\\example.txt",
        isError: false,
        metadata: {
          toolName: "write",
          kind: "file",
          operation: "write",
          filePath: "C:\\workspace\\kiln\\example.txt",
          changeType: "modified",
          bytesWritten: 9,
          linesAdded: 1,
          linesRemoved: 1,
          diffPreview: "- old text\n+ new text",
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "diff",
      summary: "1 file changed, 1 addition, 1 removal",
      preview: {
        text: "- old text\n+ new text",
      },
    });
    expect(presentation.toolPresentation?.preview?.text).not.toContain("Wrote 9 characters");
  });

  it("projects edit diff evidence instead of generic edit summaries", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "edit",
      output: JSON.stringify({
        output: "Applied 1 replacement in C:\\workspace\\kiln\\im_alive.txt",
        isError: false,
        metadata: {
          toolName: "edit",
          kind: "file",
          operation: "edit",
          filePath: "C:\\workspace\\kiln\\im_alive.txt",
          changeType: "modified",
          replacements: 1,
          linesAdded: 1,
          linesRemoved: 1,
          diffPreview: "- im alive\n+ im alive and testing diff",
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("1 file changed, 1 addition, 1 removal");
    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "diff",
      title: "C:\\workspace\\kiln\\im_alive.txt",
      preview: {
        text: "- im alive\n+ im alive and testing diff",
      },
    });
  });

  it("projects stat metadata without exposing JSON braces inline", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "stat",
      output: JSON.stringify({
        output: JSON.stringify({
          path: "C:\\workspace\\kiln\\im_alive.txt",
          type: "file",
          size: 25,
          modifiedTime: "2026-04-30T12:33:05.305Z",
        }, null, 2),
        isError: false,
        metadata: {
          toolName: "stat",
          kind: "inspection",
          operation: "stat",
          path: "C:\\workspace\\kiln\\im_alive.txt",
          type: "file",
          size: 25,
          modifiedTime: "2026-04-30T12:33:05.305Z",
          hashAlgorithm: "none",
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("file · 25 bytes");
    expect(presentation.summary).not.toContain("{");
    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "text",
      title: "C:\\workspace\\kiln\\im_alive.txt",
      summary: "file · 25 bytes",
    });
    expect(presentation.toolPresentation?.fields).toEqual(expect.arrayContaining([
      { label: "Type", value: "file" },
      { label: "Size", value: "25 bytes" },
    ]));
    expect(presentation.toolPresentation?.preview).toBeUndefined();
  });

  it("projects OCR text and backend errors without JSON previews", () => {
    const success = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "ocr_image",
      output: JSON.stringify({
        output: JSON.stringify({
          path: "C:\\workspace\\kiln\\docs\\image.png",
          mimeType: "image/png",
          language: "eng",
          text: "HELLO",
          source: "tesseract",
        }, null, 2),
        isError: false,
        metadata: {
          toolName: "ocr_image",
          kind: "media",
          operation: "ocr",
          path: "C:\\workspace\\kiln\\docs\\image.png",
          mimeType: "image/png",
          language: "eng",
          textLength: 5,
          source: "tesseract",
        },
      }),
      status: { state: "succeeded" },
    });

    expect(success.summary).toBe("HELLO");
    expect(success.toolPresentation?.preview).toEqual({ text: "HELLO" });
    expect(success.toolPresentation?.preview?.text).not.toContain("{");

    const failure = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-2",
      toolName: "ocr_image",
      output: "OCR backend unavailable: tesseract executable was not found on PATH.",
      status: { state: "failed" },
    });

    expect(failure.summary).toBe("OCR backend unavailable: tesseract executable was not found on PATH.");
    expect(failure.summary).not.toContain("{");
  });

  it("records fallback evidence when a supplied presentation intent is invalid", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-invalid-intent",
      toolName: "managed_agent.invoke",
      output: JSON.stringify({
        output: "Managed invocation produced a textual fallback.",
        isError: false,
        metadata: {
          toolName: "managed_agent.invoke",
          presentationIntent: {
            kind: "comparison_table",
            title: "Broken comparison",
            rows: [{ route: "codex" }],
          },
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "text",
      classification: {
        source: "fallback",
        reason: "invalid presentation intent fell back to textual output",
      },
    });
    expect(presentation.toolPresentation?.classification.fallbackReason).toContain("columns");
    expect(presentation.toolPresentation?.preview?.text).toBe("Managed invocation produced a textual fallback.");
    expect(JSON.stringify(presentation.toolPresentation)).not.toContain("\"presentationIntent\"");
  });

  it("presents managed_economic_lifecycle transitions with distinct tone and title", () => {
    const held = presentOperatorEventPayload("managed_economic_lifecycle", {
      jobId: "managed-economic-job:fixture",
      economicAttemptId: "economic-attempt:fixture:1",
      transition: "held",
      policyId: "fixture-policy",
      policyRevision: "1",
      selectedRoute: {
        routeId: "fixture-route",
        providerId: "codex-oauth",
        modelId: "gpt-test",
      },
    });
    expect(held.title).toBe("Economic route committed");
    expect(held.tone).toBe("info");
    expect(held.summary).toContain("fixture-policy");
    expect(held.summary).toContain("codex-oauth/gpt-test");
    expect(held.details).toContainEqual({ label: "Route", value: "codex-oauth/gpt-test" });

    const denied = presentOperatorEventPayload("managed_economic_lifecycle", {
      jobId: "managed-economic-job:fixture",
      economicAttemptId: "economic-attempt:fixture:1",
      transition: "denied",
      policyId: "fixture-policy",
      policyRevision: "1",
      reason: "no candidate met the strict quota ceiling",
    });
    expect(denied.title).toBe("Economic route denied");
    expect(denied.tone).toBe("error");
    expect(denied.summary).toContain("no candidate met the strict quota ceiling");

    const released = presentOperatorEventPayload("managed_economic_lifecycle", {
      jobId: "managed-economic-job:fixture",
      economicAttemptId: "economic-attempt:fixture:1",
      transition: "released",
      policyId: "fixture-policy",
      policyRevision: "1",
      settlementKind: "charged",
    });
    expect(released.title).toBe("Economic reservation released");
    expect(released.tone).toBe("success");

    const leaked = presentOperatorEventPayload("managed_economic_lifecycle", {
      jobId: "managed-economic-job:fixture",
      economicAttemptId: "economic-attempt:fixture:1",
      transition: "leaked",
      policyId: "fixture-policy",
      policyRevision: "1",
    });
    expect(leaked.title).toBe("Economic reservation leaked");
    expect(leaked.tone).toBe("warning");
  });

  it("renders nothing for an economic payload field it was never told to render", () => {
    const presentation = presentOperatorEventPayload("managed_economic_lifecycle", {
      jobId: "managed-economic-job:fixture",
      economicAttemptId: "economic-attempt:fixture:1",
      transition: "held",
      policyId: "fixture-policy",
      policyRevision: "1",
      policyDigest: "sha256:fixture-policy-digest",
      credentialFileIdentity: "a".repeat(64),
      rawProviderResponse: "sk-live-should-never-surface",
      operatorHomePath: "/Users/operator/.kiln/credentials",
    });

    const serialized = JSON.stringify(presentation);
    expect(serialized).not.toContain("sk-live-should-never-surface");
    expect(serialized).not.toContain("/Users/operator/.kiln/credentials");
    expect(serialized).not.toContain("a".repeat(64));
    expect(presentation.details.map((item) => item.label)).toEqual([
      "Job",
      "Attempt",
      "Transition",
      "Policy",
      "Policy revision",
    ]);
  });
});
