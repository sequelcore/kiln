import {
  buildManagedAgentCapabilitySnapshot,
  defineManagedAgentInvocationRequest,
  evaluateManagedAgentAdmission,
} from "@kilnai/core/agents";
import { describe, expect, it, vi } from "vitest";
import {
  createManagedInvocationLifecycleToolExecutors,
  createManagedInvocationToolAttachment,
  MANAGED_ATTENDED_TRUSTED_EXECUTION_ENFORCEMENT_REVISION,
  type ManagedAgentRuntimeAdapter,
  type ManagedAttendedTrustedExecutionContext,
  RuntimeManagedAgentInvocationService,
  requireManagedAttendedTrustedExecution,
  withManagedChildAuthorityAdmission,
} from "../../src/agents/managed-invocation/index.js";
import { requestManagedInvocationAuthorityApproval } from "../../src/agents/managed-invocation/runtime-tool/input-parsing.js";
import { AttendedTrustedExecutionLeaseAuthority } from "../../src/execution-kernel/attended-trusted-execution-lease-authority.js";
import { AttendedTrustedExecutionLeaseSessionAuthority } from "../../src/execution-kernel/attended-trusted-execution-lease-session-authority.js";
import {
  defineEffectiveAuthorityAdmissionBundle,
  type EffectiveAuthorityAdmissionBundle,
} from "../../src/session/effective-authority-admission-bundle.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import {
  makeApprovedWriteRequest,
  makeRecordForRequest,
  makeWriteDescriptor,
} from "./invocation-service-test-fixture.js";

const NOW = "2026-08-24T00:30:00.000Z";
const ISSUED_AT = "2026-08-24T00:00:00.000Z";
const PROJECT_RUNTIME_ID = `krp_${"1".repeat(64)}` as const;
const COMPOSITION_REVISION = `sha256:${"2".repeat(64)}` as const;

const EFFECT_CEILING = {
  operation: "mutate",
  boundaries: ["process", "workspace"],
  reversibility: "compensatable",
  dataEgress: "none",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "conditionally-idempotent",
} as const;

function destructiveFixture() {
  const base = makeApprovedWriteRequest("attended-tree-1", ["C:/workspace/kiln/packages"]);
  const request = defineManagedAgentInvocationRequest({
    ...base,
    parentSessionId: "operator-session-1",
    parentTurnId: "operator-turn-1",
    executionIntent: { attendance: "attended", lifecycle: "foreground" },
    requestedAuthority: "destructive",
    authorityApproval: { approved: true },
    providerRoute: { providerId: "codex-oauth", surface: "direct-provider", model: "gpt-test" },
    adapterKind: "direct",
    executionMode: "direct-provider",
  });
  const descriptor = makeWriteDescriptor();
  const directDescriptor = {
    ...descriptor,
    adapterDescriptorId: "adapter:codex-oauth:direct",
    providerId: "codex-oauth",
    adapterKind: "direct" as const,
    supportedExecutionModes: ["direct-provider"] as const,
  };
  const bundle = admissionBundle(request, "codex-direct");
  return { request, descriptor: directDescriptor, bundle };
}

async function issuedContext(
  request: ReturnType<typeof destructiveFixture>["request"],
  bundle: EffectiveAuthorityAdmissionBundle,
): Promise<ManagedAttendedTrustedExecutionContext> {
  const authority = new AttendedTrustedExecutionLeaseAuthority({
    binding: {
      localPrincipalId: "local-operator-session:1",
      operatorSessionId: request.parentSessionId,
      invocationTreeId: request.invocationId,
      projectRuntimeId: PROJECT_RUNTIME_ID,
      compositionRevision: COMPOSITION_REVISION,
    },
    approvalPort: { approve: () => ({ status: "approved" }) },
    now: () => ISSUED_AT,
  });
  const issued = await authority.issue({
    harness: "codex",
    routeId: "codex-direct",
    profileCeiling: "trusted-full-access",
    allowedToolNames: request.authority.toolAuthority.allowedToolNames,
    effectCeiling: bundle.turn.effectCeiling,
    policyDigest: bundle.admissionId,
    enforcementRevision: MANAGED_ATTENDED_TRUSTED_EXECUTION_ENFORCEMENT_REVISION,
    durationMs: 60 * 60 * 1000,
  });
  if (issued.status !== "issued") throw new Error("fixture lease was not issued");
  return {
    authority,
    projectRuntimeId: PROJECT_RUNTIME_ID,
    compositionRevision: COMPOSITION_REVISION,
    harness: "codex",
    routeId: "codex-direct",
    policyDigest: bundle.admissionId,
    enforcementRevision: MANAGED_ATTENDED_TRUSTED_EXECUTION_ENFORCEMENT_REVISION,
    requestedProfile: "trusted-full-access",
  };
}

