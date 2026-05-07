import type {
  ArtifactResourceStore,
  Capability,
  ManagedAgentAdmissionProfile,
  ManagedAgentAuthorityProfile,
  ManagedAgentCredentialRoute,
  ManagedAgentMemoryScope,
  ManagedAgentInvocationRecord,
  ManagedAgentProviderRoute,
  ManagedAgentWorkingDirectory,
  CanonicalSessionEvent,
  ToolDefinition,
} from "@kilnai/core";
import { defineManagedAgentInvocationRequest } from "@kilnai/core";
import type {
  RuntimeBuiltinToolExecutionContext,
  RuntimeBuiltinToolExecutor,
} from "../../session/runtime-session-orchestrator.types.js";
import { RuntimeManagedAgentInvocationService } from "./index.js";
import type { ManagedAgentRuntimeAdapter } from "./index.js";
import { appendManagedInvocationSessionEvents } from "./session-events.js";

export const MANAGED_AGENT_INVOKE_TOOL_NAME = "managed_agent.invoke";

export interface ManagedInvocationRouteProfile {
  readonly authorityProfileId: string;
  readonly permissionProfile: string;
  readonly allowedToolNames: readonly string[];
  readonly writeAllowed?: boolean;
  readonly networkAllowed?: boolean;
  readonly workingDirectory: ManagedAgentWorkingDirectory;
  readonly timeoutMs: number;
  readonly credentialRoute: ManagedAgentCredentialRoute;
  readonly memoryScope: ManagedAgentMemoryScope;
  readonly writeAuthority?: ManagedAgentAuthorityProfile["writeAuthority"];
}

export interface ManagedInvocationToolRoute {
  readonly routeId: string;
  readonly providerId: string;
  readonly model?: string;
  readonly adapter: ManagedAgentRuntimeAdapter;
  readonly surface?: string;
  readonly profiles: Partial<Record<ManagedAgentAdmissionProfile, ManagedInvocationRouteProfile>>;
}

export interface ManagedInvocationToolOptions {
  readonly routes: readonly ManagedInvocationToolRoute[];
  readonly requestedBy?: string;
  readonly requestSource?: string;
  readonly artifactStore?: ArtifactResourceStore;
  readonly sessionEventSink?: ManagedInvocationSessionEventSink;
}

export interface ManagedInvocationSessionEventSink {
  publish(
    events: readonly CanonicalSessionEvent[],
    context: RuntimeBuiltinToolExecutionContext,
  ): void | Promise<void>;
}

interface ManagedInvocationToolInput {
  readonly profile: ManagedAgentAdmissionProfile;
  readonly routeId?: string;
  readonly providerRoute: ManagedAgentProviderRoute;
  readonly task: string;
  readonly summary: string;
  readonly resourceUris?: readonly string[];
}

interface ManagedInvocationToolResult {
  readonly output: string;
  readonly isError: boolean;
  readonly metadata: Record<string, unknown>;
}

export const MANAGED_AGENT_INVOKE_TOOL: ToolDefinition = {
  name: MANAGED_AGENT_INVOKE_TOOL_NAME,
  description: "Request a governed managed child agent invocation through a configured Kiln runtime route. The runtime owns admission, authority, credentials, lifecycle evidence, and session events.",
  inputSchema: {
    type: "object",
    properties: {
      profile: {
        type: "string",
        enum: ["foundation-readonly-plan", "foundation-propose-writes", "foundation-apply-approved-writes", "foundation-memory-write-proposals"],
        default: "foundation-readonly-plan",
        description: "Configured managed invocation authority profile to request.",
      },
      routeId: {
        type: "string",
        description: "Optional configured managed invocation route id.",
      },
      providerRoute: {
        type: "object",
        properties: {
          providerId: {
            type: "string",
            description: "Configured managed provider id.",
          },
          model: {
            type: "string",
            description: "Optional provider model override allowed by the configured route.",
          },
          reasoningEffort: {
            type: "string",
            description: "Optional provider reasoning effort.",
          },
        },
        required: ["providerId"],
        additionalProperties: false,
      },
      task: {
        type: "string",
        description: "Bounded child task prompt.",
      },
      summary: {
        type: "string",
        description: "Optional short invocation summary. Defaults to task.",
      },
      resourceUris: {
        type: "array",
        items: { type: "string" },
        description: "Optional governed resource URIs to make available to the child.",
      },
    },
    required: ["profile", "providerRoute", "task"],
    additionalProperties: false,
  },
  tags: new Set<string>(["managed-invocation", "operator-approval"]),
};

