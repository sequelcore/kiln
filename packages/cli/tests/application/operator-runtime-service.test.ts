import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProjectRuntimeRegistry,
  verifyOperatorSessionCredential,
} from "@kilnai/runtime";
import type { OperatorRuntimeHarness, OperatorSessionClaims } from "@kilnai/gateway-contracts";
import {
  createOperatorRuntimeService,
  deriveOperatorRuntimeCallerId,
  type OperatorRuntimeMcpRequest,
  type OperatorRuntimeSessionOpenInput,
  type OperatorRuntimeService,
} from "../../src/application/operator-runtime-service.js";
import type {
  OperatorProjectManagedAgentSummary,
  OperatorProjectAgentTaskApplicationComposition,
} from "../../src/application/operator-project-agent-tasks.js";
import { resolveTrustedWorkspace } from "../../src/application/trusted-workspace-resolution.js";

const SECRET = new TextEncoder().encode("operator-runtime-service-test-secret-32-bytes");
const roots: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("createOperatorRuntimeService", () => {
  it("routes managed-economic application commands only for an authenticated operator surface", async () => {
    const project = adoptedProject("surface-application");
    const releasePreFence = vi.fn();
    const createComposition = vi.fn(async () => ({
      ...composition(),
      economicAuthority: {
        acquire: vi.fn(),
        releasePreFence,
        fenceDispatch: vi.fn(),
        readDispatch: vi.fn(),
        settleExecution: vi.fn(),
        recordExecutionSettlementPending: vi.fn(),
      },
    }));
    const service = createOperatorRuntimeService({ sessionSecret: SECRET, createComposition, nowEpochSeconds: () => 100 });
    const opened = await service.onSessionOpen({
      schemaVersion: 2,
      canonicalRoot: project.canonicalRoot,
      binding: project.binding,
      principal: { kind: "operator-surface", surface: "gui" },
      sessionId: "gui-application-session",
    });
    const surfaceClaims = verifyOperatorSessionCredential(opened.credential, SECRET, {
      ...project.binding,
      principal: { kind: "operator-surface", surface: "gui" },
      sessionId: "gui-application-session",
    }, { nowEpochSeconds: 100 });

    await expect(service.onApplicationRequest({
      claims: surfaceClaims,
      request: {
        schemaVersion: 1,
        operation: "managed-economic.release-pre-fence",
        jobId: "job-1",
        economicAttemptId: "attempt-1",
      },
    })).resolves.toMatchObject({ status: "ok" });
    expect(releasePreFence).toHaveBeenCalledWith("job-1", "attempt-1");

    const nativeClaims = await openClaims(service, project, "codex", "native-application-session");
    await expect(service.onApplicationRequest({
      claims: nativeClaims,
      request: {
        schemaVersion: 1,
        operation: "managed-economic.release-pre-fence",
        jobId: "job-2",
        economicAttemptId: "attempt-2",
      },
    })).resolves.toMatchObject({ status: "error", error: { code: "principal_denied" } });
    await service.close();
  });
  it("opens an exact signed session without eagerly creating project composition", async () => {
    const project = adoptedProject("session");
    const createComposition = vi.fn(async () => composition());
    const service = createOperatorRuntimeService({ sessionSecret: SECRET, createComposition, nowEpochSeconds: () => 100 });

    const opened = await service.onSessionOpen(sessionInput(project, "codex", "session-1"));
    const claims = verifyOperatorSessionCredential(opened.credential, SECRET, {
      ...project.binding,
      principal: { kind: "native-harness", harness: "codex" },
      sessionId: "session-1",
    }, { nowEpochSeconds: 100 });

    expect(claims).toMatchObject({
      ...project.binding,
      principal: { kind: "native-harness", harness: "codex" },
      sessionId: "session-1",
      issuedAt: 100,
      expiresAt: 400,
    });
    expect(opened.expiresAt).toBe(400);
    expect(createComposition).not.toHaveBeenCalled();
    await service.close();
  });

  it("opens an operator-surface session without lending it the native MCP adapter", async () => {
    const project = adoptedProject("gui-session");
    const createComposition = vi.fn(async () => composition());
    const service = createOperatorRuntimeService({ sessionSecret: SECRET, createComposition, nowEpochSeconds: () => 100 });
    const opened = await service.onSessionOpen({
      schemaVersion: 2,
      canonicalRoot: project.canonicalRoot,
      binding: project.binding,
      principal: { kind: "operator-surface", surface: "gui" },
      sessionId: "gui-session-1",
    });
    const claims = verifyOperatorSessionCredential(opened.credential, SECRET, {
      ...project.binding,
      principal: { kind: "operator-surface", surface: "gui" },
      sessionId: "gui-session-1",
    }, { nowEpochSeconds: 100 });

    const response = await service.onMcpRequest(mcpInput(claims, "tools/list"));

    expect(response.status).toBe(401);
    expect(createComposition).not.toHaveBeenCalled();
    await service.close();
  });

  it("rejects a supplied root that resolves to the project but is not the exact canonical root", async () => {
    const project = adoptedProject("exact-root");
    const nested = join(project.canonicalRoot, "packages", "nested");
    mkdirSync(nested, { recursive: true });
    const createComposition = vi.fn(async () => composition());
    const service = createOperatorRuntimeService({ sessionSecret: SECRET, createComposition, nowEpochSeconds: () => 100 });

    await expect(service.onSessionOpen({
      ...sessionInput(project, "codex", "nested-session"),
      canonicalRoot: nested,
    })).rejects.toThrow("unavailable");
    expect(createComposition).not.toHaveBeenCalled();
    await service.close();
  });

  it("renews the exact same session idempotently and rejects an authority collision", async () => {
    const first = adoptedProject("renewal");
    const second = adoptedProject("collision");
    let now = 100;
    const service = createOperatorRuntimeService({ sessionSecret: SECRET, nowEpochSeconds: () => now });

    const original = await service.onSessionOpen(sessionInput(first, "codex", "shared-session"));
    now = 110;
    const renewed = await service.onSessionOpen(sessionInput(first, "codex", "shared-session"));

    expect(renewed.expiresAt).toBe(410);
    expect(renewed.credential).not.toBe(original.credential);
    await expect(service.onSessionOpen(sessionInput(second, "codex", "shared-session"))).rejects.toThrow("unavailable");
    await expect(service.onSessionOpen(sessionInput(first, "claude", "shared-session"))).rejects.toThrow("unavailable");
    await service.close();
  });

  it("lists the stable nine-tool catalog before any project runtime exists", async () => {
    const project = adoptedProject("tools");
    const createComposition = vi.fn(async () => composition());
    const { service, claims } = await openedService(project, "codex", "tools-session", { createComposition });

    const response = await service.onMcpRequest(mcpInput(claims, "tools/list"));
    const payload = await response.json() as { result: { tools: readonly { name: string }[] } };

    expect(response.status).toBe(200);
    expect(payload.result.tools.map((tool) => tool.name)).toEqual([
      "kiln_status_inspect",
      "kiln_work_governance_inspect",
      "kiln_capability_inspect",
      "kiln_account_usage_inspect",
      "kiln_agent_task_submit",
      "kiln_agent_task_status",
      "kiln_agent_task_result",
      "kiln_agent_task_cancel",
      "kiln_agent_task_replay",
    ]);
    expect(createComposition).not.toHaveBeenCalled();
    await service.close();
  });

  it("uses harness-specific inspection rooted to the verified project without returning the raw root", async () => {
    const project = adoptedProject("inspection");
    const { service, claims } = await openedService(project, "claude", "inspect-session", {
      userHome: join(project.canonicalRoot, "home"),
    });

    const response = await service.onMcpRequest(mcpInput(claims, "tools/call", {
      name: "kiln_status_inspect",
      arguments: {},
    }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"harness":"claude"');
    expect(body).not.toContain(project.canonicalRoot);
    await service.close();
  });

  it("reports the current bridge projection through capability inspection", async () => {
    const project = adoptedProject("capability-inspection");
    const { service, claims } = await openedService(project, "claude", "capability-inspect-session", {
      userHome: join(project.canonicalRoot, "home"),
    });

    const capability = await service.onMcpRequest(mcpInput(claims, "tools/call", {
      name: "kiln_capability_inspect",
      arguments: {},
    }));
    const capabilityBody = await capability.text();
    expect(capabilityBody).toContain('"bridgeProjection":"current"');
    expect(capabilityBody).not.toContain("KILN_BRIDGE_PROJECTION_UNRESOLVED");
    await service.close();
  });

  it("projects the canonical configured-agent summaries through capability inspection", async () => {
    const project = adoptedProject("managed-agent-capability");
    const configuredAgents: readonly OperatorProjectManagedAgentSummary[] = [
      {
        configuredAgentProfileId: "global-planner",
        availability: "admitted",
        providerFamily: "codex-oauth",
        admissionProfileId: "foundation-readonly-plan",
      },
      {
        configuredAgentProfileId: "global-reviewer",
        availability: "unavailable",
        providerFamily: "opencode-go",
        admissionProfileId: "foundation-readonly-plan",
        diagnostic: "route_unavailable",
        operatorAction: "Restore the configured managed route.",
      },
      {
        configuredAgentProfileId: "global-scout",
        availability: "unresolved",
        admissionProfileId: "foundation-readonly-plan",
        diagnostic: "eligibility_unresolved",
        operatorAction: "Refresh canonical route eligibility evidence.",
      },
    ];
    const createComposition = vi.fn(async () => composition(vi.fn(), undefined, configuredAgents));
    const service = createOperatorRuntimeService({
      sessionSecret: SECRET,
      createComposition,
      nowEpochSeconds: () => 100,
    });
    const claims = await openClaims(service, project, "codex", "managed-agent-capability-session");

    const response = await service.onMcpRequest(mcpInput(claims, "tools/call", {
      name: "kiln_capability_inspect",
      arguments: {},
    }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"configuredAgentProfileId":"global-planner"');
    expect(body).toContain('"availability":"admitted"');
    expect(body).toContain('"configuredAgentProfileId":"global-reviewer"');
    expect(body).toContain('"diagnostic":"route_unavailable"');
    expect(body).toContain('"configuredAgentProfileId":"global-scout"');
    expect(body).toContain('"diagnostic":"eligibility_unresolved"');
    expect(body).not.toContain("model");
    expect(createComposition).toHaveBeenCalledTimes(1);
    await service.close();
  });

  it("prunes expired sessions before enforcing bounded session capacity", async () => {
    const first = adoptedProject("capacity-first");
    const second = adoptedProject("capacity-second");
    let now = 100;
    const service = createOperatorRuntimeService({
      sessionSecret: SECRET,
      nowEpochSeconds: () => now,
      sessionLifetimeSeconds: 10,
      maxSessions: 1,
    });
    await service.onSessionOpen(sessionInput(first, "codex", "expired-session"));
    await expect(service.onSessionOpen(sessionInput(second, "claude", "blocked-session"))).rejects.toThrow("unavailable");

    now = 111;
    await expect(service.onSessionOpen(sessionInput(second, "claude", "replacement-session"))).resolves.toMatchObject({ expiresAt: 121 });
    await service.close();
  });

  it("creates managed composition lazily and coalesces Codex and Claude onto one project owner", async () => {
    const project = adoptedProject("coalesce");
    const closeOwner = vi.fn();
    const callers: string[] = [];
    const createComposition = vi.fn(async () => composition(closeOwner, (callerId) => callers.push(callerId)));
    const service = createOperatorRuntimeService({ sessionSecret: SECRET, createComposition, nowEpochSeconds: () => 100 });
    const codex = await openClaims(service, project, "codex", "codex-session");
    const claude = await openClaims(service, project, "claude", "claude-session");

    const codexResponse = await service.onMcpRequest(managedStatusInput(codex));
    const claudeResponse = await service.onMcpRequest(managedStatusInput(claude));

    expect(createComposition).toHaveBeenCalledTimes(1);
    expect(createComposition).toHaveBeenCalledWith({ projectPath: project.canonicalRoot });
    expect(callers).toEqual([
      expect.stringContaining(`${project.binding.projectRuntimeId}:native-harness:codex:`),
      expect.stringContaining(`${project.binding.projectRuntimeId}:native-harness:claude:`),
    ]);
    expect(callers[0]).not.toBe(callers[1]);
    expect(await codexResponse.text()).toContain("operator-runtime:codex-session:");
    expect(await claudeResponse.text()).toContain("operator-runtime:claude-session:");
    await service.close();
    await service.close();
    expect(closeOwner).toHaveBeenCalledTimes(1);
  });

  it("isolates project A and B runtime owners", async () => {
    const projectA = adoptedProject("project-a");
    const projectB = adoptedProject("project-b");
    const createComposition = vi.fn(async (_options: { readonly projectPath: string }) => composition());
    const service = createOperatorRuntimeService({ sessionSecret: SECRET, createComposition, nowEpochSeconds: () => 100 });
    const claimsA = await openClaims(service, projectA, "codex", "session-a");
    const claimsB = await openClaims(service, projectB, "opencode", "session-b");

    await service.onMcpRequest(managedStatusInput(claimsA));
    await service.onMcpRequest(managedStatusInput(claimsB));

    expect(createComposition).toHaveBeenCalledTimes(2);
    expect(createComposition.mock.calls.map(([value]) => value.projectPath)).toEqual([
      projectA.canonicalRoot,
      projectB.canonicalRoot,
    ]);
    await service.close();
  });

  it("binds submit and every AgentTask query operation to the authenticated project principal session", async () => {
    const project = adoptedProject("caller-binding");
    const callers: string[] = [];
    const createComposition = vi.fn(async () => composition(vi.fn(), (callerId) => callers.push(callerId)));
    const service = createOperatorRuntimeService({ sessionSecret: SECRET, createComposition, nowEpochSeconds: () => 100 });
    const codex = await openClaims(service, project, "codex", "codex-caller-session");
    const claude = await openClaims(service, project, "claude", "claude-caller-session");
    const operations = [
      ["kiln_agent_task_submit", { objective: "inspect", configuredAgentProfileId: "scout", idempotencyKey: "submit-1" }],
      ["kiln_agent_task_status", { jobId: "job-1" }],
      ["kiln_agent_task_result", { jobId: "job-1" }],
      ["kiln_agent_task_cancel", { jobId: "job-1" }],
      ["kiln_agent_task_replay", { jobId: "job-1" }],
    ] as const;

    for (const [name, args] of operations) {
      await service.onMcpRequest(mcpInput(codex, "tools/call", { name, arguments: args }));
    }
    for (const [name, args] of operations.slice(1)) {
      await service.onMcpRequest(mcpInput(claude, "tools/call", { name, arguments: args }));
    }

    const codexCaller = deriveOperatorRuntimeCallerId({ projectRuntimeId: project.binding.projectRuntimeId, principal: codex.principal, sessionId: codex.sessionId });
    const claudeCaller = deriveOperatorRuntimeCallerId({ projectRuntimeId: project.binding.projectRuntimeId, principal: claude.principal, sessionId: claude.sessionId });
    expect(callers).toEqual([codexCaller, codexCaller, codexCaller, codexCaller, codexCaller, claudeCaller, claudeCaller, claudeCaller, claudeCaller]);
    expect(codexCaller).not.toBe(claudeCaller);
    expect(codexCaller).toContain(`${project.binding.projectRuntimeId}:native-harness:codex:`);
    expect(claudeCaller).toContain(`${project.binding.projectRuntimeId}:native-harness:claude:`);
    await service.close();
  });

  it("replaces stale project governance before serving the new binding and ignores a late old claim", async () => {
    const project = adoptedProject("binding-replacement");
    const firstClose = vi.fn(async () => undefined);
    const secondClose = vi.fn(async () => undefined);
    const createComposition = vi
      .fn<(_: { readonly projectPath: string }) => Promise<OperatorProjectAgentTaskApplicationComposition>>()
      .mockResolvedValueOnce(composition(firstClose))
      .mockResolvedValueOnce(composition(secondClose));
    const service = createOperatorRuntimeService({
      sessionSecret: SECRET,
      createComposition,
      nowEpochSeconds: () => 100,
    });
    const oldClaims = await openClaims(service, project, "codex", "old-binding");
    await service.onMcpRequest(managedStatusInput(oldClaims));

    writeFileSync(
      join(project.canonicalRoot, ".kiln", "kiln.yaml"),
      'version: "1"\nprojectName: binding-replacement-new\n',
      "utf8",
    );
    const advanced = resolveProject(project.canonicalRoot);
    const newClaims = await openClaims(service, advanced, "claude", "new-binding");

    expect(firstClose).toHaveBeenCalledTimes(1);
    await service.onMcpRequest(managedStatusInput(newClaims));
    expect(createComposition).toHaveBeenCalledTimes(2);

    const lateOldRequest = await service.onMcpRequest(managedStatusInput(oldClaims));
    expect(lateOldRequest.status).toBe(401);
    expect(secondClose).not.toHaveBeenCalled();
    await service.close();
    expect(secondClose).toHaveBeenCalledTimes(1);
  });

  it("preserves a fresh binding when a request captured under the old binding settles late", async () => {
    const project = adoptedProject("captured-old-binding");
    const pendingOldStatus = deferred<never>();
    const firstClose = vi.fn(async () => undefined);
    const secondClose = vi.fn(async () => undefined);
    const first = composition(firstClose);
    const oldGetStatus = vi.fn(() => pendingOldStatus.promise);
    const createComposition = vi
      .fn<(_: { readonly projectPath: string }) => Promise<OperatorProjectAgentTaskApplicationComposition>>()
      .mockResolvedValueOnce({
        ...first,
        application: { ...first.application, getStatus: oldGetStatus },
      })
      .mockResolvedValueOnce(composition(secondClose));
    const service = createOperatorRuntimeService({
      sessionSecret: SECRET,
      createComposition,
      nowEpochSeconds: () => 100,
    });
    const oldClaims = await openClaims(service, project, "codex", "captured-old-session");
    const oldRequest = service.onMcpRequest(managedStatusInput(oldClaims));
    await vi.waitFor(() => expect(oldGetStatus).toHaveBeenCalledTimes(1));

    writeFileSync(
      join(project.canonicalRoot, ".kiln", "kiln.yaml"),
      'version: "1"\nprojectName: captured-old-binding-new\n',
      "utf8",
    );
    const advanced = resolveProject(project.canonicalRoot);
    const freshOpening = service.onSessionOpen(
      sessionInput(advanced, "claude", "fresh-session"),
    );
    let freshOpened = false;
    void freshOpening.then(() => {
      freshOpened = true;
    });
    await Promise.resolve();
    expect(freshOpened).toBe(false);

    pendingOldStatus.reject(Object.assign(new Error("unavailable"), { code: "unknown_job" }));
    await oldRequest;
    const freshClaims = verifyClaims(
      await freshOpening,
      advanced,
      "claude",
      "fresh-session",
      100,
    );
    await service.onMcpRequest(managedStatusInput(freshClaims));

    expect(firstClose).toHaveBeenCalledTimes(1);
    expect(createComposition).toHaveBeenCalledTimes(2);
    expect(secondClose).not.toHaveBeenCalled();
    await service.close();
    expect(secondClose).toHaveBeenCalledTimes(1);
  });

  it("evicts only after the final live session for a project expires", async () => {
    vi.useFakeTimers();
    const project = adoptedProject("expiry-live-session");
    let now = 100;
    const closeOwner = vi.fn(async () => undefined);
    const service = createOperatorRuntimeService({
      sessionSecret: SECRET,
      createComposition: async () => composition(closeOwner),
      nowEpochSeconds: () => now,
      sessionLifetimeSeconds: 10,
    });
    const first = await openClaims(service, project, "codex", "first-session");
    await service.onMcpRequest(managedStatusInput(first));
    now = 105;
    await service.onSessionOpen(sessionInput(project, "claude", "second-session"));

    now = 111;
    await vi.advanceTimersByTimeAsync(6_000);
    expect(closeOwner).not.toHaveBeenCalled();

    now = 116;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(closeOwner).toHaveBeenCalledTimes(1);
    await service.close();
  });

  it("defers expiry eviction until an in-flight project request releases ownership", async () => {
    vi.useFakeTimers();
    const project = adoptedProject("expiry-in-flight");
    const pendingStatus = deferred<never>();
    const closeOwner = vi.fn(async () => undefined);
    const owned = composition(closeOwner);
    const getStatus = vi.fn(() => pendingStatus.promise);
    const createComposition = vi.fn(async () => ({
      ...owned,
      application: { ...owned.application, getStatus },
    }));
    let now = 100;
    const service = createOperatorRuntimeService({
      sessionSecret: SECRET,
      createComposition,
      nowEpochSeconds: () => now,
      sessionLifetimeSeconds: 10,
    });
    const claims = await openClaims(service, project, "codex", "in-flight-session");
    const request = service.onMcpRequest(managedStatusInput(claims));
    await vi.waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1));

    now = 111;
    await vi.advanceTimersByTimeAsync(11_000);
    expect(closeOwner).not.toHaveBeenCalled();

    pendingStatus.reject(Object.assign(new Error("unavailable"), { code: "unknown_job" }));
    await request;
    expect(closeOwner).toHaveBeenCalledTimes(1);
    await service.close();
  });

  it("waits for in-flight requests before final close", async () => {
    const project = adoptedProject("final-close-in-flight");
    const pendingStatus = deferred<never>();
    const closeOwner = vi.fn(async () => undefined);
    const owned = composition(closeOwner);
    const getStatus = vi.fn(() => pendingStatus.promise);
    const service = createOperatorRuntimeService({
      sessionSecret: SECRET,
      createComposition: async () => ({
        ...owned,
        application: { ...owned.application, getStatus },
      }),
      nowEpochSeconds: () => 100,
    });
    const claims = await openClaims(service, project, "codex", "closing-session");
    const request = service.onMcpRequest(managedStatusInput(claims));
    await vi.waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1));

    const closing = service.close();
    await Promise.resolve();
    expect(closeOwner).not.toHaveBeenCalled();

    pendingStatus.reject(Object.assign(new Error("unavailable"), { code: "unknown_job" }));
    await request;
    await closing;
    expect(closeOwner).toHaveBeenCalledTimes(1);
  });

  it("waits for an in-flight operator application request before final close", async () => {
    const project = adoptedProject("final-close-application-in-flight");
    const pendingComposition = deferred<OperatorProjectAgentTaskApplicationComposition>();
    const closeOwner = vi.fn(async () => undefined);
    const service = createOperatorRuntimeService({
      sessionSecret: SECRET,
      createComposition: () => pendingComposition.promise,
      nowEpochSeconds: () => 100,
    });
    const opened = await service.onSessionOpen({
      schemaVersion: 2,
      canonicalRoot: project.canonicalRoot,
      binding: project.binding,
      principal: { kind: "operator-surface", surface: "gui" },
      sessionId: "closing-application-session",
    });
    const claims = verifyOperatorSessionCredential(opened.credential, SECRET, {
      ...project.binding,
      principal: { kind: "operator-surface", surface: "gui" },
      sessionId: "closing-application-session",
    }, { nowEpochSeconds: 100 });
    const request = service.onApplicationRequest({
      claims,
      request: {
        schemaVersion: 1,
        operation: "managed-economic.release-pre-fence",
        jobId: "job-1",
        economicAttemptId: "attempt-1",
      },
    });
    await Promise.resolve();

    const closing = service.close();
    let serviceClosed = false;
    void closing.then(() => {
      serviceClosed = true;
    });
    await Promise.resolve();
    expect(serviceClosed).toBe(false);
    expect(closeOwner).not.toHaveBeenCalled();

    pendingComposition.resolve(composition(closeOwner));
    await expect(request).resolves.toMatchObject({ status: "error", error: { code: "authority_rejected" } });
    await closing;
    expect(closeOwner).toHaveBeenCalledTimes(1);
  });

  it("does not start closeAll until the final request eviction cleanup settles", async () => {
    const project = adoptedProject("final-cleanup-order");
    const pendingStatus = deferred<never>();
    const pendingOwnerClose = deferred<void>();
    const closeOwner = vi.fn(() => pendingOwnerClose.promise);
    const owned = composition(closeOwner);
    const getStatus = vi.fn(() => pendingStatus.promise);
    const registry = new ProjectRuntimeRegistry(async () => ({
      ...owned,
      application: { ...owned.application, getStatus },
    }));
    const closeAll = vi.spyOn(registry, "closeAll");
    const service = createOperatorRuntimeService({
      sessionSecret: SECRET,
      registry,
      nowEpochSeconds: () => 100,
    });
    const claims = await openClaims(service, project, "codex", "cleanup-order-session");
    const request = service.onMcpRequest(managedStatusInput(claims));
    await vi.waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1));

    const closing = service.close();
    pendingStatus.reject(Object.assign(new Error("unavailable"), { code: "unknown_job" }));
    await vi.waitFor(() => expect(closeOwner).toHaveBeenCalledTimes(1));

    expect(closeAll).not.toHaveBeenCalled();
    let serviceClosed = false;
    void closing.then(() => {
      serviceClosed = true;
    });
    await Promise.resolve();
    expect(serviceClosed).toBe(false);

    pendingOwnerClose.resolve();
    await request;
    await closing;
    expect(closeAll).toHaveBeenCalledTimes(1);
  });

  it("fails closed after an eviction close failure without creating an overlapping owner", async () => {
    vi.useFakeTimers();
    const project = adoptedProject("expiry-close-failure");
    const closeOwner = vi.fn(async () => {
      throw new Error("private close failure");
    });
    const createComposition = vi.fn(async () => composition(closeOwner));
    let now = 100;
    const service = createOperatorRuntimeService({
      sessionSecret: SECRET,
      createComposition,
      nowEpochSeconds: () => now,
      sessionLifetimeSeconds: 10,
    });
    const claims = await openClaims(service, project, "codex", "failing-close-session");
    await service.onMcpRequest(managedStatusInput(claims));

    now = 111;
    await vi.advanceTimersByTimeAsync(11_000);
    expect(closeOwner).toHaveBeenCalledTimes(1);

    const renewed = verifyClaims(
      await service.onSessionOpen(sessionInput(project, "codex", "renewed-session")),
      project,
      "codex",
      "renewed-session",
      111,
    );
    await service.onMcpRequest(managedStatusInput(renewed));
    expect(createComposition).toHaveBeenCalledTimes(1);
    await expect(service.close()).rejects.toMatchObject({
      code: "close_failed",
      failureCount: 1,
    });
  });

  it("denies unknown, expired, superseded, and stale-marker sessions without composing or exposing errors", async () => {
    const project = adoptedProject("denials");
    let now = 100;
    const createComposition = vi.fn(async () => composition());
    const service = createOperatorRuntimeService({ sessionSecret: SECRET, createComposition, nowEpochSeconds: () => now, sessionLifetimeSeconds: 10 });
    const claims = await openClaims(service, project, "codex", "denied-session");

    const unknown = await service.onMcpRequest(mcpInput({ ...claims, sessionId: "unknown-session" }, "tools/list"));
    const restartedService = createOperatorRuntimeService({ sessionSecret: SECRET, createComposition, nowEpochSeconds: () => now });
    const restarted = await restartedService.onMcpRequest(mcpInput(claims, "tools/list"));
    await restartedService.close();
    now = 111;
    const expired = await service.onMcpRequest(mcpInput(claims, "tools/list"));
    now = 101;
    await service.onSessionOpen(sessionInput(project, "codex", "denied-session"));
    const superseded = await service.onMcpRequest(mcpInput(claims, "tools/list"));
    writeFileSync(join(project.canonicalRoot, ".kiln", "kiln.yaml"), 'version: "1"\nprojectName: changed\n', "utf8");
    const freshClaims = verifyClaims(await service.onSessionOpen({
      ...sessionInput(project, "codex", "fresh-session"),
      binding: resolveProject(project.canonicalRoot).binding,
    }), resolveProject(project.canonicalRoot), "codex", "fresh-session", 101);
    writeFileSync(join(project.canonicalRoot, ".kiln", "kiln.yaml"), 'version: "1"\nprojectName: changed-again\n', "utf8");
    const stale = await service.onMcpRequest(mcpInput(freshClaims, "tools/list"));

    for (const response of [unknown, restarted, expired, superseded, stale]) {
      expect(response.status).toBe(401);
      expect(await response.text()).toBe('{"error":{"code":"unauthorized"}}');
    }
    expect(createComposition).not.toHaveBeenCalled();
    await service.close();
  });
});