describe("managed attended trusted execution", () => {
  it("does not let the legacy generic approval callback authorize destructive child work", async () => {
    const requestApproval = vi.fn(async () => ({ approved: true as const }));
    const result = await requestManagedInvocationAuthorityApproval({
      requestedAuthority: "destructive",
      target: { kind: "route", routeId: "codex-direct" },
      access: "approved-write",
      context: {
        session: new RuntimeSession({
          sessionId: "operator-session-generic-approval",
          appName: "attended-test",
          tenantId: "test",
          userId: "operator",
          systemPrompt: "test",
        }),
        toolCall: { id: "tool-call-generic-approval", name: "managed_agent.invoke", input: {} },
        requestApproval,
      },
    });

    expect(result).toEqual({
      ok: false,
      error:
        "managed_agent.invoke destructive requested authority requires the exact attended trusted-execution lease flow.",
    });
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it.each([
    { toolName: "managed_agent.start", target: { kind: "route" as const, routeId: "codex-direct" } },
    {
      toolName: "managed_agent.invoke",
      target: { kind: "economic-policy" as const, economicPolicyId: "economic-policy-1" },
    },
  ])("denies unsupported destructive $toolName approval before any generic prompt", async ({ toolName, target }) => {
    const requestApproval = vi.fn(async () => ({ approved: true as const }));
    const result = await requestManagedInvocationAuthorityApproval({
      requestedAuthority: "destructive",
      target,
      access: "approved-write",
      context: {
        session: new RuntimeSession({
          sessionId: "operator-session-unsupported-approval",
          appName: "attended-test",
          tenantId: "test",
          userId: "operator",
          systemPrompt: "test",
        }),
        toolCall: { id: "tool-call-unsupported-approval", name: toolName, input: {} },
        attendedTrustedExecutionSessionAuthority: {} as AttendedTrustedExecutionLeaseSessionAuthority,
        requestApproval,
      },
      toolName,
    });

    expect(result.ok).toBe(false);
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("denies destructive managed_agent.start before constructing the route adapter", async () => {
    const fixture = destructiveFixture();
    const createAdapter = vi.fn(async () => ({ descriptor: fixture.descriptor, invoke: vi.fn() }));
    const attachment = createManagedInvocationToolAttachment(
      {
        invocationService: new RuntimeManagedAgentInvocationService(),
        routes: [
          {
            routeId: "codex-direct",
            routeSource: "explicit-managed-route",
            providerId: "codex-oauth",
            model: "gpt-test",
            surface: "direct-provider",
            capability: {
              identity: { routeId: "codex-direct", revision: "test-v1" },
              target: { providerId: "codex-oauth", modelId: "gpt-test" },
              adapter: { kind: "direct-provider", capabilityId: "codex-direct", capabilityVersion: "test-v1" },
              authorityCeiling: "destructive",
              toolNames: fixture.request.authority.toolAuthority.allowedToolNames,
              supportsRecursion: false,
              supportsAttachments: false,
              supportsWrite: true,
              proof: {
                status: "configured",
                source: "test",
                provenAccess: ["approved-write"],
              },
              capacity: { kind: "accountless" },
              settlement: { kind: "not-required" },
            },
            createAdapter,
            profiles: [
              {
                authorityProfileId: fixture.request.authority.authorityProfileId,
                access: "approved-write",
                allowedToolNames: fixture.request.authority.toolAuthority.allowedToolNames,
                writeAllowed: true,
                networkAllowed: false,
                workingDirectory: fixture.request.authority.workingDirectory,
                timeoutMs: fixture.request.authority.timeoutMs,
                credentialRoute: fixture.request.authority.credentialRoute,
                memoryScope: fixture.request.authority.memoryScope,
                writeAuthority: fixture.request.authority.writeAuthority!,
              },
            ],
          },
        ],
      },
      { kind: "kiln-runtime", surface: "test", attachmentId: "attachment:start-denial" },
    );
    const executor = createManagedInvocationLifecycleToolExecutors(attachment).get("managed_agent.start");
    if (!executor) throw new Error("managed_agent.start was not created");
    const result = (await executor(
      {
        access: "approved-write",
        routeId: "codex-direct",
        providerRoute: { providerId: "codex-oauth", model: "gpt-test" },
        requestedAuthority: "destructive",
        task: "Start destructive work in the background.",
      },
      {
        session: new RuntimeSession({
          sessionId: "operator-session-start-denial",
          appName: "attended-test",
          tenantId: "test",
          userId: "operator",
          systemPrompt: "test",
        }),
        turnId: "turn-start-denial",
        toolCall: { id: "tool-call-start-denial", name: "managed_agent.start", input: {} },
        effectiveTurnAuthority: fixture.bundle.turn.authority,
        attendedTrustedExecutionSessionAuthority: {} as AttendedTrustedExecutionLeaseSessionAuthority,
      },
    )) as { readonly isError: boolean; readonly metadata: Record<string, unknown> };

    expect(result).toMatchObject({
      isError: true,
      metadata: { errorCode: "attended_trusted_execution_background_unsupported", status: "denied" },
    });
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "unattended execution",
      request: (request: ReturnType<typeof destructiveFixture>["request"]) => ({
        ...request,
        executionIntent: { attendance: "unattended" as const, lifecycle: "foreground" as const },
      }),
      descriptor: (descriptor: ReturnType<typeof destructiveFixture>["descriptor"]) => descriptor,
      economicDispatchPresent: false,
      reason: "only attended foreground invocation is supported",
    },
    {
      name: "background lifecycle",
      request: (request: ReturnType<typeof destructiveFixture>["request"]) => ({
        ...request,
        executionIntent: { attendance: "attended" as const, lifecycle: "background" as const },
      }),
      descriptor: (descriptor: ReturnType<typeof destructiveFixture>["descriptor"]) => descriptor,
      economicDispatchPresent: false,
      reason: "only attended foreground invocation is supported",
    },
    {
      name: "nested invocation",
      request: (request: ReturnType<typeof destructiveFixture>["request"]) => ({
        ...request,
        executionScope: {
          kind: "work_item" as const,
          goalRunId: "goal-1",
          workItemId: "work-1",
          managedInvocationId: "parent-invocation",
        },
      }),
      descriptor: (descriptor: ReturnType<typeof destructiveFixture>["descriptor"]) => descriptor,
      economicDispatchPresent: false,
      reason: "nested invocation trees are unsupported",
    },
    {
      name: "non-Codex provider",
      request: (request: ReturnType<typeof destructiveFixture>["request"]) => ({
        ...request,
        providerRoute: { ...request.providerRoute, providerId: "opencode" },
      }),
      descriptor: (descriptor: ReturnType<typeof destructiveFixture>["descriptor"]) => descriptor,
      economicDispatchPresent: false,
      reason: "only the Runtime-controlled codex-oauth direct-provider route is supported",
    },
    {
      name: "native harness adapter",
      request: (request: ReturnType<typeof destructiveFixture>["request"]) => request,
      descriptor: (descriptor: ReturnType<typeof destructiveFixture>["descriptor"]) => ({
        ...descriptor,
        adapterKind: "harness" as const,
        supportedExecutionModes: ["local-harness" as const],
      }),
      economicDispatchPresent: false,
      reason: "only the Runtime-controlled codex-oauth direct-provider route is supported",
    },
    {
      name: "non-direct execution mode",
      request: (request: ReturnType<typeof destructiveFixture>["request"]) => ({
        ...request,
        executionMode: "cli-harness" as const,
      }),
      descriptor: (descriptor: ReturnType<typeof destructiveFixture>["descriptor"]) => descriptor,
      economicDispatchPresent: false,
      reason: "only the Runtime-controlled codex-oauth direct-provider route is supported",
    },
    {
      name: "economic dispatch",
      request: (request: ReturnType<typeof destructiveFixture>["request"]) => request,
      descriptor: (descriptor: ReturnType<typeof destructiveFixture>["descriptor"]) => descriptor,
      economicDispatchPresent: true,
      reason: "economic dispatch is unsupported",
    },
  ])(
    "fails closed for $name",
    async ({ request: changeRequest, descriptor: changeDescriptor, economicDispatchPresent, reason }) => {
      const fixture = destructiveFixture();
      const context = await issuedContext(fixture.request, fixture.bundle);

      expect(() =>
        requireManagedAttendedTrustedExecution({
          now: new Date(NOW),
          request: changeRequest(fixture.request),
          adapterDescriptor: changeDescriptor(fixture.descriptor),
          capabilitySnapshotInput: { routeId: "codex-direct" },
          childAuthorityAdmission: { bundle: fixture.bundle },
          economicDispatchPresent,
          context,
        }),
      ).toThrow(reason);
    },
  );

  it("issues one exact foreground lease and completes it after managed_agent.invoke settles", async () => {
    const session = new RuntimeSession({
      sessionId: "operator-session-executor",
      appName: "attended-test",
      tenantId: "test",
      userId: "operator",
      systemPrompt: "test",
    });
    const turnId = "operator-turn-executor";
    const templateBase = makeApprovedWriteRequest("template-tree", ["C:/workspace/kiln/packages"]);
    const templateRequest = defineManagedAgentInvocationRequest({
      ...templateBase,
      parentSessionId: session.id,
      parentTurnId: turnId,
      executionIntent: { attendance: "attended", lifecycle: "foreground" },
      requestedAuthority: "destructive",
      authorityApproval: { approved: true },
      providerRoute: { providerId: "codex-oauth", surface: "direct-provider", model: "gpt-test" },
      adapterKind: "direct",
      executionMode: "direct-provider",
    });
    const bundle = admissionBundle(templateRequest, "codex-direct");
    const approve = vi.fn(() => ({ status: "approved" as const, authorizedBy: "Test operator" }));
    const sessionAuthority = new AttendedTrustedExecutionLeaseSessionAuthority({
      binding: {
        localPrincipalId: "local-operator-session:executor",
        operatorSessionId: session.id,
        projectRuntimeId: PROJECT_RUNTIME_ID,
        compositionRevision: COMPOSITION_REVISION,
      },
      approvalPort: { approve },
    });
    let observedContext: ManagedAttendedTrustedExecutionContext | undefined;
    const descriptor = {
      ...makeWriteDescriptor(),
      adapterDescriptorId: "adapter:codex-oauth:direct",
      providerId: "codex-oauth",
      adapterKind: "direct" as const,
      supportedExecutionModes: ["direct-provider"] as const,
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor,
      invoke: vi.fn(async (input) => {
        observedContext = input.attendedTrustedExecution;
        return makeRecordForRequest(input.request, input.admission.capabilitySnapshot);
      }),
    };
    const options = {
      invocationService: new RuntimeManagedAgentInvocationService(),
      routes: [
        {
          routeId: "codex-direct",
          routeSource: "explicit-managed-route" as const,
          providerId: "codex-oauth",
          model: "gpt-test",
          surface: "direct-provider" as const,
          capability: {
            identity: { routeId: "codex-direct", revision: "test-v1" },
            target: { providerId: "codex-oauth", modelId: "gpt-test" },
            adapter: { kind: "direct-provider" as const, capabilityId: "codex-direct", capabilityVersion: "test-v1" },
            authorityCeiling: "destructive" as const,
            toolNames: templateRequest.authority.toolAuthority.allowedToolNames,
            supportsRecursion: false,
            supportsAttachments: false,
            supportsWrite: true,
            proof: {
              status: "configured" as const,
              source: "test",
              provenAccess: ["approved-write" as const],
            },
            capacity: { kind: "accountless" as const },
            settlement: { kind: "not-required" as const },
          },
          createAdapter: async () => adapter,
          profiles: [
            {
              authorityProfileId: templateRequest.authority.authorityProfileId,
              access: "approved-write" as const,
              allowedToolNames: templateRequest.authority.toolAuthority.allowedToolNames,
              writeAllowed: true,
              networkAllowed: false,
              workingDirectory: templateRequest.authority.workingDirectory,
              timeoutMs: templateRequest.authority.timeoutMs,
              credentialRoute: templateRequest.authority.credentialRoute,
              memoryScope: templateRequest.authority.memoryScope,
              writeAuthority: templateRequest.authority.writeAuthority!,
            },
          ],
        },
      ],
    };
    const attachment = withManagedChildAuthorityAdmission(
      createManagedInvocationToolAttachment(options, {
        kind: "kiln-runtime",
        surface: "test",
        attachmentId: "attachment:attended-test",
      }),
      { bundle },
    );
    const executor = createManagedInvocationLifecycleToolExecutors(attachment).get("managed_agent.invoke");
    if (!executor) throw new Error("managed_agent.invoke was not created");

    const result = (await executor(
      {
        access: "approved-write",
        routeId: "codex-direct",
        providerRoute: { providerId: "codex-oauth", model: "gpt-test" },
        requestedAuthority: "destructive",
        task: "Apply the exact attended change.",
      },
      {
        session,
        turnId,
        toolCall: { id: "tool-call-attended", name: "managed_agent.invoke", input: {} },
        effectiveTurnAuthority: bundle.turn.authority,
        attendedTrustedExecutionSessionAuthority: sessionAuthority,
      },
    )) as { readonly isError: boolean };

    expect(result.isError).toBe(false);
    expect(approve).toHaveBeenCalledOnce();
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorSessionId: session.id,
        routeId: "codex-direct",
        profileCeiling: "trusted-full-access",
        allowedToolNames: [...templateRequest.authority.toolAuthority.allowedToolNames].sort(),
        policyDigest: bundle.admissionId,
      }),
    );
    expect(observedContext?.authority.lifecycle).toBe("completed");
  });

  it("rejects destructive work before runtime observation or adapter dispatch when the lease is absent", async () => {
    const { request, descriptor, bundle } = destructiveFixture();
    const observe = vi.fn();
    const invoke = vi.fn();
    const adapter: ManagedAgentRuntimeAdapter = { descriptor, invoke };
    const service = new RuntimeManagedAgentInvocationService({
      clock: () => new Date(NOW),
      authorityObserver: { observe },
    });

    await expect(
      service.start(
        request,
        adapter,
        {
          capturedAt: NOW,
          routeId: "codex-direct",
          routeSource: "explicit-managed-route",
        },
        { childAuthorityAdmission: { bundle } },
      ),
    ).rejects.toThrow("Attended trusted execution denied before dispatch: process-local lease authority is absent.");
    expect(observe).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("passes an exact active context to the adapter without serializing it into the request", async () => {
    const { request, descriptor, bundle } = destructiveFixture();
    const context = await issuedContext(request, bundle);
    const snapshotInput = {
      capturedAt: NOW,
      routeId: "codex-direct",
      routeSource: "explicit-managed-route" as const,
    };
    const capabilitySnapshot = buildManagedAgentCapabilitySnapshot(request, descriptor, snapshotInput);
    const admission = evaluateManagedAgentAdmission(request, descriptor, snapshotInput, { evaluatedAt: NOW });
    if (admission.status !== "admitted") throw new Error(`fixture admission denied: ${admission.reason}`);
    const invoke = vi.fn(async (input) => {
      expect(input.attendedTrustedExecution).toBe(context);
      expect(input.request).not.toHaveProperty("attendedTrustedExecution");
      return makeRecordForRequest(request, capabilitySnapshot);
    });
    const adapter: ManagedAgentRuntimeAdapter = { descriptor, invoke };
    const service = new RuntimeManagedAgentInvocationService({ clock: () => new Date(NOW) });

    await service.invokeAdmitted({
      request,
      adapter,
      admission,
      childAuthorityAdmission: { bundle },
      attendedTrustedExecution: context,
    });

    expect(invoke).toHaveBeenCalledOnce();
  });

  it("cannot reuse a directly invoked context after expiry is observed and the clock rolls back", async () => {
    const { request, descriptor, bundle } = destructiveFixture();
    const context = await issuedContext(request, bundle);
    const snapshotInput = {
      capturedAt: NOW,
      routeId: "codex-direct",
      routeSource: "explicit-managed-route" as const,
    };
    const admission = evaluateManagedAgentAdmission(request, descriptor, snapshotInput, { evaluatedAt: NOW });
    if (admission.status !== "admitted") throw new Error(`fixture admission denied: ${admission.reason}`);
    const invoke = vi.fn();
    const adapter: ManagedAgentRuntimeAdapter = { descriptor, invoke };
    let now = new Date("2026-08-24T01:00:00.000Z");
    const directInput = {
      request,
      adapter,
      admission,
      childAuthorityAdmission: { bundle },
      attendedTrustedExecution: context,
    } as const;

    await expect(
      new RuntimeManagedAgentInvocationService({ clock: () => now }).invokeAdmitted(directInput),
    ).rejects.toThrow("lease is expired");
    expect(context.authority.lifecycle).toBe("revoked");

    now = new Date(NOW);
    await expect(
      new RuntimeManagedAgentInvocationService({ clock: () => now }).invokeAdmitted(directInput),
    ).rejects.toThrow("lease is revoked");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects a lease whose composition does not match the persisted turn admission", async () => {
    const { request, descriptor, bundle } = destructiveFixture();
    const context = await issuedContext(request, bundle);
    const snapshotInput = {
      capturedAt: NOW,
      routeId: "codex-direct",
      routeSource: "explicit-managed-route" as const,
    };
    const admission = evaluateManagedAgentAdmission(request, descriptor, snapshotInput, { evaluatedAt: NOW });
    if (admission.status !== "admitted") throw new Error(`fixture admission denied: ${admission.reason}`);
    const invoke = vi.fn();

    await expect(
      new RuntimeManagedAgentInvocationService({ clock: () => new Date(NOW) }).invokeAdmitted({
        request,
        adapter: { descriptor, invoke },
        admission,
        childAuthorityAdmission: { bundle },
        attendedTrustedExecution: {
          ...context,
          compositionRevision: `sha256:${"9".repeat(64)}`,
        },
      }),
    ).rejects.toThrow("admitted composition revision does not match");
    expect(invoke).not.toHaveBeenCalled();
  });
});

function admissionBundle(
  request: ReturnType<typeof defineManagedAgentInvocationRequest>,
  routeId: string,
): EffectiveAuthorityAdmissionBundle {
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: request.parentSessionId,
    turnId: request.parentTurnId,
    admittedAt: ISSUED_AT,
    configuration: {
      sessionRevision: { revisionSetId: COMPOSITION_REVISION, revisions: { tests: COMPOSITION_REVISION } },
      turnRevision: { revisionSetId: COMPOSITION_REVISION, revisions: { tests: COMPOSITION_REVISION } },
    },
    session: {
      skillCatalog: { catalogId: "attended-test", revision: COMPOSITION_REVISION, skillIds: [] },
      authorityCeiling: { maximumAuthority: "destructive", reason: "attended test" },
    },
    turn: {
      capabilityParticipation: { status: "not-requested" },
      authority: {
        executionMode: "execute",
        requestedAuthority: "destructive",
        admittedAuthority: "destructive",
        sourcePolicy: "runtime_surface_projection",
        reason: "attended test",
        completeness: "authoritative",
        toolCount: request.authority.toolAuthority.allowedToolNames.length,
        deniedToolCount: 0,
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: {
        allowedToolPermissions: request.authority.toolAuthority.allowedToolNames.map((toolName) => ({
          toolName,
          authority: { level: 3, allowed: true, requiresApproval: false, reason: "attended test" },
          effectEnvelope: EFFECT_CEILING,
        })),
        deniedToolNames: [],
      },
      effectCeiling: EFFECT_CEILING,
      budget: { status: "not-configured" },
      execution: {
        status: "routed",
        target: {
          targetId: routeId,
          providerId: "codex-oauth",
          providerModelId: "gpt-test",
          accountSelection: { kind: "operator-override", accountPolicyId: "policy-1", accountId: "account-1" },
        },
        dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "policy-admitted" } },
        binding: {
          status: "bound",
          routeId,
          accountId: "account-1",
          credentialId: "credential-1",
          credentialRevision: "credential-revision-1",
        },
      },
    },
  });
}