export const MANAGED_AGENT_INVOKE_CAPABILITY: Capability = {
  name: MANAGED_AGENT_INVOKE_TOOL.name,
  description: MANAGED_AGENT_INVOKE_TOOL.description,
  schema: MANAGED_AGENT_INVOKE_TOOL.inputSchema,
  tags: ["managed-invocation", "operator-approval"],
  annotations: { destructive: true },
};

export function createManagedInvocationToolExecutor(
  options: ManagedInvocationToolOptions,
): RuntimeBuiltinToolExecutor {
  const service = new RuntimeManagedAgentInvocationService();
  return async (input, context) => executeManagedInvocationTool(input, context, options, service);
}

export function attachManagedInvocationSessionEventSink(
  options: ManagedInvocationToolOptions | undefined,
  sessionEventSink: ManagedInvocationSessionEventSink,
): ManagedInvocationToolOptions | undefined {
  if (!options) {
    return undefined;
  }
  const existingSink = options.sessionEventSink;
  return {
    ...options,
    sessionEventSink: {
      publish: async (events, context) => {
        await existingSink?.publish(events, context);
        await sessionEventSink.publish(events, context);
      },
    },
  };
}

async function executeManagedInvocationTool(
  rawInput: Record<string, unknown>,
  context: RuntimeBuiltinToolExecutionContext | undefined,
  options: ManagedInvocationToolOptions,
  service: RuntimeManagedAgentInvocationService,
): Promise<ManagedInvocationToolResult> {
  if (!context) {
    return errorResult("managed_agent.invoke requires runtime session context.");
  }

  const parsed = parseInput(rawInput);
  if (!parsed.ok) {
    return errorResult(parsed.error);
  }

  const route = resolveRoute(options.routes, parsed.input);
  if (!route) {
    return errorResult(`No managed invocation route is configured for provider '${parsed.input.providerRoute.providerId}' and profile '${parsed.input.profile}'.`);
  }

  const profileDefaults = route.profiles[parsed.input.profile];
  if (!profileDefaults) {
    return errorResult(`Managed invocation route '${route.routeId}' does not allow profile '${parsed.input.profile}'.`);
  }

  const invocationId = buildInvocationId(context.session.id, context.session.userTurnCount, context.toolCall.id);
  const request = defineManagedAgentInvocationRequest({
    invocationId,
    agentId: `${route.routeId}:${parsed.input.profile}`,
    parentSessionId: context.session.id,
    parentTurnId: `${context.session.id}:turn:${Math.max(context.session.userTurnCount, 1)}`,
    profile: parsed.input.profile,
    requestedBy: options.requestedBy ?? "assistant",
    requestSource: options.requestSource ?? "runtime-tool",
    providerRoute: {
      providerId: route.providerId,
      surface: route.surface ?? route.adapter.descriptor.supportedExecutionModes[0] ?? "cli-harness",
      ...(parsed.input.providerRoute.model ?? route.model ? { model: parsed.input.providerRoute.model ?? route.model } : {}),
      ...(parsed.input.providerRoute.reasoningEffort ? { reasoningEffort: parsed.input.providerRoute.reasoningEffort } : {}),
    },
    adapterKind: route.adapter.descriptor.adapterKind,
    executionMode: route.adapter.descriptor.supportedExecutionModes[0] ?? "cli-harness",
    authority: {
      authorityProfileId: profileDefaults.authorityProfileId,
      permissionProfile: profileDefaults.permissionProfile,
      toolAuthority: {
        allowedToolNames: profileDefaults.allowedToolNames,
        writeAllowed: profileDefaults.writeAllowed === true,
        networkAllowed: profileDefaults.networkAllowed === true,
      },
      workingDirectory: profileDefaults.workingDirectory,
      timeoutMs: profileDefaults.timeoutMs,
      credentialRoute: profileDefaults.credentialRoute,
      memoryScope: profileDefaults.memoryScope,
      ...(profileDefaults.writeAuthority ? { writeAuthority: profileDefaults.writeAuthority } : {}),
    },
    input: {
      summary: parsed.input.summary,
      prompt: parsed.input.task,
      ...(parsed.input.resourceUris ? { resourceUris: parsed.input.resourceUris } : {}),
    },
  });

  const startedAt = Date.now();
  const invocationResult = await service.invoke(request, route.adapter);
  const durationMs = Date.now() - startedAt;
  const result = invocationResult.status === "completed"
    ? {
        ...invocationResult,
        record: persistManagedInvocationResources(invocationResult.record, options.artifactStore),
      }
    : invocationResult;
  const events = appendManagedInvocationSessionEvents({
    session: context.session,
    request,
    decision: result.decision,
    ...(result.status === "completed" ? { record: result.record, durationMs } : {}),
  });
  await options.sessionEventSink?.publish(events, context);

  if (result.status === "denied") {
    return {
      output: `Managed invocation denied: ${result.decision.reason}`,
      isError: true,
      metadata: {
        toolName: MANAGED_AGENT_INVOKE_TOOL_NAME,
        kind: "managed-invocation",
        invocationId,
        routeId: route.routeId,
        status: "denied",
        profile: request.profile,
        providerRoute: request.providerRoute,
        adapterKind: request.adapterKind,
        executionMode: request.executionMode,
        authorityProfileId: request.authority.authorityProfileId,
        missingCapabilities: result.decision.missingCapabilities,
        sessionEventIds: events.map((event) => event.eventId),
      },
    };
  }

  const summary = result.record.resultHandoff?.summary ?? `Managed invocation ${result.record.lifecycleState}.`;
  const terminalError = result.record.lifecycleState !== "completed";
  return {
    output: summary,
    isError: terminalError,
    metadata: {
      toolName: MANAGED_AGENT_INVOKE_TOOL_NAME,
      kind: "managed-invocation",
      invocationId,
      routeId: route.routeId,
      status: result.record.lifecycleState,
      profile: result.record.profile,
      providerRoute: result.record.providerRoute,
      adapterKind: result.record.adapterKind,
      executionMode: result.record.executionMode,
      authorityProfileId: result.record.authority.authorityProfileId,
      childSessionId: result.record.childSessionId,
      childTurnId: result.record.childTurnId,
      resultHandoff: result.record.resultHandoff,
      transcript: result.record.transcript,
      sessionEventIds: events.map((event) => event.eventId),
    },
  };
}

