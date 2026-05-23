import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDefaultBuiltinToolSurface } from "../../../src/tools/default-tool-surface.js";
import { ToolResourceRegistry } from "../../../src/tools/domain/tool-resource-registry.js";
import { AnalysisStateStore } from "../../../src/tools/infrastructure/analysis-state-store.js";
import { AuthorityStateStore } from "../../../src/tools/infrastructure/authority-state-store.js";
import { MemoryArtifactResourceStore } from "../../../src/tools/infrastructure/artifact-resource-store.js";
import { PlanStateStore } from "../../../src/tools/infrastructure/plan-state-store.js";
import { SpecificationStateStore } from "../../../src/tools/infrastructure/specification-state-store.js";
import { GoalRunStore, startGoalExecutionAttempt, WorkItemStore } from "../../../src/work-governance/index.js";
import { makeSandbox, makeTempDir, removeTempDir } from "../infrastructure/test-utils.js";

describe("ToolResourceRegistry", () => {
  it("lists stable read-only resources and templates from the shared tool surface", () => {
    const surface = createDefaultBuiltinToolSurface();

    expect(surface.resources).toBeInstanceOf(ToolResourceRegistry);
    expect(surface.resources.list().map((resource) => resource.uri)).toEqual([
      "kiln://tools/catalog",
      "kiln://session/tasks",
      "kiln://session/monitors",
    ]);
    expect(surface.resources.listTemplates().map((template) => template.uriTemplate)).toEqual([
      "kiln://tools/catalog/{name}",
      "kiln://session/tasks/{id}",
      "kiln://session/monitors/{id}",
      "kiln://artifacts/{namespace}",
      "kiln://artifacts/{namespace}/{id}",
      "kiln://artifacts/{namespace}/{id}/content",
    ]);
  });

  it("paginates resources with opaque cursors while preserving no-arg listing", () => {
    const surface = createDefaultBuiltinToolSurface();

    const firstPage = surface.resources.listPage({ limit: 2 });
    const secondPage = surface.resources.listPage({ cursor: firstPage.nextCursor, limit: 2 });

    expect(surface.resources.list().map((resource) => resource.uri)).toEqual([
      "kiln://tools/catalog",
      "kiln://session/tasks",
      "kiln://session/monitors",
    ]);
    expect(firstPage.items.map((resource) => resource.uri)).toEqual([
      "kiln://tools/catalog",
      "kiln://session/tasks",
    ]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(firstPage.nextCursor).not.toBe("2");
    expect(secondPage.items.map((resource) => resource.uri)).toEqual([
      "kiln://session/monitors",
    ]);
    expect(secondPage.nextCursor).toBeUndefined();
  });

  it("includes configured resource providers in the shared registry", async () => {
    const surface = createDefaultBuiltinToolSurface({
      resourceProviders: [{
        listResources: () => [{
          uri: "kiln://custom/resource",
          name: "custom_resource",
          mimeType: "application/json",
          annotations: { readOnlyHint: true },
        }],
        listTemplates: () => [{
          uriTemplate: "kiln://custom/resource/{id}",
          name: "custom_resource_detail",
          mimeType: "application/json",
          annotations: { readOnlyHint: true },
        }],
        read: async (uri: string) => {
          if (uri !== "kiln://custom/resource") {
            return undefined;
          }
          return {
            contents: [{
              uri,
              mimeType: "application/json",
              text: JSON.stringify({ ok: true }),
            }],
          };
        },
      }],
    });

    expect(surface.resources.list().map((resource) => resource.uri)).toContain("kiln://custom/resource");
    expect(surface.resources.listTemplates().map((template) => template.uriTemplate)).toContain(
      "kiln://custom/resource/{id}",
    );
    await expect(surface.resources.read("kiln://custom/missing")).rejects.toThrow("Resource not found");
    const result = await surface.resources.read("kiln://custom/resource");
    expect(JSON.parse(result.contents[0]!.text)).toEqual({ ok: true });
  });

  it("paginates resource templates with their own cursor namespace", () => {
    const surface = createDefaultBuiltinToolSurface();

    const firstPage = surface.resources.listTemplatePage({ limit: 1 });
    const secondPage = surface.resources.listTemplatePage({ cursor: firstPage.nextCursor, limit: 2 });
    const thirdPage = surface.resources.listTemplatePage({ cursor: secondPage.nextCursor, limit: 3 });

    expect(firstPage.items.map((template) => template.uriTemplate)).toEqual([
      "kiln://tools/catalog/{name}",
    ]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(secondPage.items.map((template) => template.uriTemplate)).toEqual([
      "kiln://session/tasks/{id}",
      "kiln://session/monitors/{id}",
    ]);
    expect(secondPage.nextCursor).toEqual(expect.any(String));
    expect(thirdPage.items.map((template) => template.uriTemplate)).toEqual([
      "kiln://artifacts/{namespace}",
      "kiln://artifacts/{namespace}/{id}",
      "kiln://artifacts/{namespace}/{id}/content",
    ]);
    expect(thirdPage.nextCursor).toBeUndefined();
  });

  it("rejects invalid, stale, and out-of-range pagination cursors", () => {
    const surface = createDefaultBuiltinToolSurface();
    const resourceCursor = surface.resources.listPage({ limit: 1 }).nextCursor;
    const templateCursor = surface.resources.listTemplatePage({ limit: 1 }).nextCursor;
    const outOfRangeCursor = encodeTestCursor({
      ...decodeTestCursor(resourceCursor),
      offset: 999,
    });

    expect(() => surface.resources.listPage({ cursor: "not-a-cursor", limit: 1 })).toThrow("Invalid resource cursor");
    expect(() => surface.resources.listPage({ cursor: templateCursor, limit: 1 })).toThrow("Stale resource cursor");
    expect(() => surface.resources.listPage({ cursor: outOfRangeCursor, limit: 1 })).toThrow("Out-of-range resource cursor");
  });

  it("rejects non-positive pagination limits", () => {
    const surface = createDefaultBuiltinToolSurface();

    expect(() => surface.resources.listPage({ limit: 0 })).toThrow("Invalid resource page limit");
    expect(() => surface.resources.listTemplatePage({ limit: 0.5 })).toThrow("Invalid resource page limit");
  });

  it("reads the tool catalog as a JSON resource", async () => {
    const surface = createDefaultBuiltinToolSurface();

    const result = await surface.resources.read("kiln://tools/catalog");

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]).toMatchObject({
      uri: "kiln://tools/catalog",
      mimeType: "application/json",
    });
    const payload = JSON.parse(result.contents[0]!.text);
    expect(payload.totalIndexed).toBe(45);
    expect(payload.entries.map((entry: { name: string }) => entry.name)).toContain("operator_elicit");
  });

  it("exposes governed work items when a session work item store is attached", async () => {
    const goalRunStore = new GoalRunStore({ now: () => "2026-05-12T20:00:00.000Z" });
    const workItemStore = new WorkItemStore({ now: () => "2026-05-12T20:00:00.000Z" });
    const surface = createDefaultBuiltinToolSurface({ goalRunStore, workItemStore });
    const item = workItemStore.upsert({
      summary: "Verify runtime work evidence",
      workflowProfile: "verification-heavy",
      triggers: ["verification-heavy"],
      expectedEvidence: ["tests", "typecheck"],
      providedEvidence: ["tests"],
      verificationGates: ["bun run typecheck"],
      planId: "plan-1",
      planHash: "sha256:plan",
      goalRunId: "goal-1",
      sourceWorkItemId: "draft-1",
      pauseRequirements: [
        {
          id: "operator-input-1",
          kind: "operator_input",
          summary: "Confirm test credentials are available.",
          status: "resolved",
          resolvedBy: "operator",
          resolvedAt: "2026-05-12T20:00:00.000Z",
          resolution: "Credentials are available.",
        },
      ],
      routingRecommendation: {
        routeId: "codex-worker",
        agentProfile: "coder",
        reasoningEffort: "high",
        modelTaskSuitability: "verification-heavy:high",
        rationale: "Derived from approved plan.",
      },
    });
    const goal = goalRunStore.create({
      id: "goal-1",
      objective: "Verify runtime work evidence.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      planHash: "sha256:plan",
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan permits audited execution.",
      },
      routePolicy: { workflowProfile: "verification-heavy" },
      evidenceRequirements: [],
    });
    const started = startGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      executionMode: "managed_delegation",
      managedInvocationId: "invocation-1",
      summary: "Run managed verification.",
    });

    expect(surface.resources.list()).toContainEqual(expect.objectContaining({
      uri: "kiln://session/work-items",
      description: expect.stringContaining("execution attempts"),
    }));
    expect(surface.resources.listTemplates().map((template) => template.uriTemplate)).toContain("kiln://session/work-items/{id}");

    const snapshot = await surface.resources.read("kiln://session/work-items");
    expect(JSON.parse(snapshot.contents[0]!.text)).toMatchObject({
      sequence: started.item.sequence,
      items: [
        {
          id: item.id,
          summary: "Verify runtime work evidence",
          providedEvidence: ["tests"],
          planId: "plan-1",
          goalRunId: "goal-1",
          sourceWorkItemId: "draft-1",
          pauseRequirements: [
            expect.objectContaining({
              id: "operator-input-1",
              status: "resolved",
            }),
          ],
          executionAttempts: [
            expect.objectContaining({
              id: started.attempt.id,
              status: "started",
              executionMode: "managed_delegation",
              managedInvocationId: "invocation-1",
            }),
          ],
        },
      ],
    });

    const single = await surface.resources.read(`kiln://session/work-items/${item.id}`);
    expect(JSON.parse(single.contents[0]!.text)).toMatchObject({
      id: item.id,
      expectedEvidence: ["tests", "typecheck"],
      planHash: "sha256:plan",
      executionAttempts: [
        expect.objectContaining({
          id: started.attempt.id,
          managedInvocationId: "invocation-1",
        }),
      ],
      routingRecommendation: {
        routeId: "codex-worker",
        reasoningEffort: "high",
      },
    });
  });

  it("exposes goal runs when a session goal-run store is attached", async () => {
    const goalRunStore = new GoalRunStore({ now: () => "2026-05-12T18:00:00.000Z" });
    const surface = createDefaultBuiltinToolSurface({ goalRunStore });
    const goal = goalRunStore.create({
      id: "goal-1",
      objective: "Execute approved plan.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: ["wi-1"],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Plan permits audited execution.",
      },
      routePolicy: { workflowProfile: "architecture-change" },
      evidenceRequirements: [
        { id: "tests", description: "Tests pass.", required: true },
      ],
    });

    expect(surface.resources.list().map((resource) => resource.uri)).toContain("kiln://session/goals");
    expect(surface.resources.listTemplates().map((template) => template.uriTemplate)).toContain("kiln://session/goals/{id}");

    const snapshot = await surface.resources.read("kiln://session/goals");
    expect(JSON.parse(snapshot.contents[0]!.text)).toMatchObject({
      sequence: goal.sequence,
      goals: [
        {
          id: "goal-1",
          status: "active",
          planId: "plan-1",
          workItemIds: ["wi-1"],
        },
      ],
    });

    const single = await surface.resources.read(`kiln://session/goals/${goal.id}`);
    expect(JSON.parse(single.contents[0]!.text)).toMatchObject({
      id: "goal-1",
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
      },
    });
  });

  it("exposes effective authority snapshots when a session authority store is attached", async () => {
    const authorityStateStore = new AuthorityStateStore({
      now: () => "2026-05-12T22:30:00.000Z",
    });
    const surface = createDefaultBuiltinToolSurface({ authorityStateStore });
    const authority = authorityStateStore.record({
      turnId: "session-1:turn:1",
      source: "gui",
      authority: {
        executionMode: "execute",
        requestedAuthority: "read_only",
        admittedAuthority: "read_only",
        sourcePolicy: "runtime_surface_projection",
        reason: "Operator requested read-only authority.",
        completeness: "authoritative",
        toolCount: 6,
        deniedToolCount: 3,
        sandboxProjection: "read_only",
        policyInputs: [
          {
            source: "requested_authority",
            status: "applied",
            requestedAuthority: "read_only",
            reason: "Operator requested read_only authority.",
          },
        ],
      },
    });

    expect(surface.resources.list().map((resource) => resource.uri)).toContain("kiln://session/authority");
    expect(surface.resources.listTemplates().map((template) => template.uriTemplate)).toContain("kiln://session/authority/{id}");

    const snapshot = await surface.resources.read("kiln://session/authority");
    expect(JSON.parse(snapshot.contents[0]!.text)).toMatchObject({
      sequence: authority.sequence,
      latest: {
        id: authority.id,
        turnId: "session-1:turn:1",
        source: "gui",
        authority: {
          requestedAuthority: "read_only",
          admittedAuthority: "read_only",
          toolCount: 6,
          deniedToolCount: 3,
        },
      },
      authorities: [
        {
          id: authority.id,
          recordedAt: "2026-05-12T22:30:00.000Z",
        },
      ],
    });

    const single = await surface.resources.read(`kiln://session/authority/${authority.id}`);
    expect(JSON.parse(single.contents[0]!.text)).toMatchObject({
      id: authority.id,
      authority: {
        executionMode: "execute",
        sourcePolicy: "runtime_surface_projection",
      },
    });
  });

  it("exposes structured specifications and clarifications when a specification store is attached", async () => {
    const specificationStateStore = new SpecificationStateStore();
    const surface = createDefaultBuiltinToolSurface({ specificationStateStore });
    const specification = specificationStateStore.upsertSpecification({
      title: "Slice 1",
      objective: "Implement structured specification intake.",
      nonGoals: ["Do not execute implementation in plan mode."],
      successCriteria: ["Plan mode accepts typed specification artifacts."],
      actors: ["operator", "runtime"],
      dataLifecycle: "Intake and validation occur during plan turns only.",
      uxEdgeCases: ["Missing clarification responses"],
      securityPrivacy: "No secrets in specification content.",
      externalDependencies: ["none"],
      completionSignals: ["Specification status is ready_for_plan."],
      constitutionSnapshot: {
        instructionProfileHash: "hash-1",
        instructionProfileIds: ["sequel-engineering"],
      },
    });
    const clarificationResult = specificationStateStore.recordClarification({
      specificationId: specification.id,
      question: "Should plan mode mutate files?",
      answer: "No.",
      affectedSection: "authority",
      rationale: "Plan mode is read-only by contract.",
    });
    if ("error" in clarificationResult) {
      throw new Error(clarificationResult.error);
    }

    expect(surface.resources.list().map((resource) => resource.uri)).toContain("kiln://session/specifications");
    expect(surface.resources.list().map((resource) => resource.uri)).toContain("kiln://session/clarifications");
    expect(surface.resources.listTemplates().map((template) => template.uriTemplate)).toContain("kiln://session/specifications/{id}");
    expect(surface.resources.listTemplates().map((template) => template.uriTemplate)).toContain("kiln://session/clarifications/{specificationId}");

    const snapshot = await surface.resources.read("kiln://session/specifications");
    expect(JSON.parse(snapshot.contents[0]!.text)).toMatchObject({
      specifications: [
        {
          id: specification.id,
          title: "Slice 1",
          status: "ready_for_plan",
        },
      ],
    });

    const clarifications = await surface.resources.read(`kiln://session/clarifications/${specification.id}`);
    expect(JSON.parse(clarifications.contents[0]!.text)).toMatchObject({
      specificationId: specification.id,
      clarifications: [
        {
          affectedSection: "authority",
          answer: "No.",
        },
      ],
    });
  });

  it("exposes structured plans when a plan store is attached", async () => {
    const planStateStore = new PlanStateStore();
    const surface = createDefaultBuiltinToolSurface({ planStateStore });
    const plan = planStateStore.submitPlan({
      objective: "Implement structured plan submission contract.",
      nonGoals: ["Do not execute implementation in plan mode."],
      operatorDecisionsRequired: ["Approve escalation policy for high-risk slices."],
      assumptions: ["Session-scoped plan artifacts are sufficient in Slice 2."],
      affectedSurfaces: ["runtime", "gateway-contracts", "cli"],
      riskClassification: "high",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "Multi-file cross-surface behavior.",
        workflowProfile: "architecture-change",
      },
      proposedWorkItems: [{
        id: "wi-1",
        summary: "Add typed plan schema and runtime validation.",
        workflowProfile: "architecture-change",
        risk: "high",
        expectedEvidence: ["tests", "typecheck"],
        verificationGates: ["bun test", "bun run typecheck"],
        dependencies: [],
      }],
      expectedEvidence: ["tests", "typecheck", "review"],
      verificationGates: ["bun test", "bun run typecheck"],
      managedAgentDelegationCandidates: ["reviewer"],
      approvalBoundaries: ["plan approval required before execute mode"],
      rollbackNotes: "Keep plan event shape backward-compatible at projection level.",
      residualRisks: ["Event consumers may require snapshot updates."],
      sourceSpecificationId: "spec_1",
      clarificationRecordIds: ["clar_1"],
      constitutionSnapshot: {
        instructionProfileHash: "hash-1",
        instructionProfileIds: ["sequel-engineering"],
      },
    });

    expect(surface.resources.list().map((resource) => resource.uri)).toContain("kiln://session/plans");
    expect(surface.resources.listTemplates().map((template) => template.uriTemplate)).toContain("kiln://session/plans/{id}");

    const snapshot = await surface.resources.read("kiln://session/plans");
    expect(JSON.parse(snapshot.contents[0]!.text)).toMatchObject({
      sequence: plan.sequence,
      plans: [{ id: plan.id, status: "ready_for_approval" }],
    });

    const single = await surface.resources.read(`kiln://session/plans/${plan.id}`);
    expect(JSON.parse(single.contents[0]!.text)).toMatchObject({
      id: plan.id,
      riskClassification: "high",
      sourceSpecificationId: "spec_1",
    });
  });

  it("exposes analysis reports and findings when an analysis store is attached", async () => {
    const analysisStateStore = new AnalysisStateStore();
    const specificationStateStore = new SpecificationStateStore();
    const planStateStore = new PlanStateStore();
    const surface = createDefaultBuiltinToolSurface({
      analysisStateStore,
      specificationStateStore,
      planStateStore,
    });

    const specification = specificationStateStore.upsertSpecification({
      title: "Slice 3",
      objective: "Introduce a plan/spec analysis gate.",
      nonGoals: ["Do not start implementation before critical findings are resolved."],
      successCriteria: ["Critical findings block approval."],
      actors: ["operator"],
      dataLifecycle: "Analysis reports are projected as read-only resources.",
      uxEdgeCases: ["Stale findings after plan revisions"],
      securityPrivacy: "No secrets in analysis findings.",
      externalDependencies: ["none"],
      completionSignals: ["analysis report emits canonical event"],
      constitutionSnapshot: {
        instructionProfileHash: "hash-3",
        instructionProfileIds: ["sequel-engineering"],
      },
    });
    const plan = planStateStore.submitPlan({
      objective: "Add analysis model and runtime gate.",
      nonGoals: ["Do not execute code changes in plan mode."],
      operatorDecisionsRequired: ["Approve analysis findings before execution"],
      assumptions: ["Plan/work-item linkage remains canonical."],
      affectedSurfaces: ["core", "runtime"],
      riskClassification: "high",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "Cross-surface workflow contract.",
        workflowProfile: "architecture-change",
      },
      proposedWorkItems: [{
        id: "wi-1",
        summary: "Add consistency analyzer",
        workflowProfile: "architecture-change",
        risk: "high",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: [],
      }],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      managedAgentDelegationCandidates: [],
      approvalBoundaries: ["Block approval on critical findings."],
      rollbackNotes: "Revert analysis gate.",
      residualRisks: ["none"],
      sourceSpecificationId: specification.id,
      clarificationRecordIds: [],
      constitutionSnapshot: {
        instructionProfileHash: "hash-3",
        instructionProfileIds: ["sequel-engineering"],
      },
    });
    const analysis = analysisStateStore.analyzePlan({ specification, plan });

    expect(surface.resources.list().map((resource) => resource.uri)).toContain("kiln://session/analysis-reports");
    expect(surface.resources.list().map((resource) => resource.uri)).toContain("kiln://session/analysis-findings");
    expect(surface.resources.listTemplates().map((template) => template.uriTemplate)).toContain("kiln://session/analysis-reports/{id}");
    expect(surface.resources.listTemplates().map((template) => template.uriTemplate)).toContain("kiln://session/analysis-findings/{id}");

    const reports = await surface.resources.read("kiln://session/analysis-reports");
    expect(JSON.parse(reports.contents[0]!.text)).toMatchObject({
      reports: [
        {
          id: analysis.report.id,
          planId: plan.id,
          specificationId: specification.id,
        },
      ],
    });

    const findingId = analysis.findings[0]?.id;
    expect(findingId).toBeDefined();
    const finding = await surface.resources.read(`kiln://session/analysis-findings/${findingId}`);
    expect(JSON.parse(finding.contents[0]!.text)).toMatchObject({
      id: findingId,
      status: "open",
    });
  });

  it("reads individual tool catalog entries through the catalog template", async () => {
    const surface = createDefaultBuiltinToolSurface();

    const result = await surface.resources.read("kiln://tools/catalog/read_many");

    const payload = JSON.parse(result.contents[0]!.text);
    expect(payload).toMatchObject({
      name: "read_many",
      sourcePackage: "@kilnai/core",
      authority: "read_only",
    });
    expect(payload.inputFields).toContain("paths");
  });

  it("projects shared task state through resources without mutating it", async () => {
    const surface = createDefaultBuiltinToolSurface();
    surface.taskStateStore.update({
      title: "Document Slice 18",
      status: "in_progress",
      details: "resource projection",
    });

    const listResult = await surface.resources.read("kiln://session/tasks");
    const taskResult = await surface.resources.read("kiln://session/tasks/task_1");

    expect(JSON.parse(listResult.contents[0]!.text)).toMatchObject({
      sequence: 1,
      tasks: [{ id: "task_1", status: "in_progress", title: "Document Slice 18" }],
    });
    expect(JSON.parse(taskResult.contents[0]!.text)).toMatchObject({
      id: "task_1",
      status: "in_progress",
      title: "Document Slice 18",
    });
  });

  it("projects monitor snapshots and events through resources", async () => {
    const surface = createDefaultBuiltinToolSurface({
      monitor: {
        commandRunner: {
          start: (_request, sink) => {
            sink.stdout("ready\n");
            sink.finish({ exitCode: 0 });
            return { stop: async () => undefined };
          },
        },
        now: () => 1_800_000_000_000,
      },
    });
    const started = surface.monitorRegistry.start({
      command: "echo ready",
      cwd: "C:/workspace",
      timeoutMs: 60_000,
    });

    const listResult = await surface.resources.read("kiln://session/monitors");
    const monitorResult = await surface.resources.read(`kiln://session/monitors/${started.id}`);

    expect(JSON.parse(listResult.contents[0]!.text)).toEqual({
      monitors: [expect.objectContaining({ id: started.id, status: "exited" })],
    });
    expect(JSON.parse(monitorResult.contents[0]!.text)).toMatchObject({
      snapshot: { id: started.id, status: "exited" },
      events: [
        { stream: "stdout", text: "ready\n" },
        { stream: "lifecycle" },
      ],
    });
  });

  it("fails missing dynamic resources explicitly", async () => {
    const surface = createDefaultBuiltinToolSurface();

    await expect(surface.resources.read("kiln://session/tasks/missing")).rejects.toThrow("Resource not found");
  });

  it("exposes workspace resource templates only when a workspace root is configured", async () => {
    const tempDir = await makeTempDir();
    try {
      const defaultSurface = createDefaultBuiltinToolSurface();
      const workspaceSurface = createDefaultBuiltinToolSurface({
        workspaceResources: { rootPath: tempDir },
      });

      expect(defaultSurface.resources.listTemplates().map((template) => template.uriTemplate)).not.toContain(
        "kiln://workspace/file/{path}",
      );
      expect(workspaceSurface.resources.list().map((resource) => resource.uri)).toContain("kiln://workspace/tree");
      expect(workspaceSurface.resources.listTemplates().map((template) => template.uriTemplate)).toEqual([
        "kiln://tools/catalog/{name}",
        "kiln://session/tasks/{id}",
        "kiln://session/monitors/{id}",
        "kiln://workspace/tree{?path,depth,includeFiles}",
        "kiln://workspace/file/{path}",
        "kiln://workspace/preview/{path}{?offset,limit}",
        "kiln://artifacts/{namespace}",
        "kiln://artifacts/{namespace}/{id}",
        "kiln://artifacts/{namespace}/{id}/content",
      ]);
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("does not expose workspace resources when policy denies root reads", async () => {
    const tempDir = await makeTempDir();
    try {
      const sandbox = makeSandbox(tempDir, { fsPolicy: "none" });
      const surface = createDefaultBuiltinToolSurface({
        workspaceResources: { rootPath: tempDir, pathValidator: sandbox.pathValidator },
      });

      expect(surface.resources.list().map((resource) => resource.uri)).not.toContain("kiln://workspace/tree");
      expect(surface.resources.listTemplates().map((template) => template.uriTemplate)).not.toContain(
        "kiln://workspace/file/{path}",
      );
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("reads workspace text files through stable workspace-relative URIs", async () => {
    const tempDir = await makeTempDir();
    try {
      await mkdir(join(tempDir, "notes"), { recursive: true });
      await writeFile(join(tempDir, "notes", "Caso Águila.txt"), "alpha\nbeta\ngamma\n", "utf8");
      const surface = createDefaultBuiltinToolSurface({
        workspaceResources: { rootPath: tempDir },
      });

      const result = await surface.resources.read(`kiln://workspace/file/${encodeWorkspacePath("notes/Caso Águila.txt")}`);

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]).toMatchObject({
        uri: `kiln://workspace/file/${encodeWorkspacePath("notes/Caso Águila.txt")}`,
        mimeType: "text/plain",
        text: "alpha\nbeta\ngamma\n",
        _meta: {
          path: "notes/Caso Águila.txt",
          type: "file",
          binary: false,
          truncated: false,
        },
      });
      expect(result.contents[0]!._meta?.["absolutePath"]).toBeUndefined();
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("returns bounded workspace previews with truncation metadata", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "server.log"), "zero\none\ntwo\nthree\n", "utf8");
      const surface = createDefaultBuiltinToolSurface({
        workspaceResources: { rootPath: tempDir },
      });

      const result = await surface.resources.read("kiln://workspace/preview/server.log?offset=1&limit=2");

      expect(result.contents[0]).toMatchObject({
        uri: "kiln://workspace/preview/server.log?offset=1&limit=2",
        mimeType: "text/plain",
        text: "one\ntwo",
        _meta: {
          path: "server.log",
          offset: 1,
          limit: 2,
          totalLines: 5,
          truncated: true,
        },
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("returns metadata-only JSON for binary workspace files", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "evidence.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]));
      const surface = createDefaultBuiltinToolSurface({
        workspaceResources: { rootPath: tempDir },
      });

      const result = await surface.resources.read("kiln://workspace/file/evidence.png");
      const payload = JSON.parse(result.contents[0]!.text);

      expect(result.contents[0]).toMatchObject({
        uri: "kiln://workspace/file/evidence.png",
        mimeType: "application/json",
        _meta: {
          path: "evidence.png",
          mimeType: "image/png",
          binary: true,
          truncated: false,
        },
      });
      expect(payload).toMatchObject({
        path: "evidence.png",
        type: "file",
        mimeType: "image/png",
        binary: true,
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("reads deterministic bounded workspace tree snapshots", async () => {
    const tempDir = await makeTempDir();
    try {
      await mkdir(join(tempDir, "src"), { recursive: true });
      await mkdir(join(tempDir, "docs"), { recursive: true });
      await writeFile(join(tempDir, "zeta.txt"), "z", "utf8");
      await writeFile(join(tempDir, "src", "index.ts"), "export {};\n", "utf8");
      await writeFile(join(tempDir, "docs", "guide.md"), "# Guide\n", "utf8");
      const surface = createDefaultBuiltinToolSurface({
        workspaceResources: { rootPath: tempDir },
      });

      const result = await surface.resources.read("kiln://workspace/tree?path=.&depth=1&includeFiles=true");
      const payload = JSON.parse(result.contents[0]!.text);

      expect(payload.entries.map((entry: { path: string }) => entry.path)).toEqual([
        "docs",
        "src",
        "zeta.txt",
      ]);
      expect(payload).toMatchObject({
        root: ".",
        entryCount: 3,
        truncated: false,
      });
      expect(result.contents[0]!._meta).toMatchObject({
        path: ".",
        depth: 1,
        includeFiles: true,
        entryCount: 3,
        truncated: false,
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("rejects workspace resource traversal outside the configured root", async () => {
    const tempDir = await makeTempDir();
    try {
      const surface = createDefaultBuiltinToolSurface({
        workspaceResources: { rootPath: tempDir },
      });

      await expect(surface.resources.read("kiln://workspace/file/%2E%2E/secret.txt")).rejects.toThrow(
        "Workspace resource path escapes the configured root",
      );
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("projects configured artifact resources through the shared resource registry", async () => {
    const artifactStore = new MemoryArtifactResourceStore({
      now: () => "2026-04-29T18:00:00.000Z",
    });
    const artifact = artifactStore.put({
      namespace: "plans",
      title: "Slice 21",
      mimeType: "text/plain",
      content: { type: "text", text: "artifact content" },
      producer: { kind: "tool", name: "task_update" },
      retention: { scope: "session" },
    });
    const surface = createDefaultBuiltinToolSurface({
      artifactResources: { store: artifactStore },
    });

    expect(surface.resources.list().map((resource) => resource.uri)).toContain("kiln://artifacts/plans");
    expect(surface.resources.listTemplates().map((template) => template.uriTemplate)).toContain(
      "kiln://artifacts/{namespace}/{id}/content",
    );
    const result = await surface.resources.read(`kiln://artifacts/plans/${artifact.id}/content`);
    expect(result.contents[0]).toMatchObject({
      uri: `kiln://artifacts/plans/${artifact.id}/content`,
      mimeType: "text/plain",
      text: "artifact content",
    });
  });
});

function decodeTestCursor(cursor: string | undefined): Record<string, unknown> {
  expect(cursor).toEqual(expect.any(String));
  return JSON.parse(Buffer.from(cursor!, "base64url").toString("utf8")) as Record<string, unknown>;
}

function encodeTestCursor(cursor: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function encodeWorkspacePath(path: string): string {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}
