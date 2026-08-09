// Extracted from the managed-invocation runtime tool; behavior is intentionally unchanged.
// The invoke and start executors that call prepareManagedInvocationRequest
// then drive the invocation service.
import type { CanonicalSessionEvent, ManagedAgentExternalRuntimeAttachmentIdentity } from "@kilnai/core";
import type { RuntimeBuiltinToolExecutionContext } from "../../../session/runtime-session-orchestrator.types.js";
import {
  MANAGED_AGENT_INVOKE_TOOL_NAME,
  MANAGED_AGENT_START_TOOL_NAME,
} from "../tool-names.js";
import {
  projectManagedInvocationCapabilitySnapshotResources,
  projectManagedInvocationPublicResourceUri,
  projectManagedInvocationRecordResources,
  projectManagedInvocationResourceLeaseResources,
} from "../resource-projection.js";
import type {
  ManagedAgentRuntimeInvocationTerminalNotification,
  RuntimeManagedAgentInvocationService,
} from "../index.js";
import type { ManagedInvocationToolAttachment, ManagedInvocationToolResult } from "./types.js";
import { prepareManagedInvocationRequest } from "./request-preparation.js";
import {
  appendAndPublishManagedInvocationStartSessionEvents,
  appendAndPublishManagedInvocationTerminalSessionEvent,
  terminalSessionEventIdsForResult,
} from "./session-event-publishing.js";
import {
  buildManagedInvocationPresentationIntent,
  formatManagedInvocationAdmissionDenied,
  projectManagedInvocationAuthoritySnapshot,
  projectManagedInvocationTimeoutEvidence,
  terminalManagedInvocationResult,
} from "./result-projection.js";

interface ManagedInvocationExternalRuntimeAttachmentDenial {
  readonly errorCode:
    | "external_runtime_attachment_mismatch"
    | "external_runtime_attachment_missing"
    | "external_runtime_attachment_unsupported_route";
  readonly output: string;
  readonly requestedAttachment?: ManagedAgentExternalRuntimeAttachmentIdentity;
  readonly routeAttachment?: ManagedAgentExternalRuntimeAttachmentIdentity;
}

// Roadmap 01 Slice 3.1 - the admission decision (denied/missingCapabilities)
// is owned by evaluateManagedAgentAdmission in @kilnai/core; this only
// formats the operator-facing diagnostic for the invoke/start tool surface.
function managedInvocationExternalRuntimeAttachmentDenial(
  routeId: string,
  routeAttachment: ManagedAgentExternalRuntimeAttachmentIdentity | undefined,
  requestedAttachment: ManagedAgentExternalRuntimeAttachmentIdentity | undefined,
  missingCapabilities: readonly string[],
): ManagedInvocationExternalRuntimeAttachmentDenial | undefined {
  if (missingCapabilities.includes("externalRuntimeAttachment.mismatch") && routeAttachment && requestedAttachment) {
    return {
      errorCode: "external_runtime_attachment_mismatch",
      output: `Managed invocation route '${routeId}' is attached to external runtime '${routeAttachment.runtimeId}:${routeAttachment.attachmentId}', but this dispatch requires '${requestedAttachment.runtimeId}:${requestedAttachment.attachmentId}'. Kiln does not retarget attachments. Re-issue against the route attached to the required instance, or correct \`externalRuntimeAttachment\`.`,
      requestedAttachment,
      routeAttachment,
    };
  }
  if (missingCapabilities.includes("externalRuntimeAttachment.missing") && routeAttachment) {
    return {
      errorCode: "external_runtime_attachment_missing",
      output: `Managed invocation route '${routeId}' is attached to external runtime '${routeAttachment.runtimeId}:${routeAttachment.attachmentId}'. This dispatch must state \`externalRuntimeAttachment\` explicitly; Kiln will not infer the target instance.`,
      routeAttachment,
    };
  }
  if (missingCapabilities.includes("externalRuntimeAttachment.unsupported-route") && requestedAttachment) {
    return {
      errorCode: "external_runtime_attachment_unsupported_route",
      output: `Managed invocation route '${routeId}' does not declare an external runtime attachment, but this dispatch requires '${requestedAttachment.runtimeId}:${requestedAttachment.attachmentId}'. Re-issue against a route attached to the required instance, or omit \`externalRuntimeAttachment\`.`,
      requestedAttachment,
    };
  }
  return undefined;
}