function resolveRoute(
  routes: readonly ManagedInvocationToolRoute[],
  input: ManagedInvocationToolInput,
): ManagedInvocationToolRoute | undefined {
  return routes.find((route) =>
    route.providerId === input.providerRoute.providerId
    && (!input.routeId || route.routeId === input.routeId)
    && route.profiles[input.profile] !== undefined
  );
}

function persistManagedInvocationResources(
  record: ManagedAgentInvocationRecord,
  artifactStore: ArtifactResourceStore | undefined,
): ManagedAgentInvocationRecord {
  if (!artifactStore) {
    return record;
  }
  const remappedUris = new Map<string, string>();
  const persistUri = (uri: string, title: string, content: string): string => {
    const existing = remappedUris.get(uri);
    if (existing) {
      return existing;
    }
    const artifact = artifactStore.put({
      namespace: "managed-invocations",
      title,
      mimeType: "text/markdown",
      content: { type: "text", text: content },
      producer: { kind: "managed-invocation", name: record.providerRoute.providerId },
      retention: { scope: "session" },
    });
    const resourceUri = `kiln://artifacts/managed-invocations/${artifact.id}/content`;
    remappedUris.set(uri, resourceUri);
    return resourceUri;
  };

  const transcriptUri = record.transcript
    ? persistUri(
        record.transcript.uri,
        `Managed invocation ${record.invocationId} transcript`,
        formatManagedInvocationTranscript(record),
      )
    : undefined;
  const diagnosticUris = new Map(
    (record.diagnostics ?? []).map((diagnostic) => [
      diagnostic.uri,
      persistUri(
        diagnostic.uri,
        `Managed invocation ${record.invocationId} ${diagnostic.kind}`,
        formatManagedInvocationDiagnostic(record, diagnostic.kind),
      ),
    ] as const),
  );
  const resourceUris = record.resultHandoff?.resourceUris.map((uri) => {
    if (record.transcript?.uri === uri && transcriptUri) {
      return transcriptUri;
    }
    return diagnosticUris.get(uri) ?? uri;
  });

  return {
    ...record,
    ...(record.transcript && transcriptUri
      ? {
          transcript: {
            ...record.transcript,
            uri: transcriptUri,
            persisted: true,
            retention: "session" as const,
          },
        }
      : {}),
    ...(record.diagnostics
      ? {
          diagnostics: record.diagnostics.map((diagnostic) => ({
            ...diagnostic,
            uri: diagnosticUris.get(diagnostic.uri) ?? diagnostic.uri,
          })),
        }
      : {}),
    ...(record.resultHandoff && resourceUris
      ? {
          resultHandoff: {
            ...record.resultHandoff,
            resourceUris,
          },
        }
      : {}),
  };
}