function adoptedProject(label: string): ProjectFixture {
  const canonicalRoot = mkdtempSync(join(tmpdir(), `kiln-operator-${label}-`));
  roots.push(canonicalRoot);
  mkdirSync(join(canonicalRoot, ".kiln"), { recursive: true });
  writeFileSync(join(canonicalRoot, ".kiln", "kiln.yaml"), `version: "1"\nprojectName: ${label}\n`, "utf8");
  return resolveProject(canonicalRoot);
}

interface ProjectFixture {
  readonly canonicalRoot: string;
  readonly binding: { readonly projectRuntimeId: string; readonly markerDigest: string };
}

function resolveProject(canonicalRoot: string): ProjectFixture {
  const resolved = resolveTrustedWorkspace({ cwd: () => canonicalRoot });
  if (resolved.status !== "resolved") throw new Error("Expected adopted project fixture");
  return {
    canonicalRoot: resolved.canonicalRoot,
    binding: { projectRuntimeId: resolved.projectRuntimeId, markerDigest: resolved.markerDigest },
  };
}

function sessionInput(project: ProjectFixture, harness: OperatorRuntimeHarness, sessionId: string): OperatorRuntimeSessionOpenInput {
  return {
    schemaVersion: 2,
    canonicalRoot: project.canonicalRoot,
    binding: project.binding,
    principal: { kind: "native-harness", harness },
    sessionId,
  };
}

