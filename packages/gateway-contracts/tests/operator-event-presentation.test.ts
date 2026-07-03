import { describe, expect, it } from "vitest";
import {
  formatOperatorEventValue,
  operatorEventTargetsConversation,
  operatorEventTargetsSurface,
  presentOperatorEventPayload,
} from "../src/operator-event-presentation.js";

describe("operator event presentation", () => {
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
        planId: "plan-1",
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
      { label: "Plan", value: "plan-1" },
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

  it("presents turn completion nested data as operator detail rows", () => {
    const presentation = presentOperatorEventPayload("turn_completed", {
      routedProvider: "codex-oauth",
      routedModel: "gpt-5.4-mini",
      outcome: "completed",
      runtimeContinuity: {
        strategy: "fallback-replay",
        selectionReason: "no-sources",
      },
      authorityStatus: {
        effective: "destructive",
      },
      inputTokens: 1398,
      outputTokens: 11,
    });

    expect(presentation.details).toEqual([
      { label: "Provider", value: "codex-oauth" },
      { label: "Model", value: "gpt-5.4-mini" },
      { label: "Outcome", value: "completed" },
      { label: "Continuity", value: "fallback-replay" },
      { label: "Why", value: "no-sources" },
      { label: "Authority", value: "destructive" },
      { label: "Input tokens", value: "1398" },
      { label: "Output tokens", value: "11" },
    ]);
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

    expect(started.title).toBe("Using read_many");
    expect(started.surfaces).toEqual(["conversation_inline", "activity_panel", "inspector"]);
    expect(operatorEventTargetsSurface(started, "conversation_inline")).toBe(true);

    expect(completed.title).toBe("Completed read_many");
    expect(completed.summary).toBe("24 files read, 109 skipped");
    expect(completed.surfaces).toEqual(["conversation_inline", "activity_panel", "inspector"]);
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
        task: "Inspect docs/architecture/managed-agents.md.",
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
        task: "Inspect docs/architecture/managed-agents.md.",
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
      { label: "Task", value: "Inspect docs/architecture/managed-agents.md." },
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
      { label: "Task", value: "Inspect docs/architecture/managed-agents.md." },
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
    });

    expect(presentation.title).toBe("Lifecycle attribution recorded");
    expect(presentation.summary).toBe("150 tokens · $0.0123 · 150 unknown");
    expect(presentation.details).toEqual([
      { label: "Tokens", value: "150" },
      { label: "Cost", value: "$0.0123" },
      { label: "Unknown source tokens", value: "150" },
      { label: "Records", value: "3" },
      { label: "Route", value: "codex-oauth/gpt-5.5" },
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
});