export async function executeManagedInvocationTool(
  rawInput: Record<string, unknown>,
  context: RuntimeBuiltinToolExecutionContext | undefined,
  attachment: ManagedInvocationToolAttachment,
  service: RuntimeManagedAgentInvocationService,
  scopeAdmission: "required" | "already-admitted" = "required",
): Promise<ManagedInvocationToolResult> {
  const { options } = attachment;
  const preparedResult = await prepareManagedInvocationRequest(
    rawInput,
    context,
    attachment,
    MANAGED_AGENT_INVOKE_TOOL_NAME,
    scopeAdmission,
  );
  if (!preparedResult.ok) {
    return preparedResult.result;
  }
  const { prepared } = preparedResult;
  const { adapter } = prepared.route;
  const startedAt = Date.now();
  const startResult = await service.start(
    prepared.request,
    adapter,
    prepared.capabilitySnapshotInput,
    {
      ...prepared.lifecycleOptions,
      ...(options.invocationOwner ? { owner: options.invocationOwner } : {}),
      ...(!prepared.lifecycleOptions?.abortSignal && prepared.context.abortSignal
        ? { abortSignal: prepared.context.abortSignal }
        : {}),
    },
  );
  const startEvents = await appendAndPublishManagedInvocationStartSessionEvents({
    options,
    context: prepared.context,
    request: prepared.request,
    decision: startResult.decision,
  });
  if (startResult.status === "denied") {
    const attachmentDenial = managedInvocationExternalRuntimeAttachmentDenial(
      prepared.route.routeId,
      prepared.route.externalRuntimeAttachment,
      prepared.request.externalRuntimeAttachment,
      startResult.decision.missingCapabilities,
    );
    return {
      output: attachmentDenial?.output ?? `Managed invocation denied: ${startResult.decision.reason}`,
      isError: true,
      metadata: {
        toolName: MANAGED_AGENT_INVOKE_TOOL_NAME,
        kind: "managed-invocation",
        invocationId: prepared.request.invocationId,
        routeId: prepared.route.routeId,
        routeSource: prepared.route.routeSource,
        parentSessionId: prepared.request.parentSessionId,
        parentTurnId: prepared.request.parentTurnId,
        status: "denied",
        profile: prepared.request.profile,
        providerRoute: prepared.request.providerRoute,
        ...(prepared.route.voiceProfile ? { voiceProfile: prepared.route.voiceProfile } : {}),
        adapterKind: prepared.request.adapterKind,
        executionMode: prepared.request.executionMode,
        requestedAuthority: prepared.request.requestedAuthority,
        authorityProfileId: prepared.request.authority.authorityProfileId,
        context: prepared.request.input.context,
        ...(prepared.request.input.handoff ? { handoffContract: prepared.request.input.handoff } : {}),
        missingCapabilities: startResult.decision.missingCapabilities,
        ...(attachmentDenial ? { errorCode: attachmentDenial.errorCode } : {}),
        ...(attachmentDenial?.requestedAttachment ? { requestedAttachment: attachmentDenial.requestedAttachment } : {}),
        ...(attachmentDenial?.routeAttachment ? { routeAttachment: attachmentDenial.routeAttachment } : {}),
        ...(startResult.decision.resourceLease
          ? {
              resourceLease: projectManagedInvocationResourceLeaseResources(
                startResult.decision.resourceLease,
                projectManagedInvocationPublicResourceUri,
              ),
            }
          : {}),
        sessionEventIds: startEvents.map((event) => event.eventId),
        presentationIntent: buildManagedInvocationPresentationIntent({
          sourceToolName: MANAGED_AGENT_INVOKE_TOOL_NAME,
          routeId: prepared.route.routeId,
          routeSource: prepared.route.routeSource,
          profile: prepared.request.profile,
          providerId: prepared.request.providerRoute.providerId,
          model: prepared.request.providerRoute.model,
          contextMode: prepared.parsed.contextMode,
          status: "denied",
          substantiveEvidence: false,
          failureReason: attachmentDenial?.output ?? startResult.decision.reason,
        }),
      },
    };
  }
  let invocationResult: Awaited<ReturnType<RuntimeManagedAgentInvocationService["join"]>>;
  try {
    invocationResult = await service.join(startResult.snapshot.invocationId);
  } catch (error) {
    const terminalizedSnapshot = service.status(prepared.request.invocationId);
    if (terminalizedSnapshot?.record === undefined) {
      throw error;
    }
    const terminalEvents = await appendAndPublishManagedInvocationTerminalSessionEvent({
      options,
      context: prepared.context,
      request: terminalizedSnapshot.request,
      record: terminalizedSnapshot.record,
      ...(terminalizedSnapshot.durationMs !== undefined
        ? { durationMs: terminalizedSnapshot.durationMs }
        : {}),
    });
    const record = projectManagedInvocationRecordResources(terminalizedSnapshot.record, {
      artifactStore: options.artifactStore,
    });
    return terminalManagedInvocationResult({
      toolName: MANAGED_AGENT_INVOKE_TOOL_NAME,
      rawInput: prepared.canonicalizedRawInput,
      routeId: terminalizedSnapshot.decision.capabilitySnapshot.routeId,
      voiceProfile: terminalizedSnapshot.decision.capabilitySnapshot.childIdentity.voiceProfile,
      contextMode: terminalizedSnapshot.decision.capabilitySnapshot.contextMode,
      request: terminalizedSnapshot.request,
      record,
      pauseRequirementResolver: options.pauseRequirementResolver,
      progressEvents: terminalizedSnapshot.progressEvents,
      ...(prepared.canonicalizedForbiddenInputFields
        ? { canonicalizedForbiddenInputFields: prepared.canonicalizedForbiddenInputFields }
        : {}),
      sessionEventIds: [...startEvents, ...terminalEvents].map((event) => event.eventId),
    });
  }
  if (invocationResult.status !== "completed") {
    throw new Error("Admitted managed invocation returned a denied terminal result.");
  }
  const durationMs = Date.now() - startedAt;
  const terminalEvents = await appendAndPublishManagedInvocationTerminalSessionEvent({
    options,
    context: prepared.context,
    request: prepared.request,
    record: invocationResult.record,
    durationMs,
  });
  const result = {
    ...invocationResult,
    record: projectManagedInvocationRecordResources(invocationResult.record, { artifactStore: options.artifactStore }),
  };
  const events = [...startEvents, ...terminalEvents];

  const terminalSnapshot = service.status(prepared.request.invocationId);
  return terminalManagedInvocationResult({
    toolName: MANAGED_AGENT_INVOKE_TOOL_NAME,
    rawInput: prepared.canonicalizedRawInput,
    routeId: prepared.route.routeId,
    ...(prepared.route.voiceProfile ? { voiceProfile: prepared.route.voiceProfile } : {}),
    contextMode: prepared.parsed.contextMode,
    request: prepared.request,
    record: result.record,
    pauseRequirementResolver: options.pauseRequirementResolver,
    progressEvents: terminalSnapshot?.progressEvents,
    ...(prepared.canonicalizedForbiddenInputFields
      ? { canonicalizedForbiddenInputFields: prepared.canonicalizedForbiddenInputFields }
      : {}),
    sessionEventIds: events.map((event) => event.eventId),
  });
}