async function openedService(
  project: ProjectFixture,
  harness: OperatorRuntimeHarness,
  sessionId: string,
  extra: Partial<Parameters<typeof createOperatorRuntimeService>[0]> = {},
): Promise<{ service: OperatorRuntimeService; claims: OperatorSessionClaims }> {
  const service = createOperatorRuntimeService({ sessionSecret: SECRET, nowEpochSeconds: () => 100, ...extra });
  return { service, claims: await openClaims(service, project, harness, sessionId) };
}

async function openClaims(service: OperatorRuntimeService, project: ProjectFixture, harness: OperatorRuntimeHarness, sessionId: string): Promise<OperatorSessionClaims> {
  return verifyClaims(await service.onSessionOpen(sessionInput(project, harness, sessionId)), project, harness, sessionId, 100);
}

function verifyClaims(
  opened: { readonly credential: string },
  project: ProjectFixture,
  harness: OperatorRuntimeHarness,
  sessionId: string,
  nowEpochSeconds: number,
): OperatorSessionClaims {
  return verifyOperatorSessionCredential(opened.credential, SECRET, {
    ...project.binding,
    principal: { kind: "native-harness", harness },
    sessionId,
  }, { nowEpochSeconds });
}

function mcpInput(claims: OperatorSessionClaims, method: string, params?: Record<string, unknown>): OperatorRuntimeMcpRequest {
  return {
    claims,
    request: new Request("http://127.0.0.1:43123/.well-known/kiln/operator-runtime/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
    }),
  };
}