function formatManagedInvocationTranscript(record: ManagedAgentInvocationRecord): string {
  return [
    "# Managed Invocation Transcript",
    "",
    `Invocation ID: ${record.invocationId}`,
    `Status: ${record.lifecycleState}`,
    `Profile: ${record.profile}`,
    `Provider: ${record.providerRoute.providerId}`,
    record.providerRoute.model ? `Model: ${record.providerRoute.model}` : undefined,
    `Surface: ${record.providerRoute.surface}`,
    `Adapter: ${record.adapterKind}`,
    `Execution: ${record.executionMode}`,
    record.childSessionId ? `Child session: ${record.childSessionId}` : undefined,
    record.childTurnId ? `Child turn: ${record.childTurnId}` : undefined,
    "",
    "## Result",
    "",
    record.resultHandoff?.summary ?? "No result summary was recorded.",
  ].filter((line): line is string => line !== undefined).join("\n");
}

function formatManagedInvocationDiagnostic(record: ManagedAgentInvocationRecord, kind: string): string {
  return [
    "# Managed Invocation Diagnostic",
    "",
    `Invocation ID: ${record.invocationId}`,
    `Diagnostic: ${kind}`,
    `Status: ${record.lifecycleState}`,
    `Provider: ${record.providerRoute.providerId}`,
    record.providerRoute.model ? `Model: ${record.providerRoute.model}` : undefined,
    "",
    record.resultHandoff?.summary ?? "No diagnostic summary was recorded.",
  ].filter((line): line is string => line !== undefined).join("\n");
}

function parseInput(input: Record<string, unknown>): { readonly ok: true; readonly input: ManagedInvocationToolInput } | { readonly ok: false; readonly error: string } {
  const profile = input.profile === undefined ? "foundation-readonly-plan" : input.profile;
  if (
    profile !== "foundation-readonly-plan"
    && profile !== "foundation-propose-writes"
    && profile !== "foundation-apply-approved-writes"
    && profile !== "foundation-memory-write-proposals"
  ) {
    return { ok: false, error: "managed_agent.invoke profile is not supported." };
  }
  const providerRoute = readRecord(input.providerRoute);
  const providerId = readText(providerRoute?.providerId);
  if (!providerId) {
    return { ok: false, error: "managed_agent.invoke requires providerRoute.providerId." };
  }
  const task = readText(input.task);
  if (!task) {
    return { ok: false, error: "managed_agent.invoke requires task." };
  }
  const resourceUris = Array.isArray(input.resourceUris)
    ? input.resourceUris.map(readText).filter((uri): uri is string => uri !== undefined)
    : undefined;
  return {
    ok: true,
    input: {
      profile,
      routeId: readText(input.routeId),
      providerRoute: {
        providerId,
        surface: "configured",
        ...(readText(providerRoute?.model) ? { model: readText(providerRoute?.model) } : {}),
        ...(readText(providerRoute?.reasoningEffort) ? { reasoningEffort: readText(providerRoute?.reasoningEffort) } : {}),
      },
      task,
      summary: readText(input.summary) ?? task,
      ...(resourceUris && resourceUris.length > 0 ? { resourceUris } : {}),
    },
  };
}

function errorResult(output: string): ManagedInvocationToolResult {
  return {
    output,
    isError: true,
    metadata: {
      toolName: MANAGED_AGENT_INVOKE_TOOL_NAME,
      kind: "managed-invocation",
      status: "failed",
    },
  };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildInvocationId(sessionId: string, turnCount: number, toolCallId: string): string {
  return `managed-${sanitizeId(sessionId)}-${Math.max(turnCount, 1)}-${sanitizeId(toolCallId)}`;
}

function sanitizeId(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return sanitized.length > 0 ? sanitized.slice(0, 96) : "invocation";
}
