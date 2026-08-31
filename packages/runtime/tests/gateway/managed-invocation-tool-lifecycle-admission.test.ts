import {
  buildManagedAgentCapabilitySnapshot,
  defineManagedAgentInvocationRecord,
  defineManagedAgentWriteAuthority,
  type ManagedAgentInvocationRecord,
  type ManagedAgentInvocationRequest,
  type ManagedAgentLifecycleState,
} from "@kilnai/core/agents";
import { textParts } from "@kilnai/core/engine";
import { MemoryArtifactResourceStore } from "@kilnai/core/tools";
import { describe, expect, it, vi } from "vitest";
import {
  ManagedAgentLeaseAcquireError,
  type ManagedAgentRuntimeAdapter,
  type ManagedAgentWorktreeLeaseManager,
  ManagedAgentWorktreeReviewRequiredError,
  ManagedRuntimeCredentialRouteLeaseManager,
  ManagedRuntimeSandboxLeaseManager,
} from "../../src/agents/managed-invocation/index.js";
import type { ManagedInvocationContextResolver } from "../../src/agents/managed-invocation/runtime-tool/types.js";
import type { RuntimeBuiltinToolExecutionContext } from "../../src/session/runtime-session-orchestrator.js";
import {
  assertManagedToolResult,
  createAttachedRuntimeBuiltinToolSurface,
  deferred,
  expectPublicResourceLeaseMetadata,
  flushMicrotasks,
  makeAbortableDeferredAdapter,
  makeAdapter,
  makeAdapterWithHandoff,
  makeDeferredAdapter,
  makeDescriptor,
  makeManagedRoute,
  makeObservedRuntimeInvocationService,
  makeProgressReportingDeferredAdapter,
  makeRejectingDeferredAdapter,
  makeRouteCapability,
  makeSession,
  makeSurface,
  TEST_DESTRUCTIVE_PARENT_AUTHORITY,
  TEST_HANDOFF_PROVENANCE,
  waitForCondition,
} from "./managed-invocation-tool-test-fixture.js";