export async function executeManagedInvocationStartTool(
  rawInput: Record<string, unknown>,
  context: RuntimeBuiltinToolExecutionContext | undefined,
  attachment: ManagedInvocationToolAttachment,
  service: RuntimeManagedAgentInvocationService,
): Promise<ManagedInvocationToolResult> {
  const { options } = attachment;
  const preparedResult = await prepareManagedInvocationRequest(rawInput, context, attachment, MANAGED_AGENT_START_TOOL_NAME);
  if (!preparedResult.ok) {
    return preparedResult.result;
  }
  const { prepared } = preparedResult;
  const { adapter } = prepared.route;
  let terminalPublicationEnabled = true;
  let markStartSessionEventsReady = (): void => {};
  const startSessionEventsReady = new Promise<void>((resolve) => {
    markStartSessionEventsReady = resolve;
  });
  const publishBackgroundTerminal = (
    notification: ManagedAgentRuntimeInvocationTerminalNotification,
  ): void => {
    void startSessionEventsReady
      .then(async () => {
        if (!terminalPublicationEnabled) {
          return;
        }
        await appendAndPublishManagedInvocationTerminalSessionEvent({
          options,
          context: prepared.context,
          request: notification.request,
          record: notification.record,
          ...(notification.durationMs !== undefined ? { durationMs: notification.durationMs } : {}),
        });
      })
      .catch(() => undefined);
  };
  let startResult: Awaited<ReturnType<RuntimeManagedAgentInvocationService["start"]>>;
  try {
    startResult = await service.start(
      prepared.request,
      adapter,
      prepared.capabilitySnapshotInput,
      {
        ...prepared.lifecycleOptions,
        ...(options.invocationOwner ? { owner: options.invocationOwner } : {}),
        ...(prepared.context.abortSignal ? { abortSignal: prepared.context.abortSignal } : {}),
        terminalObserver: publishBackgroundTerminal,
      },
    );
  } catch (error) {
    const terminalizedSnapshot = service.status(prepared.request.invocationId);
    if (terminalizedSnapshot?.record !== undefined) {
      const record = projectManagedInvocationRecordResources(terminalizedSnapshot.record, {
        artifactStore: options.artifactStore,
      });
      let events: readonly CanonicalSessionEvent[] = [];
      try {
        const startEvents = await appendAndPublishManagedInvocationStartSessionEvents({
          options,
          context: prepared.context,
          request: terminalizedSnapshot.request,
          decision: terminalizedSnapshot.decision,
        });
        const terminalEvents = await appendAndPublishManagedInvocationTerminalSessionEvent({
          options,
          context: prepared.context,
          request: terminalizedSnapshot.request,
          record: terminalizedSnapshot.record,
          ...(terminalizedSnapshot.durationMs !== undefined ? { durationMs: terminalizedSnapshot.durationMs } : {}),
        });
        events = [...startEvents, ...terminalEvents];
      } finally {
        markStartSessionEventsReady();
      }
      return terminalManagedInvocationResult({
        toolName: MANAGED_AGENT_START_TOOL_NAME,
        rawInput,
        routeId: terminalizedSnapshot.decision.capabilitySnapshot.routeId,
        voiceProfile: terminalizedSnapshot.decision.capabilitySnapshot.childIdentity.voiceProfile,
        contextMode: terminalizedSnapshot.decision.capabilitySnapshot.contextMode,
        request: terminalizedSnapshot.request,
        record,
        pauseRequirementResolver: options.pauseRequirementResolver,
        progressEvents: terminalizedSnapshot.progressEvents,
        ...(prepared.canonicalizedForbiddenInputFields
          ? { canonicalizedForbiddenInputFields: prepared.canonicalizedForbiddenInputFields }
          : {}),
        sessionEventIds: terminalSessionEventIdsForResult({
          events,
          context: prepared.context,
          invocationId: prepared.request.invocationId,
        }),
      });
    }
    terminalPublicationEnabled = false;
    markStartSessionEventsReady();
    throw error;
  }
  let events: readonly CanonicalSessionEvent[] = [];
  try {
    events = await appendAndPublishManagedInvocationStartSessionEvents({
      options,
      context: prepared.context,
      request: prepared.request,
      decision: startResult.decision,
    });
  } finally {
    markStartSessionEventsReady();
  }

  if (startResult.status === "denied") {
    const attachmentDenial = managedInvocationExternalRuntimeAttachmentDenial(
      prepared.route.routeId,
      prepared.route.externalRuntimeAttachment,
      prepared.request.externalRuntimeAttachment,
      startResult.decision.missingCapabilities,
    );
    return {
      output: attachmentDenial?.output ?? `Managed invocation denied: ${startResult.decision.reason}`,
      isError: true,
      metadata: {
        toolName: MANAGED_AGENT_START_TOOL_NAME,
        kind: "managed-invocation",
        invocationId: prepared.request.invocationId,
        routeId: prepared.route.routeId,
        routeSource: prepared.route.routeSource,
        parentSessionId: prepared.request.parentSessionId,
        parentTurnId: prepared.request.parentTurnId,
        status: "denied",
        lifecycleState: "failed",
        profile: prepared.request.profile,
        providerRoute: prepared.request.providerRoute,
        adapterKind: prepared.request.adapterKind,
        executionMode: prepared.request.executionMode,
        requestedAuthority: prepared.request.requestedAuthority,
        authorityProfileId: prepared.request.authority.authorityProfileId,
        context: prepared.request.input.context,
        ...(prepared.request.input.handoff ? { handoffContract: prepared.request.input.handoff } : {}),
        missingCapabilities: startResult.decision.missingCapabilities,
        ...(attachmentDenial ? { errorCode: attachmentDenial.errorCode } : {}),
        ...(attachmentDenial?.requestedAttachment ? { requestedAttachment: attachmentDenial.requestedAttachment } : {}),
        ...(attachmentDenial?.routeAttachment ? { routeAttachment: attachmentDenial.routeAttachment } : {}),
        ...(startResult.decision.resourceLease
          ? {
              resourceLease: projectManagedInvocationResourceLeaseResources(
                startResult.decision.resourceLease,
                projectManagedInvocationPublicResourceUri,
              ),
            }
          : {}),
        sessionEventIds: events.map((event) => event.eventId),
        presentationIntent: buildManagedInvocationPresentationIntent({
          sourceToolName: MANAGED_AGENT_START_TOOL_NAME,
          routeId: prepared.route.routeId,
          routeSource: prepared.route.routeSource,
          profile: prepared.request.profile,
          providerId: prepared.request.providerRoute.providerId,
          model: prepared.request.providerRoute.model,
          contextMode: prepared.request.input.context?.mode,
          status: "denied",
          substantiveEvidence: false,
          failureReason: attachmentDenial?.output ?? formatManagedInvocationAdmissionDenied(startResult.decision),
        }),
      },
    };
  }

  const capabilitySnapshot = projectManagedInvocationCapabilitySnapshotResources(
    startResult.snapshot.decision.capabilitySnapshot,
    projectManagedInvocationPublicResourceUri,
  );
  const authoritySnapshot = projectManagedInvocationAuthoritySnapshot(startResult.snapshot.request.authority);
  const timeoutEvidence = projectManagedInvocationTimeoutEvidence(
    startResult.snapshot.decision.capabilitySnapshot.authorityProfile,
  );
  return {
    output: JSON.stringify({
      status: "started",
      lifecycleState: startResult.snapshot.lifecycleState,
      invocationId: startResult.snapshot.invocationId,
      routeId: prepared.route.routeId,
      routeSource: prepared.route.routeSource,
      parentSessionId: startResult.snapshot.parentSessionId,
      parentTurnId: startResult.snapshot.parentTurnId,
      profile: startResult.snapshot.profile,
      ...timeoutEvidence,
      authoritySnapshot,
    }, null, 2),
    isError: false,
    metadata: {
      toolName: MANAGED_AGENT_START_TOOL_NAME,
      kind: "managed-invocation",
      invocationId: startResult.snapshot.invocationId,
      routeId: prepared.route.routeId,
      routeSource: prepared.route.routeSource,
      parentSessionId: startResult.snapshot.parentSessionId,
      parentTurnId: startResult.snapshot.parentTurnId,
      status: "started",
      lifecycleState: startResult.snapshot.lifecycleState,
      ...timeoutEvidence,
      profile: startResult.snapshot.profile,
      providerRoute: startResult.snapshot.providerRoute,
      ...(prepared.route.voiceProfile ? { voiceProfile: prepared.route.voiceProfile } : {}),
      adapterKind: startResult.snapshot.adapterKind,
      executionMode: startResult.snapshot.executionMode,
      requestedAuthority: prepared.request.requestedAuthority,
      authorityProfileId: startResult.snapshot.authorityProfileId,
      authoritySnapshot,
      capabilitySnapshot,
      context: prepared.request.input.context,
      ...(prepared.request.input.handoff ? { handoffContract: prepared.request.input.handoff } : {}),
      sessionEventIds: events.map((event) => event.eventId),
    },
  };
}