function managedStatusInput(claims: OperatorSessionClaims): OperatorRuntimeMcpRequest {
  return mcpInput(claims, "tools/call", { name: "kiln_agent_task_status", arguments: { jobId: "job-1" } });
}

function composition(
  close = vi.fn(),
  observeCaller?: (callerId: string) => void,
  configuredAgents: readonly OperatorProjectManagedAgentSummary[] = [],
): OperatorProjectAgentTaskApplicationComposition {
  const unavailable = async (): Promise<never> => { throw Object.assign(new Error("unavailable"), { code: "unknown_job" }); };
  return {
  service: {} as OperatorProjectAgentTaskApplicationComposition["service"],
    application: {
      accept: async (value) => {
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          const callerId = (value as Record<string, unknown>).callerId;
          if (typeof callerId === "string") observeCaller?.(callerId);
        }
        return unavailable();
      },
      getStatus: async (identity) => {
        observeCaller?.(identity.callerId);
        return unavailable();
      },
      getResult: async (identity) => {
        observeCaller?.(identity.callerId);
        return unavailable();
      },
      cancel: async (identity) => {
        observeCaller?.(identity.callerId);
        return unavailable();
      },
      getReplay: async (identity) => {
        observeCaller?.(identity.callerId);
        return unavailable();
      },
      approveWrite: async (_jobId, _expiresAt) => {
        return unavailable();
      },
    },
    configuredAgents,
    close,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