describe("managed invocation runtime tool — lifecycle and admission", () => {
  it("exposes nonblocking managed child lifecycle tools backed by one runtime registry", async () => {
    const { adapter, terminal } = makeDeferredAdapter();
    const sessionEventSink = { publish: vi.fn() };
    const surface = makeSurface(adapter, sessionEventSink);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-bg",
        name: "managed_agent.start",
        input: {},
      },
    };

    const toolNames = surface.toolDefinitions.map((tool) => tool.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "managed_agent.invoke",
        "managed_agent.start",
        "managed_agent.status",
        "managed_agent.list",
        "managed_agent.join",
        "managed_agent.cancel",
        "managed_agent.orchestrate",
      ]),
    );

    const started = (await surface.callBuiltinTools.get("managed_agent.start")?.(
      {
        access: "read-only",
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Inspect the managed invocation tool contract and report risks.",
        requestedAuthority: "read_only",
      },
      context,
    )) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly invocationId: string;
        readonly status: string;
        readonly lifecycleState: string;
        readonly routeId: string;
        readonly routeSource: string;
        readonly parentTurnId: string;
        readonly timeoutMs?: number;
        readonly timeoutSource?: string;
        readonly authoritySnapshot?: {
          readonly toolAuthority?: {
            readonly allowedToolNames?: readonly string[];
            readonly writeAllowed?: boolean;
            readonly networkAllowed?: boolean;
          };
          readonly workingDirectory?: {
            readonly path?: string;
            readonly mode?: string;
          };
          readonly memoryScope?: {
            readonly access?: string;
          };
        };
        readonly sessionEventIds?: readonly string[];
      };
    };
    const startedOutput = JSON.parse(started.output) as {
      readonly parentTurnId?: string;
      readonly timeoutMs?: number;
      readonly timeoutSource?: string;
      readonly authoritySnapshot?: {
        readonly toolAuthority?: {
          readonly allowedToolNames?: readonly string[];
          readonly writeAllowed?: boolean;
          readonly networkAllowed?: boolean;
        };
      };
    };

    expect(started).toMatchObject({
      isError: false,
      metadata: {
        status: "started",
        lifecycleState: "running",
        routeId: "opencode-readonly",
        routeSource: "explicit-managed-route",
        parentTurnId: `${session.id}:turn:1`,
        timeoutMs: 120000,
        timeoutSource: "explicit-route",
        authoritySnapshot: {
          toolAuthority: {
            allowedToolNames: ["read", "grep", "glob"],
            writeAllowed: false,
            networkAllowed: false,
          },
          workingDirectory: {
            path: "C:/workspace/kiln",
            mode: "read-only",
          },
          memoryScope: {
            access: "read-only",
          },
        },
      },
    });
    expect(startedOutput).toMatchObject({
      parentTurnId: `${session.id}:turn:1`,
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
      authoritySnapshot: {
        toolAuthority: {
          allowedToolNames: ["read", "grep", "glob"],
          writeAllowed: false,
          networkAllowed: false,
        },
      },
    });
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
    expect(adapter.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          executionIntent: {
            attendance: "unattended",
            lifecycle: "background",
          },
        }),
      }),
    );
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
    ]);
    expect(started.metadata.sessionEventIds).toEqual(session.sessionEvents.map((event) => event.eventId));
    expect(sessionEventSink.publish).toHaveBeenCalledWith(session.sessionEvents, expect.objectContaining(context));

    const status = (await surface.callBuiltinTools.get("managed_agent.status")?.(
      {
        invocationId: started.metadata.invocationId,
      },
      {
        ...context,
        toolCall: { id: "tool-call-status", name: "managed_agent.status", input: {} },
      },
    )) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly lifecycleState?: string;
        readonly routeSource?: string;
        readonly parentTurnId?: string;
        readonly timeoutMs?: number;
        readonly timeoutSource?: string;
        readonly authoritySnapshot?: {
          readonly toolAuthority?: {
            readonly allowedToolNames?: readonly string[];
            readonly writeAllowed?: boolean;
            readonly networkAllowed?: boolean;
          };
        };
      };
    };
    const statusOutput = JSON.parse(status.output) as {
      readonly timeoutMs?: number;
      readonly timeoutSource?: string;
      readonly authoritySnapshot?: {
        readonly toolAuthority?: {
          readonly allowedToolNames?: readonly string[];
          readonly writeAllowed?: boolean;
          readonly networkAllowed?: boolean;
        };
      };
    };
    expect(status).toMatchObject({
      isError: false,
      metadata: {
        status: "running",
        lifecycleState: "running",
        routeSource: "explicit-managed-route",
        parentTurnId: `${session.id}:turn:1`,
        timeoutMs: 120000,
        timeoutSource: "explicit-route",
        authoritySnapshot: {
          toolAuthority: {
            allowedToolNames: ["read", "grep", "glob"],
            writeAllowed: false,
            networkAllowed: false,
          },
        },
      },
    });
    expect(statusOutput).toMatchObject({
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
      authoritySnapshot: {
        toolAuthority: {
          allowedToolNames: ["read", "grep", "glob"],
          writeAllowed: false,
          networkAllowed: false,
        },
      },
    });

    const listed = (await surface.callBuiltinTools.get("managed_agent.list")?.(
      {},
      {
        ...context,
        toolCall: { id: "tool-call-list", name: "managed_agent.list", input: {} },
      },
    )) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly invocations?: readonly {
          readonly invocationId?: string;
          readonly lifecycleState?: string;
          readonly routeSource?: string;
          readonly parentTurnId?: string;
          readonly timeoutMs?: number;
          readonly timeoutSource?: string;
        }[];
      };
    };
    const listedOutput = JSON.parse(listed.output) as {
      readonly invocations?: readonly {
        readonly timeoutMs?: number;
        readonly timeoutSource?: string;
      }[];
    };
    expect(listed).toMatchObject({
      isError: false,
      metadata: {
        invocations: [
          {
            invocationId: started.metadata.invocationId,
            lifecycleState: "running",
            routeSource: "explicit-managed-route",
            parentTurnId: `${session.id}:turn:1`,
            timeoutMs: 120000,
            timeoutSource: "explicit-route",
          },
        ],
      },
    });
    expect(listedOutput.invocations?.[0]).toMatchObject({
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
    });

    const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      .request as ManagedAgentInvocationRequest;
    terminal.resolve(
      defineManagedAgentInvocationRecord({
        invocationId: request.invocationId,
        agentId: request.agentId,
        parentSessionId: request.parentSessionId,
        parentTurnId: request.parentTurnId,
        access: request.access,
        lifecycleState: "completed",
        providerRoute: request.providerRoute,
        adapterKind: request.adapterKind,
        executionMode: request.executionMode,
        authority: request.authority,
        capabilitySnapshot: buildManagedAgentCapabilitySnapshot(request, adapter.descriptor, {
          routeId: "opencode-readonly",
          routeSource: "explicit-managed-route",
        }),
        childSessionId: `${request.parentSessionId}:managed:${request.invocationId}`,
        childTurnId: `${request.parentSessionId}:managed:${request.invocationId}:turn:1`,
        resultHandoff: {
          provenance: TEST_HANDOFF_PROVENANCE,
          summary: "Child review completed.",
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/result`],
          memoryWriteProposalUris: [],
        },
      }),
    );
    await waitForCondition(() => session.sessionEvents.some((event) => event.kind === "agent_invocation_completed"));

    const completedStatusBeforeJoin = (await surface.callBuiltinTools.get("managed_agent.status")?.(
      {
        invocationId: started.metadata.invocationId,
      },
      {
        ...context,
        toolCall: { id: "tool-call-status-complete", name: "managed_agent.status", input: {} },
      },
    )) as {
      readonly output: string;
      readonly metadata: {
        readonly lifecycleState?: string;
        readonly childSessionId?: string;
        readonly childTurnId?: string;
        readonly timeoutMs?: number;
        readonly timeoutSource?: string;
        readonly resultHandoff?: unknown;
        readonly transcript?: unknown;
        readonly terminalEvidenceAvailable?: boolean;
      };
    };
    const completedStatusOutput = JSON.parse(completedStatusBeforeJoin.output) as {
      readonly childSessionId?: string;
      readonly childTurnId?: string;
      readonly timeoutMs?: number;
      readonly timeoutSource?: string;
    };
    expect(completedStatusBeforeJoin.metadata).toMatchObject({
      lifecycleState: "completed",
      childSessionId: `${session.id}:managed:${started.metadata.invocationId}`,
      childTurnId: `${session.id}:managed:${started.metadata.invocationId}:turn:1`,
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
      terminalEvidenceAvailable: true,
    });
    expect(completedStatusOutput).toMatchObject({
      childSessionId: `${session.id}:managed:${started.metadata.invocationId}`,
      childTurnId: `${session.id}:managed:${started.metadata.invocationId}:turn:1`,
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
    });
    expect(completedStatusBeforeJoin.metadata.resultHandoff).toBeUndefined();
    expect(completedStatusBeforeJoin.metadata.transcript).toBeUndefined();

    const completedListBeforeJoin = (await surface.callBuiltinTools.get("managed_agent.list")?.(
      {},
      {
        ...context,
        toolCall: { id: "tool-call-list-complete", name: "managed_agent.list", input: {} },
      },
    )) as {
      readonly output: string;
      readonly metadata: {
        readonly invocations?: readonly {
          readonly lifecycleState?: string;
          readonly childSessionId?: string;
          readonly childTurnId?: string;
          readonly timeoutMs?: number;
          readonly timeoutSource?: string;
          readonly resultHandoff?: unknown;
          readonly transcript?: unknown;
          readonly terminalEvidenceAvailable?: boolean;
        }[];
      };
    };
    const completedListOutput = JSON.parse(completedListBeforeJoin.output) as {
      readonly invocations?: readonly {
        readonly childSessionId?: string;
        readonly childTurnId?: string;
        readonly timeoutMs?: number;
        readonly timeoutSource?: string;
      }[];
    };
    expect(completedListBeforeJoin.metadata.invocations?.[0]).toMatchObject({
      lifecycleState: "completed",
      childSessionId: `${session.id}:managed:${started.metadata.invocationId}`,
      childTurnId: `${session.id}:managed:${started.metadata.invocationId}:turn:1`,
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
      terminalEvidenceAvailable: true,
    });
    expect(completedListOutput.invocations?.[0]).toMatchObject({
      childSessionId: `${session.id}:managed:${started.metadata.invocationId}`,
      childTurnId: `${session.id}:managed:${started.metadata.invocationId}:turn:1`,
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
    });
    expect(completedListBeforeJoin.metadata.invocations?.[0]?.resultHandoff).toBeUndefined();
    expect(completedListBeforeJoin.metadata.invocations?.[0]?.transcript).toBeUndefined();

    const joined = (await surface.callBuiltinTools.get("managed_agent.join")?.(
      {
        invocationId: started.metadata.invocationId,
      },
      {
        ...context,
        toolCall: { id: "tool-call-join", name: "managed_agent.join", input: {} },
      },
    )) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly lifecycleState?: string;
        readonly childSessionId?: string;
        readonly childTurnId?: string;
        readonly timeoutMs?: number;
        readonly timeoutSource?: string;
        readonly authoritySnapshot?: {
          readonly toolAuthority?: {
            readonly allowedToolNames?: readonly string[];
            readonly writeAllowed?: boolean;
            readonly networkAllowed?: boolean;
          };
        };
        readonly resultHandoff?: { readonly summary?: string; readonly resourceUris?: readonly string[] };
      };
    };
    const joinedOutput = JSON.parse(joined.output) as {
      readonly childSessionId?: string;
      readonly childTurnId?: string;
      readonly timeoutMs?: number;
      readonly timeoutSource?: string;
      readonly authoritySnapshot?: {
        readonly toolAuthority?: {
          readonly allowedToolNames?: readonly string[];
          readonly writeAllowed?: boolean;
          readonly networkAllowed?: boolean;
        };
      };
    };

    expect(joined).toMatchObject({
      output: expect.stringContaining("Child review completed."),
      isError: false,
      metadata: {
        status: "completed",
        lifecycleState: "completed",
        childSessionId: `${session.id}:managed:${started.metadata.invocationId}`,
        childTurnId: `${session.id}:managed:${started.metadata.invocationId}:turn:1`,
        timeoutMs: 120000,
        timeoutSource: "explicit-route",
        authoritySnapshot: {
          toolAuthority: {
            allowedToolNames: ["read", "grep", "glob"],
            writeAllowed: false,
            networkAllowed: false,
          },
        },
        resultHandoff: {
          summary: "Child review completed.",
        },
      },
    });
    expect(joinedOutput).toMatchObject({
      childSessionId: `${session.id}:managed:${started.metadata.invocationId}`,
      childTurnId: `${session.id}:managed:${started.metadata.invocationId}:turn:1`,
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
      authoritySnapshot: {
        toolAuthority: {
          allowedToolNames: ["read", "grep", "glob"],
          writeAllowed: false,
          networkAllowed: false,
        },
      },
    });
    expect(joined.metadata.resultHandoff?.resourceUris).toContain(
      `kiln://managed-agents/invocations/${started.metadata.invocationId}/resources/result`,
    );
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_completed",
    ]);
    expect(sessionEventSink.publish).toHaveBeenCalledTimes(2);
    expect(sessionEventSink.publish).toHaveBeenLastCalledWith(
      [expect.objectContaining({ kind: "agent_invocation_completed" })],
      expect.objectContaining({
        toolCall: expect.objectContaining({ name: "managed_agent.start" }),
      }),
    );

    await surface.callBuiltinTools.get("managed_agent.join")?.(
      {
        invocationId: started.metadata.invocationId,
      },
      {
        ...context,
        toolCall: { id: "tool-call-join-2", name: "managed_agent.join", input: {} },
      },
    );
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_completed",
    ]);
  });

  it("fails closed when background managed_agent.start cannot prove runtime authority", async () => {
    const adapter = makeAdapter();
    const surface = makeSurface(adapter, undefined, undefined, { observeRuntimeAuthority: false });
    const session = makeSession();

    const result = (await surface.callBuiltinTools.get("managed_agent.start")?.(
      {
        access: "read-only",
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Start without runtime authority proof.",
        requestedAuthority: "read_only",
      },
      {
        session,
        toolCall: {
          id: "tool-call-bg-unproven",
          name: "managed_agent.start",
          input: {},
        },
      },
    )) as { readonly isError: boolean; readonly metadata?: { readonly missingCapabilities?: readonly string[] } };

    expect(result).toMatchObject({
      isError: true,
      metadata: {
        missingCapabilities: ["authorityEvidence.effective-policy-unproven"],
      },
    });
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it("projects managed child progress events before terminal join", async () => {
    const { adapter, terminal } = makeProgressReportingDeferredAdapter();
    const surface = makeSurface(adapter);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-progress-bg",
        name: "managed_agent.start",
        input: {},
      },
    };

    const started = (await surface.callBuiltinTools.get("managed_agent.start")?.(
      {
        access: "read-only",
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Inspect tool progress.",
        requestedAuthority: "read_only",
      },
      context,
    )) as {
      readonly metadata: {
        readonly invocationId: string;
      };
    };

    await waitForCondition(() => {
      const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].request as
        | ManagedAgentInvocationRequest
        | undefined;
      return request?.invocationId === started.metadata.invocationId;
    });
    await flushMicrotasks();

    const status = (await surface.callBuiltinTools.get("managed_agent.status")?.(
      {
        invocationId: started.metadata.invocationId,
      },
      {
        ...context,
        toolCall: { id: "tool-call-progress-status", name: "managed_agent.status", input: {} },
      },
    )) as {
      readonly output: string;
      readonly metadata: {
        readonly lifecycleState?: string;
        readonly progressEventCount?: number;
        readonly recentProgressEvents?: readonly {
          readonly kind?: string;
          readonly summary?: string;
          readonly toolName?: string;
        }[];
      };
    };
    const statusOutput = JSON.parse(status.output) as {
      readonly progressEventCount?: number;
      readonly recentProgressEvents?: readonly {
        readonly kind?: string;
        readonly summary?: string;
        readonly toolName?: string;
      }[];
    };

    expect(status.metadata).toMatchObject({
      lifecycleState: "running",
      progressEventCount: 10,
    });
    expect(status.metadata.recentProgressEvents).toHaveLength(8);
    expect(status.metadata.recentProgressEvents?.[0]).toMatchObject({
      kind: "tool_called",
      summary: "grep 3 called",
      toolName: "grep",
    });
    expect(status.metadata.recentProgressEvents?.at(-1)).toMatchObject({ summary: "grep 10 called" });
    expect(statusOutput.recentProgressEvents).toEqual(status.metadata.recentProgressEvents);
    expect(statusOutput).not.toHaveProperty("progressEvents");

    const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      .request as ManagedAgentInvocationRequest;
    terminal.resolve(
      defineManagedAgentInvocationRecord({
        invocationId: request.invocationId,
        agentId: request.agentId,
        parentSessionId: request.parentSessionId,
        parentTurnId: request.parentTurnId,
        access: request.access,
        lifecycleState: "completed",
        providerRoute: request.providerRoute,
        adapterKind: request.adapterKind,
        executionMode: request.executionMode,
        authority: request.authority,
        capabilitySnapshot: buildManagedAgentCapabilitySnapshot(request, adapter.descriptor, {
          routeId: "opencode-readonly",
          routeSource: "explicit-managed-route",
        }),
        resultHandoff: {
          provenance: TEST_HANDOFF_PROVENANCE,
          summary: "Progress child completed.",
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/result`],
          memoryWriteProposalUris: [],
        },
      }),
    );
    await flushMicrotasks();

    const joined = (await surface.callBuiltinTools.get("managed_agent.join")?.(
      {
        invocationId: started.metadata.invocationId,
      },
      {
        ...context,
        toolCall: { id: "tool-call-progress-join", name: "managed_agent.join", input: {} },
      },
    )) as {
      readonly metadata: {
        readonly recentProgressEvents?: readonly {
          readonly kind?: string;
          readonly toolName?: string;
        }[];
      };
    };

    expect(joined.metadata.recentProgressEvents).toEqual(status.metadata.recentProgressEvents);
  });

  it("fails closed before invocation when required read paths are outside route authority", async () => {
    const adapter = makeAdapter();
    const surface = makeSurface(adapter);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-read-authority",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = assertManagedToolResult(
      await surface.callBuiltinTools.get("managed_agent.invoke")?.(
        {
          access: "read-only",
          providerRoute: { providerId: "opencode" },
          task: "Collect visual reference research from local cloned harnesses.",
          summary: "Collect visual reference research.",
          contextMode: "isolated",
          requiredToolNames: ["read", "grep", "glob"],
          requiredReadPaths: ["/workspace/references/cloned"],
          expectedEvidence: ["visual-reference-research"],
          executionPhase: {
            id: "visual-reference-research",
            expectedEvidence: ["visual-reference-research"],
            requiredToolNames: ["read", "grep", "glob"],
            completionTool: "work_item.update",
            finalPhase: false,
            autoStartAllowed: false,
          },
        },
        context,
      ),
    );

    expect(result?.isError).toBe(true);
    expect(result?.output).toContain("cannot execute this phase because it cannot read required paths");
    expect(result?.metadata).toMatchObject({
      routeId: "opencode-readonly",
      status: "unavailable",
      missingRequiredReadPaths: ["/workspace/references/cloned"],
    });
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it("admits invocation when required read paths are covered by read authority", async () => {
    const adapter = makeAdapter();
    const route = makeManagedRoute("opencode-readonly", "opencode-default-model", async () => adapter);
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [
          {
            ...route,
            profiles: [
              {
                ...route.profiles[0]!,
                readAuthority: {
                  workspace: {
                    allowedPaths: ["/workspace/references/cloned"],
                    deniedPaths: ["/workspace/references/cloned/codex/.git"],
                  },
                },
              },
            ],
          },
        ],
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-read-authority-covered",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = assertManagedToolResult(
      await surface.callBuiltinTools.get("managed_agent.invoke")?.(
        {
          access: "read-only",
          providerRoute: { providerId: "opencode" },
          task: "Collect visual reference research from local cloned harnesses.",
          summary: "Collect visual reference research.",
          contextMode: "isolated",
          requiredToolNames: ["read", "grep", "glob"],
          requiredReadPaths: ["/workspace/references/cloned"],
          expectedEvidence: ["visual-reference-research"],
        },
        context,
      ),
    );

    expect(result?.isError).toBe(false);
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
  });

  it("admits relative required read paths inside the managed working directory", async () => {
    const adapter = makeAdapter();
    const surface = makeSurface(adapter);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-relative-required-read-path",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = assertManagedToolResult(
      await surface.callBuiltinTools.get("managed_agent.invoke")?.(
        {
          access: "read-only",
          providerRoute: { providerId: "opencode" },
          task: "Inspect local managed-agent files.",
          summary: "Inspect local files.",
          contextMode: "isolated",
          requiredToolNames: ["read", "grep", "glob"],
          requiredReadPaths: [
            "packages/cli/src/config/managed-agent-routes.ts",
            "packages/runtime/src/agents/managed-invocation/runtime-tool.ts",
          ],
          expectedEvidence: ["route admission evidence"],
        },
        context,
      ),
    );

    expect(result?.isError).toBe(false);
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
  });

  it("uses the persisted parent turn id instead of hydrated runtime turn count", async () => {
    const adapter = makeAdapter();
    const surface = makeSurface(adapter);
    const session = makeSession();
    session.addUserMessage(textParts("Hydrated prior turn 2."));
    session.addUserMessage(textParts("Hydrated prior turn 3."));
    session.addUserMessage(textParts("Hydrated prior turn 4."));
    session.addUserMessage(textParts("Hydrated prior turn 5."));
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      turnId: `${session.id}:turn:3`,
      toolCall: {
        id: "tool-call-start-lineage",
        name: "managed_agent.start",
        input: {},
      },
    };

    await surface.callBuiltinTools.get("managed_agent.start")?.(
      {
        access: "read-only",
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Inspect lineage.",
        requestedAuthority: "read_only",
      },
      context,
    );

    const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      .request as ManagedAgentInvocationRequest;
    expect(session.userTurnCount).toBe(5);
    expect(request.parentTurnId).toBe(`${session.id}:turn:3`);
    expect(request.invocationId).toBe("managed-session-parent-3-tool-call-start-lineage");
  });

  it("projects start metadata and replay events before terminal records exist", async () => {
    const { adapter } = makeDeferredAdapter();
    const surface = makeSurface(adapter);
    const session = makeSession();
    const rawResourceUri = "kiln://managed-invocations/sibling-start/context";
    const canonicalResourceUri = "kiln://managed-agents/invocations/sibling-start/resources/context";
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-start-projection",
        name: "managed_agent.start",
        input: {},
      },
    };

    const started = (await surface.callBuiltinTools.get("managed_agent.start")?.(
      {
        access: "read-only",
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Inspect start projection before terminal evidence exists.",
        requestedAuthority: "read_only",
        contextMode: "resources",
        resourceUris: [rawResourceUri],
      },
      context,
    )) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly capabilitySnapshot?: unknown;
        readonly parentTurnId?: string;
        readonly routeSource?: string;
      };
    };
    const serializedSurfaceEvidence = JSON.stringify({
      metadata: started.metadata,
      sessionEvents: session.sessionEvents,
    });

    expect(started.isError).toBe(false);
    expect(started.metadata.parentTurnId).toBe(`${session.id}:turn:1`);
    expect(started.metadata.routeSource).toBe("explicit-managed-route");
    expect(serializedSurfaceEvidence).toContain(canonicalResourceUri);
    expect(serializedSurfaceEvidence).not.toContain("kiln://managed-invocations/");
  });

  it("keeps artifact-backed managed resources stable across repeated joins", async () => {
    const { adapter, terminal } = makeDeferredAdapter();
    const artifactStore = new MemoryArtifactResourceStore();
    const surface = makeSurface(adapter, undefined, artifactStore);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-artifact-start",
        name: "managed_agent.start",
        input: {},
      },
    };

    const started = (await surface.callBuiltinTools.get("managed_agent.start")?.(
      {
        access: "read-only",
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Inspect the managed invocation resource artifact contract.",
        requestedAuthority: "read_only",
      },
      context,
    )) as {
      readonly metadata: {
        readonly invocationId: string;
      };
    };
    const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      .request as ManagedAgentInvocationRequest;
    terminal.resolve(
      defineManagedAgentInvocationRecord({
        invocationId: request.invocationId,
        agentId: request.agentId,
        parentSessionId: request.parentSessionId,
        parentTurnId: request.parentTurnId,
        access: request.access,
        lifecycleState: "completed",
        providerRoute: request.providerRoute,
        adapterKind: request.adapterKind,
        executionMode: request.executionMode,
        authority: request.authority,
        capabilitySnapshot: buildManagedAgentCapabilitySnapshot(request, adapter.descriptor, {
          routeId: "opencode-readonly",
          routeSource: "explicit-managed-route",
        }),
        transcript: {
          uri: `kiln://managed-invocations/${request.invocationId}/transcript`,
          redacted: "unknown",
          truncated: false,
          persisted: true,
          retention: "session",
        },
        resultHandoff: {
          provenance: TEST_HANDOFF_PROVENANCE,
          summary: "Child artifact evidence completed.",
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/transcript`],
          memoryWriteProposalUris: [],
        },
      }),
    );
    await flushMicrotasks();

    const join = async (toolCallId: string) =>
      surface.callBuiltinTools.get("managed_agent.join")?.(
        {
          invocationId: started.metadata.invocationId,
        },
        {
          ...context,
          toolCall: { id: toolCallId, name: "managed_agent.join", input: {} },
        },
      ) as Promise<{
        readonly isError: boolean;
        readonly metadata: {
          readonly transcript?: { readonly uri?: string };
          readonly resultHandoff?: { readonly resourceUris?: readonly string[] };
        };
      }>;

    const firstJoin = await join("tool-call-artifact-join-1");
    const secondJoin = await join("tool-call-artifact-join-2");

    expect(firstJoin.isError).toBe(false);
    expect(firstJoin.metadata.transcript?.uri).toMatch(/^kiln:\/\/artifacts\/managed-invocations\//u);
    expect(secondJoin.metadata.transcript?.uri).toBe(firstJoin.metadata.transcript?.uri);
    expect(secondJoin.metadata.resultHandoff?.resourceUris).toEqual(firstJoin.metadata.resultHandoff?.resourceUris);
  });

  it("normalizes direct runtime tool credential route ids before admission", async () => {
    const adapter = makeAdapter();
    const route = makeManagedRoute("opencode-readonly", "opencode-default-model", async () => adapter);
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [
          {
            ...route,
            profiles: [
              {
                ...route.profiles[0]!,
                credentialRoute: {
                  mode: "runtime-selected",
                  routeId: " credential-route:opencode:token-primary ",
                },
              },
            ],
          },
        ],
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        access: "read-only",
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Inspect the managed invocation tool contract and report risks.",
        requestedAuthority: "read_only",
      },
      context,
    )) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly resourceLease?: {
          readonly resourceUris?: readonly string[];
          readonly diagnosticUris?: readonly string[];
        };
      };
    };

    expect(result.isError).toBe(false);
    const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      .request as ManagedAgentInvocationRequest;
    expect(request.authority.credentialRoute).toEqual({
      mode: "runtime-selected",
      routeId: "credential-route:opencode:token-primary",
    });
    expectPublicResourceLeaseMetadata(result.metadata.resourceLease);
    expect(result.metadata.resourceLease?.resourceUris).toContain(
      "kiln://artifacts/managed-session-parent-1-tool-call-1/credential-route/credential-route%3Aopencode%3Atoken-primary",
    );
    expect(result.metadata.resourceLease?.diagnosticUris).toContain(
      "kiln://artifacts/managed-session-parent-1-tool-call-1/credential-route-release/credential-route%3Aopencode%3Atoken-primary",
    );
  });

  it("backs fallback runtime tool services with sandbox lease evidence", async () => {
    const adapter = makeAdapter();
    const route = makeManagedRoute("opencode-sandbox", "opencode-default-model", async () => adapter);
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        invocationService: makeObservedRuntimeInvocationService({
          credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
            allowedRouteIds: ["credential-route:opencode-sandbox"],
          }),
          sandboxLeaseManager: new ManagedRuntimeSandboxLeaseManager(),
        }),
        routes: [
          {
            ...route,
            profiles: [
              {
                ...route.profiles[0]!,
                workingDirectory: {
                  path: "C:/workspace/kiln",
                  mode: "sandbox",
                },
              },
            ],
          },
        ],
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-sandbox",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        access: "read-only",
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Inspect the managed invocation tool contract from a sandbox route.",
        requestedAuthority: "read_only",
      },
      context,
    )) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly resourceLease?: {
          readonly resourceUris?: readonly string[];
          readonly diagnosticUris?: readonly string[];
        };
      };
    };

    expect(result.isError).toBe(false);
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
    const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      .request as ManagedAgentInvocationRequest;
    expect(request.authority.workingDirectory).toEqual({
      path: "C:/workspace/kiln",
      mode: "sandbox",
    });
    expectPublicResourceLeaseMetadata(result.metadata.resourceLease);
    expect(result.metadata.resourceLease?.resourceUris).toContain(
      "kiln://artifacts/managed-session-parent-1-tool-call-sandbox/sandbox-policy",
    );
    expect(result.metadata.resourceLease?.diagnosticUris).toContain(
      "kiln://artifacts/managed-session-parent-1-tool-call-sandbox/sandbox-policy-release",
    );
  });

  it("cancels managed_agent.invoke through the parent runtime abort signal", async () => {
    const terminal = deferred<ManagedAgentInvocationRecord>();
    let adapterSignal: AbortSignal | undefined;
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ request, admission, abortSignal }) => {
        adapterSignal = abortSignal;
        await terminal.promise;
        return defineManagedAgentInvocationRecord({
          invocationId: request.invocationId,
          agentId: request.agentId,
          parentSessionId: request.parentSessionId,
          parentTurnId: request.parentTurnId,
          access: request.access,
          lifecycleState: "completed",
          providerRoute: request.providerRoute,
          adapterKind: request.adapterKind,
          executionMode: request.executionMode,
          authority: request.authority,
          capabilitySnapshot: admission.capabilitySnapshot,
          resultHandoff: {
            provenance: TEST_HANDOFF_PROVENANCE,
            summary: "Late child success.",
            resourceUris: ["kiln://artifacts/late-child/result"],
            memoryWriteProposalUris: [],
          },
        });
      }),
    };
    const surface = makeSurface(adapter);
    const session = makeSession();
    const parentAbort = new AbortController();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      abortSignal: parentAbort.signal,
      toolCall: {
        id: "tool-call-parent-abort",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const resultPromise = surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        access: "read-only",
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Inspect the managed invocation tool contract and report risks.",
        requestedAuthority: "read_only",
      },
      context,
    ) as Promise<{
      readonly isError: boolean;
      readonly metadata: {
        readonly status: string;
        readonly lifecycleState: string;
        readonly resultHandoff?: {
          readonly summary?: string;
        };
      };
    }>;

    await waitForCondition(() => adapterSignal !== undefined);
    parentAbort.abort("Parent runtime turn interrupted.");
    const result = await resultPromise;

    expect(adapterSignal?.aborted).toBe(true);
    expect(result.isError).toBe(true);
    expect(result.metadata.status).toBe("cancelled");
    expect(result.metadata.lifecycleState).toBe("cancelled");
    expect(result.metadata.resultHandoff?.summary).toBe("Parent runtime turn interrupted.");

    terminal.resolve(result.metadata as never);
    await flushMicrotasks();
  });

  it("cancels managed_agent.start through the parent runtime abort signal", async () => {
    const { adapter, terminal, signal } = makeAbortableDeferredAdapter();
    const invocationService = makeObservedRuntimeInvocationService({
      credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
        allowedRouteIds: ["credential-route:opencode-readonly"],
      }),
    });
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        invocationService,
        routes: [makeManagedRoute("opencode-readonly", "opencode-default-model", async () => adapter)],
      },
    });
    const session = makeSession();
    const parentAbort = new AbortController();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      abortSignal: parentAbort.signal,
      toolCall: {
        id: "tool-call-parent-abort-start",
        name: "managed_agent.start",
        input: {},
      },
    };

    const started = (await surface.callBuiltinTools.get("managed_agent.start")?.(
      {
        access: "read-only",
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Inspect the managed invocation tool contract and report risks.",
        requestedAuthority: "read_only",
      },
      context,
    )) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly invocationId: string;
        readonly lifecycleState: string;
      };
    };

    expect(started.isError).toBe(false);
    expect(started.metadata.lifecycleState).toBe("running");
    await waitForCondition(() => signal() !== undefined);
    parentAbort.abort("Parent runtime turn interrupted.");
    const joined = await invocationService.join(started.metadata.invocationId);
    if (joined.status !== "completed") {
      throw new Error("Expected the cancelled invocation to settle with a record.");
    }

    expect(signal()?.aborted).toBe(true);
    expect(joined.record.lifecycleState).toBe("cancelled");
    expect(joined.record.resultHandoff?.summary).toBe("Parent runtime turn interrupted.");

    terminal.resolve(joined.record);
    await flushMicrotasks();
    const joinedAfterLateOutput = await invocationService.join(started.metadata.invocationId);
    if (joinedAfterLateOutput.status !== "completed") {
      throw new Error("Expected the late-output invocation to retain its terminal record.");
    }
    expect(joinedAfterLateOutput.record.lifecycleState).toBe("cancelled");
    expect(joinedAfterLateOutput.record.resultHandoff?.summary).toBe("Parent runtime turn interrupted.");
  });

  it("disposes a surface-owned background child through adapter cleanup and publishes one terminal event", async () => {
    let adapterSignal: AbortSignal | undefined;
    const cleanup = vi.fn();
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ request, admission, abortSignal, registerAdapterCompletion }) => {
        adapterSignal = abortSignal;
        const executionSettlement = new Promise<void>((resolve) => {
          abortSignal.addEventListener(
            "abort",
            () => {
              cleanup();
              resolve();
            },
            { once: true },
          );
        });
        registerAdapterCompletion(executionSettlement);
        await executionSettlement;
        return defineManagedAgentInvocationRecord({
          invocationId: request.invocationId,
          agentId: request.agentId,
          parentSessionId: request.parentSessionId,
          parentTurnId: request.parentTurnId,
          access: request.access,
          lifecycleState: "cancelled",
          providerRoute: request.providerRoute,
          adapterKind: request.adapterKind,
          executionMode: request.executionMode,
          authority: request.authority,
          capabilitySnapshot: admission.capabilitySnapshot,
          resultHandoff: {
            provenance: TEST_HANDOFF_PROVENANCE,
            summary: "Adapter cleanup settled.",
            resourceUris: [],
            memoryWriteProposalUris: [],
          },
        });
      }),
    };
    const invocationService = makeObservedRuntimeInvocationService({
      credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
        allowedRouteIds: ["credential-route:opencode-readonly"],
      }),
    });
    const published: unknown[] = [];
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        invocationService,
        sessionEventSink: {
          publish: vi.fn(async (events) => {
            published.push(...events);
          }),
        },
        routes: [makeManagedRoute("opencode-readonly", "opencode-default-model", async () => adapter)],
      },
    });
    const session = makeSession();

    const started = (await surface.callBuiltinTools.get("managed_agent.start")?.(
      {
        access: "read-only",
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Inspect the managed invocation lifecycle.",
        requestedAuthority: "read_only",
      },
      {
        session,
        toolCall: {
          id: "tool-call-surface-dispose",
          name: "managed_agent.start",
          input: {},
        },
      },
    )) as { readonly metadata: { readonly invocationId: string } };

    await Promise.all([surface.dispose(), surface.dispose()]);
    await surface.dispose();

    expect(adapterSignal?.aborted).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(invocationService.status(started.metadata.invocationId)).toMatchObject({
      lifecycleState: "cancelled",
      record: {
        lifecycleState: "cancelled",
        resultHandoff: { summary: "Attached runtime tool surface disposed." },
      },
    });
    expect(
      published.filter((event) => (event as { kind?: string }).kind === "agent_invocation_cancelled"),
    ).toHaveLength(1);
  });

  it("shares fallback sandbox services across nonblocking lifecycle tools", async () => {
    const { adapter, terminal } = makeDeferredAdapter();
    const route = makeManagedRoute("opencode-sandbox", "opencode-default-model", async () => adapter);
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        invocationService: makeObservedRuntimeInvocationService({
          credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
            allowedRouteIds: ["credential-route:opencode-sandbox"],
          }),
          sandboxLeaseManager: new ManagedRuntimeSandboxLeaseManager(),
        }),
        routes: [
          {
            ...route,
            profiles: [
              {
                ...route.profiles[0]!,
                workingDirectory: {
                  path: "C:/workspace/kiln",
                  mode: "sandbox",
                },
              },
            ],
          },
        ],
      },
    });
    const session = makeSession();
    const startContext: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-sandbox-start",
        name: "managed_agent.start",
        input: {},
      },
    };

    const started = (await surface.callBuiltinTools.get("managed_agent.start")?.(
      {
        access: "read-only",
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Inspect the managed invocation tool contract from a sandbox route.",
        requestedAuthority: "read_only",
      },
      startContext,
    )) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly invocationId: string;
        readonly lifecycleState?: string;
      };
    };

    expect(started).toMatchObject({
      isError: false,
      metadata: {
        lifecycleState: "running",
      },
    });

    const status = (await surface.callBuiltinTools.get("managed_agent.status")?.(
      {
        invocationId: started.metadata.invocationId,
      },
      {
        ...startContext,
        toolCall: { id: "tool-call-sandbox-status", name: "managed_agent.status", input: {} },
      },
    )) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly lifecycleState?: string;
      };
    };
    expect(status).toMatchObject({
      isError: false,
      metadata: {
        lifecycleState: "running",
      },
    });

    const listed = (await surface.callBuiltinTools.get("managed_agent.list")?.(
      {},
      {
        ...startContext,
        toolCall: { id: "tool-call-sandbox-list", name: "managed_agent.list", input: {} },
      },
    )) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly count?: number;
        readonly invocations?: readonly { readonly invocationId?: string }[];
      };
    };
    expect(listed).toMatchObject({
      isError: false,
      metadata: {
        count: 1,
        invocations: [{ invocationId: started.metadata.invocationId }],
      },
    });

    const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      .request as ManagedAgentInvocationRequest;
    terminal.resolve(
      defineManagedAgentInvocationRecord({
        invocationId: request.invocationId,
        agentId: request.agentId,
        parentSessionId: request.parentSessionId,
        parentTurnId: request.parentTurnId,
        access: request.access,
        lifecycleState: "completed",
        providerRoute: request.providerRoute,
        adapterKind: request.adapterKind,
        executionMode: request.executionMode,
        authority: request.authority,
        capabilitySnapshot: buildManagedAgentCapabilitySnapshot(request, adapter.descriptor, {
          routeId: "opencode-sandbox",
          routeSource: "explicit-managed-route",
        }),
        resultHandoff: {
          provenance: TEST_HANDOFF_PROVENANCE,
          summary: "Child review completed.",
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/result`],
          memoryWriteProposalUris: [],
        },
      }),
    );
    await flushMicrotasks();

    const joined = (await surface.callBuiltinTools.get("managed_agent.join")?.(
      {
        invocationId: started.metadata.invocationId,
      },
      {
        ...startContext,
        toolCall: { id: "tool-call-sandbox-join", name: "managed_agent.join", input: {} },
      },
    )) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly lifecycleState?: string;
        readonly resourceLease?: {
          readonly resourceUris?: readonly string[];
          readonly diagnosticUris?: readonly string[];
        };
      };
    };
    expect(joined).toMatchObject({
      isError: false,
      metadata: {
        lifecycleState: "completed",
      },
    });
    expectPublicResourceLeaseMetadata(joined.metadata.resourceLease);
    expect(joined.metadata.resourceLease?.resourceUris).toContain(
      "kiln://artifacts/managed-session-parent-1-tool-call-sandbox-start/sandbox-policy",
    );
    expect(joined.metadata.resourceLease?.diagnosticUris).toContain(
      "kiln://artifacts/managed-session-parent-1-tool-call-sandbox-start/sandbox-policy-release",
    );
  });

  it("cancels fallback sandbox lifecycle invocations with lease cleanup evidence", async () => {
    const { adapter, terminal } = makeAbortableDeferredAdapter();
    const route = makeManagedRoute("opencode-sandbox", "opencode-default-model", async () => adapter);
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        invocationService: makeObservedRuntimeInvocationService({
          credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
            allowedRouteIds: ["credential-route:opencode-sandbox"],
          }),
          sandboxLeaseManager: new ManagedRuntimeSandboxLeaseManager(),
        }),
        routes: [
          {
            ...route,
            profiles: [
              {
                ...route.profiles[0]!,
                workingDirectory: {
                  path: "C:/workspace/kiln",
                  mode: "sandbox",
                },
              },
            ],
          },
        ],
      },
    });
    const session = makeSession();
    const startContext: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-sandbox-cancel-start",
        name: "managed_agent.start",
        input: {},
      },
    };
    const started = (await surface.callBuiltinTools.get("managed_agent.start")?.(
      {
        access: "read-only",
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Inspect the managed invocation tool contract from a cancellable sandbox route.",
        requestedAuthority: "read_only",
      },
      startContext,
    )) as {
      readonly metadata: {
        readonly invocationId: string;
      };
    };

    const cancelPromise = surface.callBuiltinTools.get("managed_agent.cancel")?.(
      {
        invocationId: started.metadata.invocationId,
        reason: "Operator cancelled fallback sandbox invocation.",
      },
      {
        ...startContext,
        toolCall: { id: "tool-call-sandbox-cancel", name: "managed_agent.cancel", input: {} },
      },
    ) as Promise<{
      readonly isError: boolean;
      readonly metadata: {
        readonly lifecycleState?: string;
        readonly resourceLease?: {
          readonly resourceUris?: readonly string[];
          readonly diagnosticUris?: readonly string[];
        };
      };
    }>;

    await flushMicrotasks();
    const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      .request as ManagedAgentInvocationRequest;
    terminal.resolve(
      defineManagedAgentInvocationRecord({
        invocationId: request.invocationId,
        agentId: request.agentId,
        parentSessionId: request.parentSessionId,
        parentTurnId: request.parentTurnId,
        access: request.access,
        lifecycleState: "completed",
        providerRoute: request.providerRoute,
        adapterKind: request.adapterKind,
        executionMode: request.executionMode,
        authority: request.authority,
        capabilitySnapshot: buildManagedAgentCapabilitySnapshot(request, adapter.descriptor, {
          routeId: "opencode-sandbox",
          routeSource: "explicit-managed-route",
        }),
        resultHandoff: {
          provenance: TEST_HANDOFF_PROVENANCE,
          summary: "Late sandbox output must be suppressed.",
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/late`],
          memoryWriteProposalUris: [],
        },
      }),
    );

    const cancelled = await cancelPromise;

    expect(cancelled).toMatchObject({
      isError: false,
      metadata: {
        lifecycleState: "cancelled",
      },
    });
    expectPublicResourceLeaseMetadata(cancelled.metadata.resourceLease);
    expect(cancelled.metadata.resourceLease?.resourceUris).toContain(
      "kiln://artifacts/managed-session-parent-1-tool-call-sandbox-cancel-start/sandbox-policy",
    );
    expect(cancelled.metadata.resourceLease?.diagnosticUris).toContain(
      "kiln://artifacts/managed-session-parent-1-tool-call-sandbox-cancel-start/sandbox-policy-release",
    );
  });

  it("materializes invocation-scoped isolated worktree paths before adapter execution", async () => {
    const worktreeLeaseManager: ManagedAgentWorktreeLeaseManager = {
      acquire: vi.fn(async ({ request, lease }) => ({
        ...lease,
        healthStatus: "healthy",
        cleanupStatus: "pending",
        resourceUris: [...lease.resourceUris, `kiln://artifacts/${request.invocationId}/worktree-lease`],
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released",
        cleanupStatus: "completed",
      })),
    };
    const adapter = makeAdapterWithHandoff("Approved write completed.", {
      supportedAccess: ["read-only", "approved-write"],
      writeAuthority: {
        proposalSupported: true,
        approvedApplySupported: true,
        memoryProposalSupported: false,
        rollbackEvidence: true,
        cleanupEvidence: true,
        scopeReduction: true,
      },
    });
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        invocationService: makeObservedRuntimeInvocationService({
          worktreeLeaseManager,
          credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
            allowedRouteIds: ["credential-route:opencode:primary"],
          }),
        }),
        routes: [
          {
            routeId: "opencode-approved-write",
            routeSource: "explicit-managed-route",
            providerId: "opencode",
            model: "opencode-default-model",
            capability: makeRouteCapability({
              routeId: "opencode-approved-write",
              providerId: "opencode",
              model: "opencode-default-model",
              profiles: ["approved-write"],
              toolNames: ["read", "grep", "apply-patch"],
              supportsWrite: true,
            }),
            createAdapter: async () => adapter,
            profiles: [
              {
                authorityProfileId: "authority:opencode:approved-write",
                access: "approved-write",
                allowedToolNames: ["read", "grep", "apply-patch"],
                writeAllowed: true,
                networkAllowed: false,
                workingDirectory: {
                  path: "C:/workspace/kiln/.kiln/managed-worktrees",
                  mode: "isolated-worktree",
                },
                workingDirectoryLease: {
                  mode: "git-worktree",
                  sourcePath: "C:/workspace/kiln",
                  rootPath: "C:/workspace/kiln/.kiln/managed-worktrees",
                },
                timeoutMs: 120000,
                credentialRoute: {
                  mode: "runtime-selected",
                  routeId: "credential-route:opencode:primary",
                },
                memoryScope: {
                  scope: { kind: "project", id: "kiln" },
                  access: "read-only",
                },
                writeAuthority: defineManagedAgentWriteAuthority({
                  scope: {
                    workspace: {
                      mode: "apply-approved",
                      allowedPaths: ["C:/workspace/kiln/packages/runtime/src"],
                      deniedPaths: ["C:/workspace/kiln/.git"],
                    },
                    memory: {
                      operations: [],
                    },
                    artifacts: {
                      mode: "none",
                      resourceUris: [],
                      retention: "none",
                    },
                    tools: {
                      allowedToolNames: ["apply-patch"],
                      deniedToolNames: [],
                    },
                  },
                  approval: {
                    mode: "required-before-apply",
                    evidenceRequired: true,
                  },
                }),
              },
            ],
          },
        ],
      },
      testEffectiveTurnAuthority: TEST_DESTRUCTIVE_PARENT_AUTHORITY,
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-write",
        name: "managed_agent.invoke",
        input: {},
      },
      requestApproval: vi.fn(async () => ({
        approved: true,
        reason: "operator approved managed write",
      })),
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        access: "approved-write",
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        requestedAuthority: "audited",
        task: "Apply the approved runtime edit.",
      },
      context,
    )) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly invocationId: string;
      };
    };

    expect(result.isError).toBe(false);
    const expectedPath = "C:\\workspace\\kiln\\.kiln\\managed-worktrees\\managed-session-parent-1-tool-call-write";
    expect(worktreeLeaseManager.acquire).toHaveBeenCalledWith(
      expect.objectContaining({
        lease: expect.objectContaining({
          workingDirectoryPath: expectedPath,
          workingDirectoryMode: "isolated-worktree",
        }),
      }),
    );
    expect(adapter.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          authority: expect.objectContaining({
            workingDirectory: {
              path: expectedPath,
              mode: "isolated-worktree",
            },
            writeAuthority: expect.objectContaining({
              scope: expect.objectContaining({
                workspace: expect.objectContaining({
                  allowedPaths: [
                    "C:/workspace/kiln/.kiln/managed-worktrees/managed-session-parent-1-tool-call-write/packages/runtime/src",
                  ],
                  deniedPaths: [
                    "C:/workspace/kiln/.kiln/managed-worktrees/managed-session-parent-1-tool-call-write/.git",
                  ],
                }),
              }),
            }),
          }),
        }),
      }),
    );
    expect(worktreeLeaseManager.release).toHaveBeenCalledTimes(1);
  });

  it("persists terminal start failure when side-effected lease acquisition fails before adapter execution", async () => {
    const worktreeLeaseManager: ManagedAgentWorktreeLeaseManager = {
      acquire: vi.fn(async () => {
        throw new ManagedAgentLeaseAcquireError("Managed git worktree acquire failed after checkout.", true);
      }),
      release: vi.fn(async ({ request, lease }) => ({
        ...lease,
        healthStatus: "released",
        cleanupStatus: "completed",
        diagnosticUris: [...lease.diagnosticUris, `kiln://artifacts/${request.invocationId}/worktree-release`],
      })),
    };
    const adapter = makeAdapterWithHandoff("Approved write completed.", {
      supportedAccess: ["read-only", "approved-write"],
      writeAuthority: {
        proposalSupported: true,
        approvedApplySupported: true,
        memoryProposalSupported: false,
        rollbackEvidence: true,
        cleanupEvidence: true,
        scopeReduction: true,
      },
    });
    const sessionEventSink = { publish: vi.fn() };
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        sessionEventSink,
        invocationService: makeObservedRuntimeInvocationService({
          worktreeLeaseManager,
        }),
        routes: [
          {
            routeId: "opencode-approved-write",
            routeSource: "explicit-managed-route",
            providerId: "opencode",
            model: "opencode-default-model",
            capability: makeRouteCapability({
              routeId: "opencode-approved-write",
              providerId: "opencode",
              model: "opencode-default-model",
              profiles: ["approved-write"],
              toolNames: ["read", "grep", "apply-patch"],
              supportsWrite: true,
            }),
            createAdapter: async () => adapter,
            profiles: [
              {
                authorityProfileId: "authority:opencode:approved-write",
                access: "approved-write",
                allowedToolNames: ["read", "grep", "apply-patch"],
                writeAllowed: true,
                networkAllowed: false,
                workingDirectory: {
                  path: "C:/workspace/kiln/.kiln/managed-worktrees",
                  mode: "isolated-worktree",
                },
                workingDirectoryLease: {
                  mode: "git-worktree",
                  sourcePath: "C:/workspace/kiln",
                  rootPath: "C:/workspace/kiln/.kiln/managed-worktrees",
                },
                timeoutMs: 120000,
                credentialRoute: {
                  mode: "credentialless",
                },
                memoryScope: {
                  scope: { kind: "project", id: "kiln" },
                  access: "read-only",
                },
                writeAuthority: defineManagedAgentWriteAuthority({
                  scope: {
                    workspace: {
                      mode: "apply-approved",
                      allowedPaths: ["C:/workspace/kiln/packages/runtime/src"],
                      deniedPaths: ["C:/workspace/kiln/.git"],
                    },
                    memory: {
                      operations: [],
                    },
                    artifacts: {
                      mode: "none",
                      resourceUris: [],
                      retention: "none",
                    },
                    tools: {
                      allowedToolNames: ["apply-patch"],
                      deniedToolNames: [],
                    },
                  },
                  approval: {
                    mode: "required-before-apply",
                    evidenceRequired: true,
                  },
                }),
              },
            ],
          },
        ],
      },
      testEffectiveTurnAuthority: TEST_DESTRUCTIVE_PARENT_AUTHORITY,
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-start-acquire-failure",
        name: "managed_agent.start",
        input: {},
      },
      requestApproval: vi.fn(async () => ({
        approved: true,
        reason: "operator approved managed write",
      })),
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.start")?.(
      {
        access: "approved-write",
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        requestedAuthority: "audited",
        task: "Apply the approved runtime edit.",
      },
      context,
    )) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly invocationId: string;
        readonly lifecycleState?: string;
        readonly sessionEventIds?: readonly string[];
      };
    };

    expect(result.isError).toBe(true);
    expect(result.metadata.lifecycleState).toBe("failed");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(worktreeLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_failed",
    ]);
    expect(result.metadata.sessionEventIds).toEqual(session.sessionEvents.map((event) => event.eventId));
    expect(session.sessionEvents[2]).toMatchObject({
      kind: "agent_invocation_failed",
      invocationId: result.metadata.invocationId,
      managedInvocationEvidence: {
        resultHandoff: {
          summary: "Managed git worktree acquire failed after checkout.",
        },
      },
    });
    expect(sessionEventSink.publish).toHaveBeenCalledTimes(2);
    expect(sessionEventSink.publish).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({
          kind: "agent_invocation_failed",
          invocationId: result.metadata.invocationId,
        }),
      ],
      expect.objectContaining(context),
    );
  });

  it("preserves dirty-worktree review evidence in managed-agent join metadata", async () => {
    const worktreeLeaseManager: ManagedAgentWorktreeLeaseManager = {
      acquire: vi.fn(async ({ request, lease }) => ({
        ...lease,
        healthStatus: "healthy",
        cleanupStatus: "pending",
        resourceUris: [...lease.resourceUris, `kiln://artifacts/${request.invocationId}/worktree-lease`],
      })),
      release: vi.fn(async () => {
        throw new ManagedAgentWorktreeReviewRequiredError(
          "Managed git worktree lease is dirty; preserving worktree for review",
        );
      }),
    };
    const adapter = makeAdapterWithHandoff("Approved write completed.", {
      supportedAccess: ["read-only", "approved-write"],
      writeAuthority: {
        proposalSupported: true,
        approvedApplySupported: true,
        memoryProposalSupported: false,
        rollbackEvidence: true,
        cleanupEvidence: true,
        scopeReduction: true,
      },
    });
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        invocationService: makeObservedRuntimeInvocationService({
          worktreeLeaseManager,
          credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
            allowedRouteIds: ["credential-route:opencode:primary"],
          }),
        }),
        routes: [
          {
            routeId: "opencode-approved-write",
            routeSource: "explicit-managed-route",
            providerId: "opencode",
            model: "opencode-default-model",
            capability: makeRouteCapability({
              routeId: "opencode-approved-write",
              providerId: "opencode",
              model: "opencode-default-model",
              profiles: ["approved-write"],
              toolNames: ["read", "grep", "apply-patch"],
              supportsWrite: true,
            }),
            createAdapter: async () => adapter,
            profiles: [
              {
                authorityProfileId: "authority:opencode:approved-write",
                access: "approved-write",
                allowedToolNames: ["read", "grep", "apply-patch"],
                writeAllowed: true,
                networkAllowed: false,
                workingDirectory: {
                  path: "C:/workspace/kiln/.kiln/managed-worktrees",
                  mode: "isolated-worktree",
                },
                workingDirectoryLease: {
                  mode: "git-worktree",
                  sourcePath: "C:/workspace/kiln",
                  rootPath: "C:/workspace/kiln/.kiln/managed-worktrees",
                },
                timeoutMs: 120000,
                credentialRoute: {
                  mode: "runtime-selected",
                  routeId: "credential-route:opencode:primary",
                },
                memoryScope: {
                  scope: { kind: "project", id: "kiln" },
                  access: "read-only",
                },
                writeAuthority: defineManagedAgentWriteAuthority({
                  scope: {
                    workspace: {
                      mode: "apply-approved",
                      allowedPaths: ["C:/workspace/kiln/packages/runtime/src"],
                      deniedPaths: ["C:/workspace/kiln/.git"],
                    },
                    memory: {
                      operations: [],
                    },
                    artifacts: {
                      mode: "none",
                      resourceUris: [],
                      retention: "none",
                    },
                    tools: {
                      allowedToolNames: ["apply-patch"],
                      deniedToolNames: [],
                    },
                  },
                  approval: {
                    mode: "required-before-apply",
                    evidenceRequired: true,
                  },
                }),
              },
            ],
          },
        ],
      },
      testEffectiveTurnAuthority: TEST_DESTRUCTIVE_PARENT_AUTHORITY,
    });
    const session = makeSession();
    const startInput = {
      access: "approved-write" as const,
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      requestedAuthority: "audited",
      task: "Apply the approved runtime edit.",
    };

    const started = (await surface.callBuiltinTools.get("managed_agent.start")?.(startInput, {
      session,
      toolCall: {
        id: "tool-call-dirty-worktree-start",
        name: "managed_agent.start",
        input: startInput,
      },
      requestApproval: vi.fn(async () => ({
        approved: true,
        reason: "operator approved managed write",
      })),
    })) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly invocationId: string;
      };
    };
    const joined = (await surface.callBuiltinTools.get("managed_agent.join")?.(
      {
        invocationId: started.metadata.invocationId,
      },
      {
        session,
        toolCall: {
          id: "tool-call-dirty-worktree-join",
          name: "managed_agent.join",
          input: {},
        },
      },
    )) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly lifecycleState?: string;
        readonly resourceLease?: {
          readonly healthStatus?: string;
          readonly cleanupStatus?: string;
          readonly resourceUris?: readonly string[];
          readonly diagnosticUris?: readonly string[];
          readonly worktreeReview?: {
            readonly status?: string;
            readonly reason?: string;
            readonly resourceUris?: readonly string[];
            readonly diagnosticUris?: readonly string[];
          };
        };
        readonly sessionEventIds?: readonly string[];
      };
    };

    expect(started.isError).toBe(false);
    expect(joined.isError).toBe(false);
    expect(joined.metadata.lifecycleState).toBe("completed");
    expect(joined.metadata.resourceLease).toMatchObject({
      healthStatus: "leaked",
      cleanupStatus: "failed",
      worktreeReview: {
        status: "required",
        reason: "dirty-worktree-preserved",
        resourceUris: [`kiln://artifacts/${started.metadata.invocationId}/worktree-review`],
        diagnosticUris: [`kiln://artifacts/${started.metadata.invocationId}/worktree-review-required`],
      },
    });
    expect(joined.metadata.resourceLease?.resourceUris).toContain(
      `kiln://artifacts/${started.metadata.invocationId}/worktree-lease`,
    );
    expect(joined.metadata.resourceLease?.diagnosticUris).toEqual(
      expect.arrayContaining([
        `kiln://artifacts/${started.metadata.invocationId}/worktree-lease-cleanup-failed`,
        `kiln://artifacts/${started.metadata.invocationId}/worktree-review-required`,
      ]),
    );
    expect(joined.metadata.sessionEventIds).toEqual([session.sessionEvents[2]?.eventId]);
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_completed",
    ]);
    expect(worktreeLeaseManager.release).toHaveBeenCalledTimes(1);
  });

  it("scopes nonblocking managed child lifecycle observation to the owning runtime session", async () => {
    const { adapter } = makeDeferredAdapter();
    const surface = makeSurface(adapter);
    const ownerSession = makeSession("session-owner");
    const otherSession = makeSession("session-other");
    const ownerContext: RuntimeBuiltinToolExecutionContext = {
      session: ownerSession,
      toolCall: {
        id: "tool-call-owner",
        name: "managed_agent.start",
        input: {},
      },
    };
    const otherContext: RuntimeBuiltinToolExecutionContext = {
      session: otherSession,
      toolCall: {
        id: "tool-call-other",
        name: "managed_agent.status",
        input: {},
      },
    };

    const started = (await surface.callBuiltinTools.get("managed_agent.start")?.(
      {
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Inspect the managed invocation tool contract and report risks.",
        requestedAuthority: "read_only",
      },
      ownerContext,
    )) as {
      readonly metadata: {
        readonly invocationId: string;
      };
    };

    const crossSessionStatus = (await surface.callBuiltinTools.get("managed_agent.status")?.(
      {
        invocationId: started.metadata.invocationId,
      },
      otherContext,
    )) as {
      readonly isError: boolean;
      readonly output: string;
      readonly metadata: {
        readonly status?: string;
      };
    };
    expect(crossSessionStatus).toMatchObject({
      isError: true,
      output: expect.stringContaining("not registered for this runtime session"),
      metadata: {
        status: "not_found",
      },
    });

    const crossSessionList = (await surface.callBuiltinTools.get("managed_agent.list")?.(
      {},
      {
        ...otherContext,
        toolCall: { id: "tool-call-other-list", name: "managed_agent.list", input: {} },
      },
    )) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly count?: number;
        readonly invocations?: readonly unknown[];
      };
    };
    expect(crossSessionList).toMatchObject({
      isError: false,
      metadata: {
        count: 0,
        invocations: [],
      },
    });

    const crossSessionJoin = (await surface.callBuiltinTools.get("managed_agent.join")?.(
      {
        invocationId: started.metadata.invocationId,
      },
      {
        ...otherContext,
        toolCall: { id: "tool-call-other-join", name: "managed_agent.join", input: {} },
      },
    )) as {
      readonly isError: boolean;
      readonly output: string;
      readonly metadata: {
        readonly status?: string;
      };
    };
    expect(crossSessionJoin).toMatchObject({
      isError: true,
      output: expect.stringContaining("not registered for this runtime session"),
      metadata: {
        status: "not_found",
      },
    });
    expect(otherSession.sessionEvents).toEqual([]);
  });

  it("persists canonical terminal completion when a background managed child finishes without join or cancel", async () => {
    const { adapter, terminal } = makeDeferredAdapter();
    const sessionEventSink = { publish: vi.fn() };
    const surface = makeSurface(adapter, sessionEventSink);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-background-complete",
        name: "managed_agent.start",
        input: {},
      },
    };

    const started = (await surface.callBuiltinTools.get("managed_agent.start")?.(
      {
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Inspect the managed invocation tool contract and report risks.",
        requestedAuthority: "read_only",
      },
      context,
    )) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly invocationId: string;
      };
    };
    expect(started.isError).toBe(false);

    const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      .request as ManagedAgentInvocationRequest;
    terminal.resolve(
      defineManagedAgentInvocationRecord({
        invocationId: request.invocationId,
        agentId: request.agentId,
        parentSessionId: request.parentSessionId,
        parentTurnId: request.parentTurnId,
        access: request.access,
        lifecycleState: "completed",
        providerRoute: request.providerRoute,
        adapterKind: request.adapterKind,
        executionMode: request.executionMode,
        authority: request.authority,
        capabilitySnapshot: buildManagedAgentCapabilitySnapshot(request, adapter.descriptor, {
          routeId: "opencode-readonly",
          routeSource: "explicit-managed-route",
        }),
        childSessionId: `${request.parentSessionId}:managed:${request.invocationId}`,
        childTurnId: `${request.parentSessionId}:managed:${request.invocationId}:turn:1`,
        resultHandoff: {
          provenance: TEST_HANDOFF_PROVENANCE,
          summary: "Child review completed before parent joined.",
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/result`],
          memoryWriteProposalUris: [],
        },
      }),
    );
    await waitForCondition(() => session.sessionEvents.some((event) => event.kind === "agent_invocation_completed"));

    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_completed",
    ]);
    expect(session.sessionEvents[2]).toMatchObject({
      kind: "agent_invocation_completed",
      invocationId: started.metadata.invocationId,
      managedInvocationEvidence: {
        childSessionId: `${session.id}:managed:${started.metadata.invocationId}`,
        childTurnId: `${session.id}:managed:${started.metadata.invocationId}:turn:1`,
        resultHandoff: {
          summary: "Child review completed before parent joined.",
          resourceUris: [`kiln://managed-agents/invocations/${started.metadata.invocationId}/resources/result`],
        },
      },
    });
    expect(sessionEventSink.publish).toHaveBeenCalledTimes(2);
    expect(sessionEventSink.publish).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({
          kind: "agent_invocation_completed",
          invocationId: started.metadata.invocationId,
        }),
      ],
      expect.objectContaining({
        toolCall: expect.objectContaining({ name: "managed_agent.start" }),
      }),
    );
  });

  it("publishes terminal failure evidence when a background managed child rejects before join", async () => {
    const { adapter, terminal } = makeRejectingDeferredAdapter();
    const sessionEventSink = { publish: vi.fn() };
    const surface = makeSurface(adapter, sessionEventSink);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-rejecting",
        name: "managed_agent.start",
        input: {},
      },
    };

    const started = (await surface.callBuiltinTools.get("managed_agent.start")?.(
      {
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Inspect the managed invocation tool contract and report risks.",
        requestedAuthority: "read_only",
      },
      context,
    )) as {
      readonly metadata: {
        readonly invocationId: string;
      };
    };

    terminal.resolve();
    await flushMicrotasks();
    await vi.waitFor(() =>
      expect(sessionEventSink.publish).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            kind: "agent_invocation_failed",
            errorCode: "ENGINE_FAILURE",
            errorMessage: "child runtime crashed",
          }),
        ],
        expect.objectContaining({
          toolCall: expect.objectContaining({ name: "managed_agent.start" }),
        }),
      ),
    );

    const joined = (await surface.callBuiltinTools.get("managed_agent.join")?.(
      {
        invocationId: started.metadata.invocationId,
      },
      {
        ...context,
        toolCall: { id: "tool-call-rejecting-join", name: "managed_agent.join", input: {} },
      },
    )) as {
      readonly isError: boolean;
      readonly output: string;
      readonly metadata: {
        readonly status?: string;
        readonly lifecycleState?: string;
        readonly sessionEventIds?: readonly string[];
      };
    };

    expect(joined).toMatchObject({
      isError: true,
      output: expect.stringContaining("child runtime crashed"),
      metadata: {
        status: "failed",
        lifecycleState: "failed",
      },
    });
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_failed",
    ]);
    expect(joined.metadata.sessionEventIds).toEqual([session.sessionEvents[2]?.eventId]);
  });

  it("publishes exactly one terminal event when background handoff validation fails", async () => {
    const adapter = makeAdapterWithHandoff(
      "Review returned without the required verification evidence.",
      {},
      { verificationResults: [] },
    );
    const sessionEventSink = { publish: vi.fn() };
    const surface = makeSurface(adapter, sessionEventSink);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-invalid-handoff",
        name: "managed_agent.start",
        input: {},
      },
    };

    const started = (await surface.callBuiltinTools.get("managed_agent.start")?.(
      {
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Inspect the managed invocation tool contract and report risks.",
        requestedAuthority: "read_only",
        requiredResultFields: ["verificationResults"],
      },
      context,
    )) as {
      readonly metadata: { readonly invocationId: string };
    };

    await waitForCondition(() => session.sessionEvents.some((event) => event.kind === "agent_invocation_failed"));
    const terminalEvents = () =>
      session.sessionEvents.filter(
        (event) =>
          event.kind === "agent_invocation_completed" ||
          event.kind === "agent_invocation_failed" ||
          event.kind === "agent_invocation_cancelled",
      );

    expect(terminalEvents()).toHaveLength(1);
    expect(terminalEvents()[0]).toMatchObject({
      kind: "agent_invocation_failed",
      invocationId: started.metadata.invocationId,
      errorMessage: expect.stringContaining("missing required structured fields: verificationResults"),
    });
    expect(sessionEventSink.publish).toHaveBeenCalledTimes(2);

    const joined = (await surface.callBuiltinTools.get("managed_agent.join")?.(
      {
        invocationId: started.metadata.invocationId,
      },
      {
        ...context,
        toolCall: { id: "tool-call-invalid-handoff-join", name: "managed_agent.join", input: {} },
      },
    )) as { readonly isError: boolean };

    expect(joined.isError).toBe(true);
    expect(terminalEvents()).toHaveLength(1);
    expect(sessionEventSink.publish).toHaveBeenCalledTimes(2);
  });

  it("publishes and returns the canonical terminal failure when foreground handoff validation fails", async () => {
    const adapter = makeAdapterWithHandoff(
      "Review returned without the required verification evidence.",
      {},
      { verificationResults: [] },
    );
    const sessionEventSink = { publish: vi.fn() };
    const surface = makeSurface(adapter, sessionEventSink);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-invalid-foreground-handoff",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Inspect the managed invocation tool contract and report risks.",
        requestedAuthority: "read_only",
        requiredResultFields: ["verificationResults"],
      },
      context,
    )) as {
      readonly isError: boolean;
      readonly metadata: { readonly invocationId: string; readonly lifecycleState: string };
    };

    const terminalEvents = session.sessionEvents.filter(
      (event) =>
        event.kind === "agent_invocation_completed" ||
        event.kind === "agent_invocation_failed" ||
        event.kind === "agent_invocation_cancelled",
    );
    expect(result).toMatchObject({
      isError: true,
      metadata: { lifecycleState: "failed" },
    });
    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0]).toMatchObject({
      kind: "agent_invocation_failed",
      invocationId: result.metadata.invocationId,
      errorMessage: expect.stringContaining("missing required structured fields: verificationResults"),
    });
    expect(sessionEventSink.publish).toHaveBeenCalledTimes(2);
  });

  it("records nonblocking terminal duration from child runtime time instead of join wait time", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-21T00:00:00.000Z") });
    try {
      const { adapter, terminal } = makeDeferredAdapter();
      const surface = makeSurface(adapter);
      const session = makeSession();
      const context: RuntimeBuiltinToolExecutionContext = {
        session,
        toolCall: {
          id: "tool-call-duration",
          name: "managed_agent.start",
          input: {},
        },
      };

      const started = (await surface.callBuiltinTools.get("managed_agent.start")?.(
        {
          providerRoute: {
            providerId: "opencode",
            model: "opencode-default-model",
          },
          task: "Inspect the managed invocation tool contract and report risks.",
          requestedAuthority: "read_only",
        },
        context,
      )) as {
        readonly metadata: {
          readonly invocationId: string;
        };
      };
      const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
        .request as ManagedAgentInvocationRequest;

      vi.useFakeTimers({ now: new Date("2026-05-21T00:00:01.234Z") });
      terminal.resolve(
        defineManagedAgentInvocationRecord({
          invocationId: request.invocationId,
          agentId: request.agentId,
          parentSessionId: request.parentSessionId,
          parentTurnId: request.parentTurnId,
          access: request.access,
          lifecycleState: "completed",
          providerRoute: request.providerRoute,
          adapterKind: request.adapterKind,
          executionMode: request.executionMode,
          authority: request.authority,
          capabilitySnapshot: buildManagedAgentCapabilitySnapshot(request, adapter.descriptor, {
            routeId: "opencode-readonly",
            routeSource: "explicit-managed-route",
          }),
          resultHandoff: {
            provenance: TEST_HANDOFF_PROVENANCE,
            summary: "Child review completed.",
            resourceUris: [`kiln://managed-invocations/${request.invocationId}/result`],
            memoryWriteProposalUris: [],
          },
        }),
      );
      await flushMicrotasks();

      vi.useFakeTimers({ now: new Date("2026-05-21T00:00:06.234Z") });
      await surface.callBuiltinTools.get("managed_agent.join")?.(
        {
          invocationId: started.metadata.invocationId,
        },
        {
          ...context,
          toolCall: { id: "tool-call-duration-join", name: "managed_agent.join", input: {} },
        },
      );

      expect(session.sessionEvents[2]).toMatchObject({
        kind: "agent_invocation_completed",
        durationMs: 1234,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a nonblocking managed child with terminal evidence and late-output suppression", async () => {
    const { adapter, terminal, signal } = makeAbortableDeferredAdapter();
    const sessionEventSink = { publish: vi.fn() };
    const surface = makeSurface(adapter, sessionEventSink);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-cancel-start",
        name: "managed_agent.start",
        input: {},
      },
    };

    const started = (await surface.callBuiltinTools.get("managed_agent.start")?.(
      {
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Inspect the managed invocation tool contract and report risks.",
        requestedAuthority: "read_only",
      },
      context,
    )) as {
      readonly metadata: {
        readonly invocationId: string;
      };
    };

    expect(signal()).toBeInstanceOf(AbortSignal);
    expect(signal()?.aborted).toBe(false);

    const cancelledPromise = surface.callBuiltinTools.get("managed_agent.cancel")?.(
      {
        invocationId: started.metadata.invocationId,
        reason: "Operator cancelled the managed child.",
      },
      {
        ...context,
        toolCall: { id: "tool-call-cancel", name: "managed_agent.cancel", input: {} },
      },
    ) as Promise<{
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly lifecycleState?: string;
        readonly sessionEventIds?: readonly string[];
      };
    }>;

    await flushMicrotasks();
    expect(signal()?.aborted).toBe(true);

    const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      .request as ManagedAgentInvocationRequest;
    terminal.resolve(
      defineManagedAgentInvocationRecord({
        invocationId: request.invocationId,
        agentId: request.agentId,
        parentSessionId: request.parentSessionId,
        parentTurnId: request.parentTurnId,
        access: request.access,
        lifecycleState: "completed",
        providerRoute: request.providerRoute,
        adapterKind: request.adapterKind,
        executionMode: request.executionMode,
        authority: request.authority,
        capabilitySnapshot: buildManagedAgentCapabilitySnapshot(request, adapter.descriptor, {
          routeId: "opencode-readonly",
          routeSource: "explicit-managed-route",
        }),
        resultHandoff: {
          provenance: TEST_HANDOFF_PROVENANCE,
          summary: "Late child output must be ignored.",
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/late`],
          memoryWriteProposalUris: [],
        },
      }),
    );
    const cancelled = await cancelledPromise;

    expect(cancelled).toMatchObject({
      output: expect.stringContaining("Operator cancelled the managed child."),
      isError: false,
      metadata: {
        status: "cancelled",
        lifecycleState: "cancelled",
      },
    });
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_cancelled",
    ]);
    expect(session.sessionEvents[2]).toMatchObject({
      kind: "agent_invocation_cancelled",
      reason: "Operator cancelled the managed child.",
    });
    expect(cancelled.metadata.sessionEventIds).toEqual([session.sessionEvents[2]?.eventId]);

    const joined = (await surface.callBuiltinTools.get("managed_agent.join")?.(
      {
        invocationId: started.metadata.invocationId,
      },
      {
        ...context,
        toolCall: { id: "tool-call-cancel-join", name: "managed_agent.join", input: {} },
      },
    )) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly lifecycleState?: string;
      };
    };
    expect(joined.output).toContain("Operator cancelled the managed child.");
    expect(joined.output).not.toContain("Late child output must be ignored.");
    expect(joined.isError).toBe(false);
    expect(joined.metadata.status).toBe("cancelled");
    expect(joined.metadata.lifecycleState).toBe("cancelled");
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_cancelled",
    ]);
  });

  it.each(["timed_out", "failed", "stale"] as const)(
    "joins a terminal %s managed child as successful lifecycle observation",
    async (lifecycleState: ManagedAgentLifecycleState) => {
      const { adapter, terminal } = makeDeferredAdapter();
      const surface = makeSurface(adapter);
      const session = makeSession();
      const context: RuntimeBuiltinToolExecutionContext = {
        session,
        toolCall: {
          id: `tool-call-${lifecycleState}-start`,
          name: "managed_agent.start",
          input: {},
        },
      };

      const started = (await surface.callBuiltinTools.get("managed_agent.start")?.(
        {
          providerRoute: {
            providerId: "opencode",
            model: "opencode-default-model",
          },
          task: `Inspect ${lifecycleState} terminal evidence.`,
          requestedAuthority: "read_only",
        },
        context,
      )) as {
        readonly metadata: {
          readonly invocationId: string;
        };
      };
      const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
        .request as ManagedAgentInvocationRequest;
      const diagnosticKind = lifecycleState === "timed_out" ? "timeout" : "failure";
      const terminalRecord = defineManagedAgentInvocationRecord({
        invocationId: request.invocationId,
        agentId: request.agentId,
        parentSessionId: request.parentSessionId,
        parentTurnId: request.parentTurnId,
        access: request.access,
        lifecycleState,
        providerRoute: request.providerRoute,
        adapterKind: request.adapterKind,
        executionMode: request.executionMode,
        authority: request.authority,
        capabilitySnapshot: buildManagedAgentCapabilitySnapshot(request, adapter.descriptor, {
          routeId: "opencode-readonly",
          routeSource: "explicit-managed-route",
        }),
        childSessionId: `${request.parentSessionId}:managed:${request.invocationId}`,
        childTurnId: `${request.parentSessionId}:managed:${request.invocationId}:turn:1`,
        transcript: {
          uri: `kiln://managed-invocations/${request.invocationId}/transcript`,
          redacted: "unknown",
          truncated: false,
          persisted: true,
          retention: "session",
        },
        diagnostics: [
          {
            uri: `kiln://managed-invocations/${request.invocationId}/${diagnosticKind}`,
            kind: diagnosticKind,
          },
        ],
      });
      expect(terminalRecord.resourceLease).toBeUndefined();
      terminal.resolve(terminalRecord);
      await flushMicrotasks();

      const joined = (await surface.callBuiltinTools.get("managed_agent.join")?.(
        {
          invocationId: started.metadata.invocationId,
        },
        {
          ...context,
          toolCall: { id: `tool-call-${lifecycleState}-join`, name: "managed_agent.join", input: {} },
        },
      )) as {
        readonly output: string;
        readonly isError: boolean;
        readonly metadata: {
          readonly status?: string;
          readonly lifecycleState?: string;
          readonly routeSource?: string;
          readonly parentTurnId?: string;
          readonly resourceLease?: {
            readonly leaseId?: string;
          };
        };
      };

      expect(joined.isError).toBe(false);
      expect(joined.metadata.status).toBe(lifecycleState);
      expect(joined.metadata.lifecycleState).toBe(lifecycleState);
      expect(joined.metadata.routeSource).toBe("explicit-managed-route");
      expect(joined.metadata.parentTurnId).toBe(`${session.id}:turn:1`);
      expect(joined.metadata.resourceLease?.leaseId).toBe(`${request.invocationId}:resource-lease`);
      expect(joined.output).toContain(`"status": "${lifecycleState}"`);
      expect(joined.output).toContain('"routeSource": "explicit-managed-route"');
      expect(joined.output).toContain(`"parentTurnId": "${session.id}:turn:1"`);
      expect(joined.output).toContain('"resourceLease"');
      expect(joined.output).toContain(`${request.invocationId}:resource-lease`);
      expect(joined.output).toContain(`kiln://managed-agents/invocations/${request.invocationId}/transcript`);
      expect(joined.output).toContain(
        `kiln://managed-agents/invocations/${request.invocationId}/resources/${diagnosticKind}`,
      );
    },
  );

  it("returns managed_agent.cancel terminal evidence when the aborted adapter stays pending", async () => {
    const { adapter, signal } = makeAbortableDeferredAdapter();
    const sessionEventSink = { publish: vi.fn() };
    const surface = makeSurface(adapter, sessionEventSink);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-cancel-pending-start",
        name: "managed_agent.start",
        input: {},
      },
    };

    const started = (await surface.callBuiltinTools.get("managed_agent.start")?.(
      {
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Inspect cancellation behavior.",
        requestedAuthority: "read_only",
      },
      context,
    )) as {
      readonly metadata: {
        readonly invocationId: string;
      };
    };

    expect(signal()?.aborted).toBe(false);

    const cancelledPromise = surface.callBuiltinTools.get("managed_agent.cancel")?.(
      {
        invocationId: started.metadata.invocationId,
        reason: "Operator cancelled pending adapter output.",
      },
      {
        ...context,
        toolCall: { id: "tool-call-cancel-pending", name: "managed_agent.cancel", input: {} },
      },
    ) as Promise<{
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly lifecycleState?: string;
        readonly sessionEventIds?: readonly string[];
      };
    }>;

    await flushMicrotasks();
    const cancelState = await Promise.race([
      cancelledPromise.then((result) => result.metadata.lifecycleState),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 0)),
    ]);

    expect(signal()?.aborted).toBe(true);
    expect(cancelState).toBe("cancelled");
    const cancelled = await cancelledPromise;
    expect(cancelled).toMatchObject({
      output: expect.stringContaining("Operator cancelled pending adapter output."),
      isError: false,
      metadata: {
        lifecycleState: "cancelled",
      },
    });
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_cancelled",
    ]);
    expect(cancelled.metadata.sessionEventIds).toEqual([session.sessionEvents[2]?.eventId]);
  });

  it("keeps managed child lineage and route provenance when cancel join fails", async () => {
    const { adapter, terminal } = makeAbortableDeferredAdapter();
    const invocationService = makeObservedRuntimeInvocationService({
      credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
        allowedRouteIds: ["credential-route:opencode-readonly"],
      }),
    });
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        invocationService,
        routes: [makeManagedRoute("opencode-readonly", "opencode-default-model", async () => adapter)],
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-cancel-failure-start",
        name: "managed_agent.start",
        input: {},
      },
    };

    const started = (await surface.callBuiltinTools.get("managed_agent.start")?.(
      {
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Inspect cancel failure provenance.",
        requestedAuthority: "read_only",
      },
      context,
    )) as {
      readonly metadata: {
        readonly invocationId: string;
      };
    };
    const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      .request as ManagedAgentInvocationRequest;
    const joinSpy = vi.spyOn(invocationService, "join").mockRejectedValueOnce(new Error("join store unavailable"));

    const cancelled = (await surface.callBuiltinTools.get("managed_agent.cancel")?.(
      {
        invocationId: started.metadata.invocationId,
        reason: "Operator cancelled before join failed.",
      },
      {
        ...context,
        toolCall: { id: "tool-call-cancel-failure", name: "managed_agent.cancel", input: {} },
      },
    )) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly invocationId?: string;
        readonly routeId?: string;
        readonly routeSource?: string;
        readonly parentSessionId?: string;
        readonly parentTurnId?: string;
        readonly status?: string;
        readonly lifecycleState?: string;
      };
    };

    expect(cancelled.isError).toBe(true);
    expect(cancelled.output).toContain("Managed invocation cancel failed: join store unavailable");
    expect(cancelled.metadata).toMatchObject({
      invocationId: started.metadata.invocationId,
      routeId: "opencode-readonly",
      routeSource: "explicit-managed-route",
      parentSessionId: session.id,
      parentTurnId: `${session.id}:turn:1`,
      status: "cancelled",
      lifecycleState: "cancelled",
    });

    joinSpy.mockRestore();
    terminal.resolve(
      defineManagedAgentInvocationRecord({
        invocationId: request.invocationId,
        agentId: request.agentId,
        parentSessionId: request.parentSessionId,
        parentTurnId: request.parentTurnId,
        access: request.access,
        lifecycleState: "completed",
        providerRoute: request.providerRoute,
        adapterKind: request.adapterKind,
        executionMode: request.executionMode,
        authority: request.authority,
        capabilitySnapshot: buildManagedAgentCapabilitySnapshot(request, adapter.descriptor, {
          routeId: "opencode-readonly",
          routeSource: "explicit-managed-route",
        }),
        resultHandoff: {
          provenance: TEST_HANDOFF_PROVENANCE,
          summary: "Late child output must be ignored.",
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/late`],
          memoryWriteProposalUris: [],
        },
      }),
    );
    await flushMicrotasks();
  });

  it("publishes runtime cancellation evidence before late adapter cleanup evidence", async () => {
    const { adapter, terminal, signal } = makeAbortableDeferredAdapter();
    const surface = makeSurface(adapter);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-cancel-evidence-start",
        name: "managed_agent.start",
        input: {},
      },
    };

    const started = (await surface.callBuiltinTools.get("managed_agent.start")?.(
      {
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Inspect cancellation evidence propagation.",
        requestedAuthority: "read_only",
      },
      context,
    )) as {
      readonly metadata: {
        readonly invocationId: string;
      };
    };
    const cancelPromise = surface.callBuiltinTools.get("managed_agent.cancel")?.(
      {
        invocationId: started.metadata.invocationId,
        reason: "Operator cancelled with cleanup evidence.",
      },
      {
        ...context,
        toolCall: { id: "tool-call-cancel-evidence", name: "managed_agent.cancel", input: {} },
      },
    ) as Promise<{
      readonly metadata: {
        readonly lifecycleState?: string;
      };
    }>;

    await flushMicrotasks();
    expect(signal()?.aborted).toBe(true);

    const request = (adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      .request as ManagedAgentInvocationRequest;
    terminal.resolve(
      defineManagedAgentInvocationRecord({
        invocationId: request.invocationId,
        agentId: request.agentId,
        parentSessionId: request.parentSessionId,
        parentTurnId: request.parentTurnId,
        access: request.access,
        lifecycleState: "cancelled",
        providerRoute: request.providerRoute,
        adapterKind: request.adapterKind,
        executionMode: request.executionMode,
        authority: request.authority,
        capabilitySnapshot: buildManagedAgentCapabilitySnapshot(request, adapter.descriptor, {
          routeId: "opencode-readonly",
          routeSource: "explicit-managed-route",
        }),
        transcript: {
          uri: `kiln://managed-invocations/${request.invocationId}/transcript`,
          redacted: "unknown",
          truncated: false,
          persisted: true,
          retention: "session",
        },
        resultHandoff: {
          provenance: TEST_HANDOFF_PROVENANCE,
          summary: "Adapter cleanup completed.",
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/cancel-cleanup`],
          memoryWriteProposalUris: [],
        },
      }),
    );

    const cancelled = await cancelPromise;

    expect(cancelled.metadata.lifecycleState).toBe("cancelled");
    expect(session.sessionEvents[2]).toMatchObject({
      kind: "agent_invocation_cancelled",
      reason: "Operator cancelled with cleanup evidence.",
      managedInvocationEvidence: {
        resultHandoff: {
          summary: "Operator cancelled with cleanup evidence.",
          resourceUris: [],
        },
      },
    });
  });

  it("fails closed before approval when destructive authority selects a read-only profile", async () => {
    const adapter = makeAdapter();
    const surface = makeSurface(adapter, undefined, undefined, {
      testEffectiveTurnAuthority: TEST_DESTRUCTIVE_PARENT_AUTHORITY,
    });
    const session = makeSession();
    const requestApproval = vi.fn(async () => ({
      approved: true,
      reason: "operator approved destructive child authority",
    }));
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
      requestApproval,
      attendedTrustedExecutionSessionAuthority: {} as NonNullable<
        RuntimeBuiltinToolExecutionContext["attendedTrustedExecutionSessionAuthority"]
      >,
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        requestedAuthority: "destructive",
        task: "Apply a destructive managed change.",
      },
      context,
    )) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly requestedAuthority?: string;
      };
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("authority-exceeds-route-ceiling");
    expect(requestApproval).not.toHaveBeenCalled();
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it("fails closed before invocation when the selected route lacks required phase tools", async () => {
    const adapter = makeAdapter();
    const surface = makeSurface(adapter);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Collect visual-reference-research.",
        expectedEvidence: ["visual-reference-research"],
        requiredToolNames: ["web_search", "browser_observe"],
        requestedAuthority: "read_only",
      },
      context,
    )) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly missingRequiredTools?: readonly string[];
        readonly admissionReasons?: readonly {
          readonly code: string;
          readonly requiredToolName?: string;
        }[];
        readonly presentationIntent?: {
          readonly rows?: readonly Record<string, unknown>[];
        };
      };
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("missing-tool, missing-tool");
    expect(result.metadata.admissionReasons).toEqual([
      { code: "missing-tool", requiredToolName: "web_search" },
      { code: "missing-tool", requiredToolName: "browser_observe" },
    ]);
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it("fails closed before invocation when visual phase tools are present without network authority", async () => {
    const adapter = makeAdapter();
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [
          {
            routeId: "opencode-readonly-visual-without-network",
            routeSource: "explicit-managed-route",
            providerId: "opencode",
            model: "opencode-default-model",
            capability: makeRouteCapability({
              routeId: "opencode-readonly-visual-without-network",
              providerId: "opencode",
              model: "opencode-default-model",
              profiles: ["read-only"],
              toolNames: ["read", "web_search", "browser_observe"],
            }),
            createAdapter: async () => adapter,
            profiles: [
              {
                authorityProfileId: "authority:opencode:readonly-visual-without-network",
                access: "read-only",
                allowedToolNames: ["read", "web_search", "browser_observe"],
                networkAllowed: false,
                workingDirectory: {
                  path: "C:/workspace/kiln",
                  mode: "read-only",
                },
                timeoutMs: 120000,
                credentialRoute: {
                  mode: "runtime-selected",
                  routeId: "credential-route:opencode:primary",
                },
                memoryScope: {
                  scope: { kind: "project", id: "kiln" },
                  access: "read-only",
                },
              },
            ],
          },
        ],
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Collect visual-reference-research.",
        expectedEvidence: ["visual-reference-research"],
        requiredToolNames: ["web_search", "browser_observe"],
        requestedAuthority: "read_only",
      },
      context,
    )) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly missingRequiredCapabilities?: readonly string[];
        readonly presentationIntent?: {
          readonly rows?: readonly Record<string, unknown>[];
        };
      };
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("lacks required capabilities: network");
    expect(result.metadata.missingRequiredCapabilities).toEqual(["network"]);
    expect(result.metadata.presentationIntent?.rows?.[0]).toMatchObject({
      status: "unavailable",
      substantiveEvidence: false,
      failureReason: "Missing required route capabilities: network",
    });
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it("keeps managed-agent start missing-tool failures pre-invocation and structured", async () => {
    const adapter = makeAdapter();
    const surface = makeSurface(adapter);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-start-missing-tools",
        name: "managed_agent.start",
        input: {},
      },
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.start")?.(
      {
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Collect visual-reference-research.",
        expectedEvidence: ["visual-reference-research"],
        requiredToolNames: ["web_search", "browser_observe"],
        requestedAuthority: "read_only",
      },
      context,
    )) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly missingRequiredTools?: readonly string[];
        readonly admissionReasons?: readonly {
          readonly code: string;
          readonly requiredToolName?: string;
        }[];
        readonly presentationIntent?: {
          readonly source?: string;
          readonly rows?: readonly Record<string, unknown>[];
        };
      };
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("missing-tool, missing-tool");
    expect(result.metadata.status).toBe("denied");
    expect(result.metadata.admissionReasons).toEqual([
      { code: "missing-tool", requiredToolName: "web_search" },
      { code: "missing-tool", requiredToolName: "browser_observe" },
    ]);
    expect(session.sessionEvents).toEqual([]);
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it("keeps managed-agent start missing-capability failures pre-invocation and structured", async () => {
    const adapter = makeAdapter();
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [
          {
            routeId: "opencode-readonly-visual-without-network",
            routeSource: "explicit-managed-route",
            providerId: "opencode",
            model: "opencode-default-model",
            capability: makeRouteCapability({
              routeId: "opencode-readonly-visual-without-network",
              providerId: "opencode",
              model: "opencode-default-model",
              profiles: ["read-only"],
              toolNames: ["read", "web_search", "browser_observe"],
            }),
            createAdapter: async () => adapter,
            profiles: [
              {
                authorityProfileId: "authority:opencode:readonly-visual-without-network",
                access: "read-only",
                allowedToolNames: ["read", "web_search", "browser_observe"],
                networkAllowed: false,
                workingDirectory: {
                  path: "C:/workspace/kiln",
                  mode: "read-only",
                },
                timeoutMs: 120000,
                credentialRoute: {
                  mode: "runtime-selected",
                  routeId: "credential-route:opencode:primary",
                },
                memoryScope: {
                  scope: { kind: "project", id: "kiln" },
                  access: "read-only",
                },
              },
            ],
          },
        ],
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-start-missing-capabilities",
        name: "managed_agent.start",
        input: {},
      },
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.start")?.(
      {
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Collect visual-reference-research.",
        expectedEvidence: ["visual-reference-research"],
        requiredToolNames: ["web_search", "browser_observe"],
        requestedAuthority: "read_only",
      },
      context,
    )) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly missingRequiredCapabilities?: readonly string[];
        readonly presentationIntent?: {
          readonly source?: string;
          readonly rows?: readonly Record<string, unknown>[];
        };
      };
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("lacks required capabilities: network");
    expect(result.metadata.status).toBe("unavailable");
    expect(result.metadata.missingRequiredCapabilities).toEqual(["network"]);
    expect(result.metadata.presentationIntent).toMatchObject({
      source: "managed_agent.start",
      rows: [
        expect.objectContaining({
          status: "unavailable",
          substantiveEvidence: false,
          failureReason: "Missing required route capabilities: network",
        }),
      ],
    });
    expect(session.sessionEvents).toEqual([]);
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it("keeps managed-agent start worktree-conflict denials structured and replayable", async () => {
    const terminal = deferred<void>();
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor({
        supportedAccess: ["read-only", "approved-write"],
        writeAuthority: {
          proposalSupported: true,
          approvedApplySupported: true,
          memoryProposalSupported: false,
          rollbackEvidence: true,
          cleanupEvidence: true,
          scopeReduction: true,
        },
      }),
      invoke: vi.fn(async ({ request, admission }) => {
        await terminal.promise;
        return defineManagedAgentInvocationRecord({
          invocationId: request.invocationId,
          agentId: request.agentId,
          parentSessionId: request.parentSessionId,
          parentTurnId: request.parentTurnId,
          access: request.access,
          lifecycleState: "completed",
          providerRoute: request.providerRoute,
          adapterKind: request.adapterKind,
          executionMode: request.executionMode,
          authority: request.authority,
          capabilitySnapshot: admission.capabilitySnapshot,
          childSessionId: `${request.parentSessionId}:managed:${request.invocationId}`,
          childTurnId: `${request.parentSessionId}:managed:${request.invocationId}:turn:1`,
          resultHandoff: {
            provenance: TEST_HANDOFF_PROVENANCE,
            summary: "Approved write completed.",
            resourceUris: [`kiln://managed-invocations/${request.invocationId}/handoff`],
            memoryWriteProposalUris: [],
          },
        });
      }),
    };
    const invocationService = makeObservedRuntimeInvocationService();
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        invocationService,
        routes: [
          {
            routeId: "opencode-approved-write",
            routeSource: "explicit-managed-route",
            providerId: "opencode",
            model: "opencode-default-model",
            capability: makeRouteCapability({
              routeId: "opencode-approved-write",
              providerId: "opencode",
              model: "opencode-default-model",
              profiles: ["approved-write"],
              toolNames: ["read", "grep", "apply-patch"],
              supportsWrite: true,
            }),
            createAdapter: async () => adapter,
            profiles: [
              {
                authorityProfileId: "authority:opencode:approved-write",
                access: "approved-write",
                allowedToolNames: ["read", "grep", "apply-patch"],
                writeAllowed: true,
                networkAllowed: false,
                workingDirectory: {
                  path: "C:/workspace/kiln",
                  mode: "workspace-write",
                },
                timeoutMs: 120000,
                credentialRoute: {
                  mode: "credentialless",
                },
                memoryScope: {
                  scope: { kind: "project", id: "kiln" },
                  access: "read-only",
                },
                writeAuthority: defineManagedAgentWriteAuthority({
                  scope: {
                    workspace: {
                      mode: "apply-approved",
                      allowedPaths: ["C:/workspace/kiln/packages/runtime/src"],
                      deniedPaths: ["C:/workspace/kiln/.git"],
                    },
                    memory: {
                      operations: [],
                    },
                    artifacts: {
                      mode: "none",
                      resourceUris: [],
                      retention: "none",
                    },
                    tools: {
                      allowedToolNames: ["apply-patch"],
                      deniedToolNames: ["git-commit"],
                    },
                  },
                  approval: {
                    mode: "required-before-apply",
                    evidenceRequired: true,
                  },
                }),
              },
            ],
          },
        ],
      },
      testEffectiveTurnAuthority: TEST_DESTRUCTIVE_PARENT_AUTHORITY,
    });
    const session = makeSession();
    const requestApproval = vi.fn(async () => ({
      approved: true,
      reason: "operator approved bounded write",
    }));
    const startInput = {
      access: "approved-write" as const,
      routeId: "opencode-approved-write",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      requestedAuthority: "audited",
      task: "Apply the approved runtime edit.",
    };

    const first = (await surface.callBuiltinTools.get("managed_agent.start")?.(startInput, {
      session,
      toolCall: {
        id: "tool-call-write-active",
        name: "managed_agent.start",
        input: startInput,
      },
      requestApproval,
    })) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly invocationId: string;
      };
    };
    const denied = (await surface.callBuiltinTools.get("managed_agent.start")?.(startInput, {
      session,
      toolCall: {
        id: "tool-call-write-conflict",
        name: "managed_agent.start",
        input: startInput,
      },
      requestApproval,
    })) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly lifecycleState?: string;
        readonly missingCapabilities?: readonly string[];
        readonly resourceLease?: {
          readonly worktreeConflict?: {
            readonly status?: string;
            readonly reason?: string;
            readonly requestedInvocationId?: string;
            readonly conflictingInvocationId?: string;
          };
        };
        readonly sessionEventIds?: readonly string[];
        readonly presentationIntent?: {
          readonly source?: string;
          readonly rows?: readonly Record<string, unknown>[];
        };
      };
    };

    expect(first.isError).toBe(false);
    expect(denied.isError).toBe(true);
    expect(denied.output).toContain("Managed invocation denied");
    expect(denied.metadata.status).toBe("denied");
    expect(denied.metadata.lifecycleState).toBe("failed");
    expect(denied.metadata.missingCapabilities).toEqual(["resourceLease.worktreeConflict"]);
    expectPublicResourceLeaseMetadata(denied.metadata.resourceLease);
    expect(denied.metadata.resourceLease?.worktreeConflict).toMatchObject({
      status: "blocked",
      reason: "same-checkout-write-conflict",
      conflictingInvocationId: first.metadata.invocationId,
    });
    expect(denied.metadata.sessionEventIds).toEqual(session.sessionEvents.slice(-2).map((event) => event.eventId));
    expect(denied.metadata.presentationIntent).toMatchObject({
      source: "managed_agent.start",
      rows: [
        expect.objectContaining({
          routeId: "opencode-approved-write",
          status: "denied",
          substantiveEvidence: false,
          failureReason: expect.stringContaining("same-checkout-write-conflict"),
        }),
      ],
    });
    expect(session.sessionEvents.slice(-2).map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_failed",
    ]);
    expect(adapter.invoke).toHaveBeenCalledTimes(1);

    terminal.resolve();
    const joined = (await surface.callBuiltinTools.get("managed_agent.join")?.(
      {
        invocationId: first.metadata.invocationId,
      },
      {
        session,
        toolCall: {
          id: "tool-call-write-active-join",
          name: "managed_agent.join",
          input: {},
        },
      },
    )) as { readonly isError: boolean };
    expect(joined.isError).toBe(false);
  });

  it("fails closed when a managed child requests destructive authority without an attended lease session", async () => {
    const adapter = makeAdapter();
    const surface = makeSurface(adapter, undefined, undefined, {
      testEffectiveTurnAuthority: TEST_DESTRUCTIVE_PARENT_AUTHORITY,
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        requestedAuthority: "destructive",
        task: "Apply a destructive managed change.",
      },
      context,
    )) as {
      readonly output: string;
      readonly isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("requires an interactive attended trusted-execution session");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(session.sessionEvents).toEqual([]);
  });

  it("fails closed when inherited read-only authority selects a write-capable managed profile", async () => {
    const adapter = makeAdapter({
      supportedAccess: ["read-only", "propose"],
      writeAuthority: {
        proposalSupported: true,
        approvedApplySupported: false,
        memoryProposalSupported: false,
        rollbackEvidence: false,
        cleanupEvidence: false,
        scopeReduction: true,
      },
    });
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [
          {
            routeId: "opencode-propose-writes",
            routeSource: "explicit-managed-route",
            providerId: "opencode",
            model: "opencode-default-model",
            capability: makeRouteCapability({
              routeId: "opencode-propose-writes",
              providerId: "opencode",
              model: "opencode-default-model",
              profiles: ["propose"],
              toolNames: ["read", "grep", "edit"],
            }),
            createAdapter: async () => adapter,
            profiles: [
              {
                authorityProfileId: "authority:opencode:propose-writes",
                access: "propose",
                allowedToolNames: ["read", "grep", "edit"],
                writeAllowed: false,
                networkAllowed: false,
                workingDirectory: {
                  path: "C:/workspace/kiln",
                  mode: "workspace-write",
                },
                timeoutMs: 120000,
                credentialRoute: {
                  mode: "runtime-selected",
                  routeId: "credential-route:opencode:primary",
                },
                memoryScope: {
                  scope: { kind: "project", id: "kiln" },
                  access: "read-only",
                },
                writeAuthority: defineManagedAgentWriteAuthority({
                  scope: {
                    workspace: {
                      mode: "propose",
                      allowedPaths: ["C:/workspace/kiln"],
                      deniedPaths: [],
                    },
                    memory: {
                      operations: [],
                    },
                    artifacts: {
                      mode: "none",
                      resourceUris: [],
                      retention: "none",
                    },
                    tools: {
                      allowedToolNames: ["edit"],
                      deniedToolNames: [],
                    },
                  },
                  approval: {
                    mode: "required-before-apply",
                    evidenceRequired: true,
                  },
                }),
              },
            ],
          },
        ],
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
      effectiveTurnAuthority: {
        executionMode: "execute",
        requestedAuthority: "read_only",
        admittedAuthority: "read_only",
        sourcePolicy: "runtime_surface_projection",
        reason: "parent turn admitted read-only authority",
        completeness: "authoritative",
        toolCount: 1,
        deniedToolCount: 0,
        sandboxProjection: "read_only",
      },
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        access: "propose",
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        task: "Prepare a write proposal.",
      },
      context,
    )) as {
      readonly output: string;
      readonly isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain(
      "read_only requested authority cannot select managed access 'propose'",
    );
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(session.sessionEvents).toEqual([]);
  });

  it("admits requested agent profile and skills through the configured context resolver", async () => {
    const adapter = makeAdapter();
    const contextResolver = vi.fn<ManagedInvocationContextResolver>(async () => ({
      promptPrefix: "## Child Agent Profile\nname: architecture-reviewer\n\nSkill\nname: ddd-review",
      admittedAgentProfile: "architecture-reviewer",
      admittedSkills: ["ddd-review"],
    }));
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [makeManagedRoute("opencode-readonly", "model-a", async () => adapter)],
        contextResolver,
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        routeId: "opencode-readonly",
        providerRoute: {
          providerId: "opencode",
          model: "model-a",
        },
        agentProfile: "architecture-reviewer",
        skills: ["ddd-review"],
        contextMode: "isolated",
        task: "Inspect the managed invocation tool contract and report risks.",
      },
      context,
    )) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly context?: Record<string, unknown>;
      };
    };

    expect(result.isError).toBe(false);
    expect(result.metadata.context).toEqual({
      mode: "isolated",
      agentProfile: "architecture-reviewer",
      skills: ["ddd-review"],
      admittedAgentProfile: "architecture-reviewer",
      admittedSkills: ["ddd-review"],
    });
    expect(contextResolver).toHaveBeenCalledWith(
      expect.objectContaining({
        providerRoute: {
          providerId: "opencode",
          model: "model-a",
        },
      }),
    );
    expect((adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].request.input).toMatchObject({
      context: result.metadata.context,
      prompt: expect.stringContaining("## Child Agent Profile"),
    });
    expect(session.sessionEvents).toEqual([
      expect.objectContaining({
        kind: "agent_invocation_requested",
        invocationContext: result.metadata.context,
      }),
      expect.objectContaining({
        kind: "agent_invocation_started",
        invocationContext: result.metadata.context,
      }),
      expect.objectContaining({
        kind: "agent_invocation_completed",
        invocationContext: result.metadata.context,
      }),
    ]);
  });

  it("passes explicit work classification through the context resolver and records diagnostic metadata", async () => {
    const adapter = makeAdapter();
    const contextResolver = vi.fn<ManagedInvocationContextResolver>(async () => ({
      admittedSkills: ["clear-writing"],
      workClassification: {
        intents: ["write"],
        artifacts: ["document"],
        domains: ["education"],
        evidenceScopes: ["provided"],
        effects: ["write-artifact"],
        modes: ["coauthor"],
      },
      workRecommendedSkills: ["clear-writing"],
      workRecommendedSkillDiagnostics: [
        {
          skillName: "clear-writing",
          state: "admitted",
          reason: "Recommended by work classification and admitted by auto selection.",
        },
      ],
    }));
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [makeManagedRoute("opencode-readonly", "model-a", async () => adapter)],
        contextResolver,
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-work-classification",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        routeId: "opencode-readonly",
        providerRoute: {
          providerId: "opencode",
          model: "model-a",
        },
        contextMode: "isolated",
        workClassification: {
          intents: ["write"],
          artifacts: ["document"],
          domains: ["education"],
          evidenceScopes: ["provided"],
          effects: ["write-artifact"],
          modes: ["coauthor"],
        },
        task: "Write a clear report for educators.",
      },
      context,
    )) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly context?: Record<string, unknown>;
      };
    };

    expect(result.isError).toBe(false);
    expect(contextResolver).toHaveBeenCalledWith(
      expect.objectContaining({
        workClassification: {
          intents: ["write"],
          artifacts: ["document"],
          domains: ["education"],
          evidenceScopes: ["provided"],
          effects: ["write-artifact"],
          modes: ["coauthor"],
        },
      }),
    );
    expect(result.metadata.context).toMatchObject({
      mode: "isolated",
      workClassification: {
        intents: ["write"],
        artifacts: ["document"],
        domains: ["education"],
        evidenceScopes: ["provided"],
        effects: ["write-artifact"],
        modes: ["coauthor"],
      },
      admittedSkills: ["clear-writing"],
      resolvedWorkClassification: {
        intents: ["write"],
        artifacts: ["document"],
      },
      workRecommendedSkills: ["clear-writing"],
      workRecommendedSkillDiagnostics: [
        {
          skillName: "clear-writing",
          state: "admitted",
          reason: "Recommended by work classification and admitted by auto selection.",
        },
      ],
    });
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
  });

  it("fails closed for unsupported explicit work classification facets", async () => {
    const adapter = makeAdapter();
    const contextResolver = vi.fn();
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [makeManagedRoute("opencode-readonly", "model-a", async () => adapter)],
        contextResolver,
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-work-classification-invalid",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        routeId: "opencode-readonly",
        providerRoute: {
          providerId: "opencode",
          model: "model-a",
        },
        contextMode: "isolated",
        workClassification: {
          intents: ["writing"],
        },
        task: "Write a clear report.",
      },
      context,
    )) as {
      readonly output: string;
      readonly isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Unsupported work classification intent: writing");
    expect(contextResolver).not.toHaveBeenCalled();
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it("fails closed for malformed or unknown work classification fields", async () => {
    const adapter = makeAdapter();
    const contextResolver = vi.fn();
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [makeManagedRoute("opencode-readonly", "model-a", async () => adapter)],
        contextResolver,
      },
    });
    const context: RuntimeBuiltinToolExecutionContext = {
      session: makeSession(),
      toolCall: {
        id: "tool-call-work-classification-shape",
        name: "managed_agent.invoke",
        input: {},
      },
    };
    const baseInput = {
      routeId: "opencode-readonly",
      providerRoute: {
        providerId: "opencode",
        model: "model-a",
      },
      contextMode: "isolated",
      task: "Write a clear report.",
    };

    const malformed = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        ...baseInput,
        workClassification: {
          intents: "write",
        },
      },
      context,
    )) as {
      readonly output: string;
      readonly isError: boolean;
    };
    const unknown = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        ...baseInput,
        workClassification: {
          intent: ["write"],
        },
      },
      {
        ...context,
        toolCall: {
          ...context.toolCall,
          id: "tool-call-work-classification-unknown",
        },
      },
    )) as {
      readonly output: string;
      readonly isError: boolean;
    };

    expect(malformed.isError).toBe(true);
    expect(malformed.output).toContain("workClassification.intents must be an array of strings");
    expect(unknown.isError).toBe(true);
    expect(unknown.output).toContain("Unsupported work classification field: intent");
    expect(contextResolver).not.toHaveBeenCalled();
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it("fails closed for an unsupported evidence scope", async () => {
    const adapter = makeAdapter();
    const contextResolver = vi.fn();
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [makeManagedRoute("opencode-readonly", "model-a", async () => adapter)],
        contextResolver,
      },
    });

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        routeId: "opencode-readonly",
        providerRoute: { providerId: "opencode", model: "model-a" },
        contextMode: "isolated",
        workClassification: {
          intents: ["research"],
          evidenceScopes: ["internet"],
        },
        task: "Research the current behavior.",
      },
      {
        session: makeSession(),
        toolCall: {
          id: "tool-call-work-classification-evidence-scope",
          name: "managed_agent.invoke",
          input: {},
        },
      },
    )) as { readonly output: string; readonly isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Unsupported work classification evidence scope: internet");
    expect(contextResolver).not.toHaveBeenCalled();
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it("fails closed with denied skills from the configured context resolver before child lifecycle starts", async () => {
    const adapter = makeAdapter();
    const contextResolver = vi.fn(async () => ({
      admittedAgentProfile: "architecture-reviewer",
      deniedSkills: ["workspace-write"],
    }));
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [makeManagedRoute("opencode-readonly", "model-a", async () => adapter)],
        contextResolver,
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-denied-skill",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        routeId: "opencode-readonly",
        providerRoute: {
          providerId: "opencode",
          model: "model-a",
        },
        agentProfile: "architecture-reviewer",
        skills: ["workspace-write"],
        contextMode: "isolated",
        task: "Prepare a managed write review.",
      },
      context,
    )) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly context?: {
          readonly deniedSkills?: readonly string[];
        };
        readonly presentationIntent?: {
          readonly rows?: readonly Record<string, unknown>[];
        };
      };
    };

    expect(result.isError).toBe(true);
    expect(result.metadata.status).toBe("denied");
    expect(result.metadata.context?.deniedSkills).toEqual(["workspace-write"]);
    expect(result.metadata.presentationIntent?.rows?.[0]).toMatchObject({
      status: "denied",
      substantiveEvidence: false,
      failureReason: expect.stringContaining("workspace-write"),
    });
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(session.sessionEvents).toEqual([]);
  });

  it("fails closed when profile or skill context is requested without a resolver", async () => {
    const surface = makeSurface();
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        agentProfile: "architecture-reviewer",
        task: "Inspect the managed invocation tool contract and report risks.",
      },
      context,
    )) as {
      readonly output: string;
      readonly isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("context resolver is not configured");
  });

  it("fails closed when resources context mode is requested without governed resource URIs", async () => {
    const surface = makeSurface();
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        providerRoute: {
          providerId: "opencode",
          model: "opencode-default-model",
        },
        contextMode: "resources",
        task: "Inspect the managed invocation tool contract and report risks.",
      },
      context,
    )) as {
      readonly output: string;
      readonly isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("contextMode resources requires at least one resourceUris entry");
    expect(surface.callBuiltinTools.get("managed_agent.invoke")).toBeDefined();
  });

  it("rejects provider model overrides that do not match the configured managed route", async () => {
    const surface = makeSurface();
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        providerRoute: {
          providerId: "opencode",
          model: "sonic",
        },
        task: "Inspect the managed invocation tool contract and report risks.",
      },
      context,
    )) as {
      readonly output: string;
      readonly isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("No managed invocation route is configured");
  });

  it("fails closed when provider/profile selection is ambiguous without routeId", async () => {
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [
          makeManagedRoute("opencode-readonly-a", "model-a"),
          makeManagedRoute("opencode-readonly-b", "model-b"),
        ],
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        providerRoute: {
          providerId: "opencode",
        },
        task: "Inspect the managed invocation tool contract and report risks.",
      },
      context,
    )) as {
      readonly output: string;
      readonly isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("route selection is ambiguous");
    expect(result.output).toContain("opencode-readonly-a, opencode-readonly-b");
  });

  it("uses the selected agent profile route hint to disambiguate route selection", async () => {
    const fastAdapter = makeAdapter();
    const slowAdapter = makeAdapter();
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [
          makeManagedRoute("opencode-readonly", "model-heavy", async () => slowAdapter),
          makeManagedRoute("opencode-scout-readonly", "model-fast", async () => fastAdapter),
        ],
        agentCatalog: [
          {
            name: "scout",
            displayName: "Dewey",
            role: "Read-only context scout",
            goal: "Map impacted files quickly",
            tier: "fast",
            authorityProfileId: "authority:opencode-scout-readonly:read-only",
            access: "read-only",
            routeId: "opencode-scout-readonly",
            providerRoute: {
              providerId: "opencode",
              model: "model-fast",
            },
            communication: {
              responseDetail: "detailed",
              requiredContent: ["finding"],
            },
          },
        ],
        contextResolver: async () => ({ admittedAgentProfile: "scout" }),
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        providerRoute: {
          providerId: "opencode",
        },
        agentProfile: "scout",
        contextMode: "isolated",
        task: "Scout the GUI surface.",
      },
      context,
    )) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly routeId?: string;
        readonly providerRoute?: Record<string, unknown>;
      };
    };

    expect(result.isError).toBe(false);
    expect(result.metadata.routeId).toBe("opencode-scout-readonly");
    expect(result.metadata.providerRoute).toMatchObject({
      providerId: "opencode",
      model: "model-fast",
    });
    expect(fastAdapter.invoke).toHaveBeenCalledTimes(1);
    expect(slowAdapter.invoke).not.toHaveBeenCalled();
  });

  it("resolves managed-child communication from its agent profile and invocation override", async () => {
    const adapter = makeAdapter();
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [makeManagedRoute("opencode-review", "openai/gpt-5.6-sol", async () => adapter)],
        agentCatalog: [
          {
            name: "reviewer",
            role: "Review changes",
            goal: "Lead with actionable findings",
            tier: "reasoning",
            authorityProfileId: "authority:opencode-review:read-only",
            access: "read-only",
            routeId: "opencode-review",
            providerRoute: { providerId: "opencode", model: "openai/gpt-5.6-sol" },
            communication: {
              responseDetail: "concise",
              requiredContent: ["finding", "residual-risk"],
            },
          },
        ],
        contextResolver: async () => ({ admittedAgentProfile: "reviewer" }),
      },
    });
    const context: RuntimeBuiltinToolExecutionContext = {
      session: makeSession(),
      toolCall: { id: "tool-call-communication", name: "managed_agent.invoke", input: {} },
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        routeId: "opencode-review",
        providerRoute: {
          providerId: "opencode",
          model: "openai/gpt-5.6-sol",
          communicationIntent: {
            responseDetail: "detailed",
            requiredContent: ["verification"],
            artifactContract: { id: "review-report", revision: "v1" },
            responseSkills: [{ id: "code-review-findings", revision: "v1" }],
          },
        },
        agentProfile: "reviewer",
        contextMode: "isolated",
        residualRiskRequired: true,
        task: "Review the candidate change.",
      },
      context,
    )) as { readonly isError: boolean; readonly output: string };

    expect(result.isError, result.output).toBe(false);
    expect(adapter.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          providerRoute: expect.objectContaining({
            communicationIntent: expect.objectContaining({
              intent: expect.objectContaining({
                responseDetail: "detailed",
                requiredContent: ["finding", "residual-risk", "verification"],
                artifactContract: { id: "review-report", revision: "v1" },
                responseSkills: [{ id: "code-review-findings", revision: "v1" }],
              }),
              authority: expect.objectContaining({
                responseDetail: "invocation",
                artifactContract: "invocation",
                responseSkills: ["invocation"],
                requiredContent: expect.objectContaining({
                  "residual-risk": ["safety-authority", "agent-profile"],
                }),
              }),
            }),
          }),
        }),
      }),
    );
  });

  it("fails closed when an explicit route contradicts the selected agent profile route hint", async () => {
    const fastAdapter = makeAdapter();
    const slowAdapter = makeAdapter();
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [
          makeManagedRoute("opencode-readonly", "model-heavy", async () => slowAdapter),
          makeManagedRoute("opencode-scout-readonly", "model-fast", async () => fastAdapter),
        ],
        agentCatalog: [
          {
            name: "scout",
            displayName: "Dewey",
            role: "Read-only context scout",
            goal: "Map impacted files quickly",
            tier: "fast",
            authorityProfileId: "authority:opencode-scout-readonly:read-only",
            access: "read-only",
            routeId: "opencode-scout-readonly",
            providerRoute: {
              providerId: "opencode",
              model: "model-fast",
            },
            communication: {
              responseDetail: "detailed",
              requiredContent: ["finding"],
            },
          },
        ],
        contextResolver: async () => ({ admittedAgentProfile: "scout" }),
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        routeId: "opencode-readonly",
        providerRoute: {
          providerId: "opencode",
          model: "model-fast",
        },
        agentProfile: "scout",
        contextMode: "isolated",
        goalRunId: "goal-ui",
        workItemId: "work-ui",
        attemptId: "goal-ui:work-ui:attempt:1",
        expectedEvidence: ["visual-reference-research"],
        executionPhase: {
          id: "visual-reference-research",
          expectedEvidence: ["visual-reference-research"],
          requiredToolNames: ["read"],
          completionTool: "work_item.update",
          finalPhase: false,
          autoStartAllowed: false,
        },
        task: "Scout the GUI surface.",
      },
      context,
    )) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly nextTool?: string;
        readonly retryInputTemplate?: Record<string, unknown>;
        readonly forbiddenInputFields?: readonly string[];
      };
    };
    const output = JSON.parse(result.output) as {
      readonly status?: string;
      readonly nextTool?: string;
      readonly retryInputTemplate?: {
        readonly routeId?: string;
        readonly agentProfile?: string;
        readonly workItemId?: string;
        readonly providerRoute?: {
          readonly communicationIntent?: {
            readonly identity?: string;
            readonly authority?: { readonly responseDetail?: string };
          };
        };
      };
      readonly forbiddenInputFields?: readonly string[];
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("contradicts configured agentProfile 'scout' route hint");
    expect(output).toMatchObject({
      status: "route_profile_conflict",
      nextTool: "managed_agent.invoke",
      retryInputTemplate: {
        routeId: "opencode-readonly",
        workItemId: "work-ui",
      },
      forbiddenInputFields: ["agentProfile"],
    });
    expect(output.retryInputTemplate?.agentProfile).toBeUndefined();
    expect(output.retryInputTemplate?.providerRoute?.communicationIntent).toMatchObject({
      identity: expect.stringMatching(/^sha256:/),
      authority: { responseDetail: "agent-profile" },
    });
    expect(result.metadata).toMatchObject({
      status: "route_profile_conflict",
      managedInvocationId: "session-parent:tool-call-1:route-profile-conflict",
      invocationId: "session-parent:tool-call-1:route-profile-conflict",
      lifecycleState: "route_profile_conflict",
      parentSessionId: "session-parent",
      parentTurnId: "session-parent:turn:1",
      nextTool: "managed_agent.invoke",
      retryInputTemplate: {
        routeId: "opencode-readonly",
        workItemId: "work-ui",
      },
      forbiddenInputFields: ["agentProfile"],
    });
    expect(result.metadata.retryInputTemplate?.agentProfile).toBeUndefined();
    expect(fastAdapter.invoke).not.toHaveBeenCalled();
    expect(slowAdapter.invoke).not.toHaveBeenCalled();
    expect(session.sessionEvents).toEqual([]);
  });

  it("canonicalizes forbidden agentProfile before route validation for route-owned requests", async () => {
    const phaseSummary = [
      "No public product screenshots were available.",
      "Code-backed frontend implementation evidence from local source /workspace/references/vllm-studio identifies frontend/src app shell component structure, layout pattern, navigation model, panel density, typography, spacing, and product ergonomics.",
      "Local source /workspace/references/t1code/src/app/layout.tsx shows status area, composer-like panels, typography, spacing, and density.",
    ].join(" ");
    const adapter = makeAdapterWithHandoff(phaseSummary);
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [makeManagedRoute("opencode-readonly", "model-heavy", async () => adapter)],
        agentCatalog: [
          {
            name: "scout",
            displayName: "Dewey",
            role: "Read-only context scout",
            goal: "Map impacted files quickly",
            tier: "fast",
            authorityProfileId: "authority:opencode-scout-readonly:read-only",
            access: "read-only",
            routeId: "opencode-scout-readonly",
            providerRoute: {
              providerId: "opencode",
              model: "model-fast",
            },
          },
        ],
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-forbidden-agent-profile",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        routeId: "opencode-readonly",
        providerRoute: {
          providerId: "opencode",
          model: "model-fast",
        },
        forbiddenInputFields: ["agentProfile"],
        agentProfile: "scout",
        contextMode: "isolated",
        goalRunId: "goal-ui",
        workItemId: "work-ui",
        attemptId: "goal-ui:work-ui:attempt:1",
        expectedEvidence: ["visual-reference-research"],
        executionPhase: {
          id: "visual-reference-research",
          expectedEvidence: ["visual-reference-research"],
          requiredToolNames: ["read"],
          completionTool: "work_item.update",
          finalPhase: false,
          autoStartAllowed: false,
        },
        task: "Scout the GUI surface.",
      },
      context,
    )) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly routeId?: string;
        readonly providerRoute?: { readonly model?: string };
        readonly canonicalizedForbiddenInputFields?: readonly string[];
        readonly capabilitySnapshot?: {
          readonly callerIdentity?: unknown;
          readonly childIdentity?: {
            readonly requestedAgentProfile?: string;
            readonly admittedAgentProfile?: string;
          };
        };
      };
    };

    expect(result.isError, result.output).toBe(false);
    expect(JSON.parse(result.output)).toMatchObject({
      status: "completed",
      routeId: "opencode-readonly",
    });
    expect(result.metadata).toMatchObject({
      status: "completed",
      routeId: "opencode-readonly",
      providerRoute: {
        model: "model-heavy",
      },
      canonicalizedForbiddenInputFields: ["agentProfile"],
    });
    expect(result.metadata.capabilitySnapshot?.childIdentity?.requestedAgentProfile).toBeUndefined();
    expect(result.metadata.capabilitySnapshot?.childIdentity?.admittedAgentProfile).toBeUndefined();
    expect(result.metadata.capabilitySnapshot?.callerIdentity).toMatchObject({ kind: "kiln-runtime" });
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
  });

  it("reports configured but unavailable managed routes with their health reason", async () => {
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [],
        unavailableRoutes: [
          {
            routeId: "openrouter-readonly",
            routeSource: "explicit-managed-route",
            providerId: "openrouter",
            model: "openrouter/free",
            accessLevels: ["read-only"],
            reason:
              "Direct provider route 'openrouter-readonly' requires a tool-call-capable model; 'openrouter/openrouter/free' is not eligible.",
          },
        ],
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        providerRoute: {
          providerId: "openrouter",
          model: "openrouter/free",
        },
        task: "Inspect the managed invocation tool contract and report risks.",
      },
      context,
    )) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly presentationIntent?: {
          readonly source?: string;
          readonly rows?: readonly Record<string, unknown>[];
        };
      };
    };

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Managed invocation route 'openrouter-readonly' is unavailable");
    expect(result.output).toContain("requires a tool-call-capable model");
    expect(result.metadata.status).toBe("unavailable");
    expect(result.metadata.presentationIntent).toMatchObject({
      source: "managed_agent.invoke",
      rows: [
        expect.objectContaining({
          routeId: "openrouter-readonly",
          provider: "openrouter",
          model: "openrouter/free",
          status: "unavailable",
          substantiveEvidence: false,
          failureReason:
            "Direct provider route 'openrouter-readonly' requires a tool-call-capable model; 'openrouter/openrouter/free' is not eligible.",
        }),
      ],
    });
  });

  it("projects unavailable managed route status for failure-reason recovery mapping", async () => {
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [],
        unavailableRoutes: [
          {
            routeId: "openrouter-readonly",
            routeSource: "explicit-managed-route",
            providerId: "openrouter",
            model: "openrouter/free",
            accessLevels: ["read-only"],
            reason: "Direct provider route is not eligible.",
          },
        ],
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-unavailable-status",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        providerRoute: {
          providerId: "openrouter",
          model: "openrouter/free",
        },
        task: "Inspect the managed invocation tool contract and report risks.",
      },
      context,
    )) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
      };
    };

    expect(result.isError).toBe(true);
    expect(result.metadata.status).toBe("unavailable");
  });

  it("keeps route-unavailable presentation intent source aligned with the managed tool", async () => {
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [],
        unavailableRoutes: [
          {
            routeId: "openrouter-readonly",
            routeSource: "explicit-managed-route",
            providerId: "openrouter",
            model: "openrouter/free",
            accessLevels: ["read-only"],
            reason: "Direct provider route is not eligible.",
          },
        ],
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-unavailable-start",
        name: "managed_agent.start",
        input: {},
      },
    };

    const result = (await surface.callBuiltinTools.get("managed_agent.start")?.(
      {
        providerRoute: {
          providerId: "openrouter",
          model: "openrouter/free",
        },
        task: "Inspect the managed invocation tool contract and report risks.",
      },
      context,
    )) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly presentationIntent?: {
          readonly source?: string;
          readonly rows?: readonly Record<string, unknown>[];
        };
      };
    };

    expect(result.isError).toBe(true);
    expect(result.metadata.status).toBe("unavailable");
    expect(result.metadata.presentationIntent).toMatchObject({
      source: "managed_agent.start",
      rows: [
        expect.objectContaining({
          routeId: "openrouter-readonly",
          provider: "openrouter",
          model: "openrouter/free",
          status: "unavailable",
          substantiveEvidence: false,
          failureReason: "Direct provider route is not eligible.",
        }),
      ],
    });
    expect(session.sessionEvents).toEqual([]);
  });

  it("fails closed when invoked outside a runtime session context", async () => {
    const surface = makeSurface();

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      providerRoute: { providerId: "opencode" },
      task: "Inspect the managed invocation tool contract.",
    })) as {
      readonly output: string;
      readonly isError: boolean;
    };

    expect(result).toMatchObject({
      output: expect.stringContaining("requires runtime session context"),
      isError: true,
    });
  });

  it("fails closed without invoking an adapter for unconfigured routes", async () => {
    const adapter = makeAdapter();
    const surface = makeSurface(adapter);
    const session = makeSession();

    const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
      {
        providerRoute: { providerId: "codex" },
        task: "Inspect the managed invocation tool contract.",
      },
      {
        session,
        toolCall: {
          id: "tool-call-1",
          name: "managed_agent.invoke",
          input: {},
        },
      },
    )) as {
      readonly output: string;
      readonly isError: boolean;
    };

    expect(result).toMatchObject({
      output: expect.stringContaining("No managed invocation route is configured"),
      isError: true,
    });
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(session.sessionEvents).toEqual([]);
  });
});
