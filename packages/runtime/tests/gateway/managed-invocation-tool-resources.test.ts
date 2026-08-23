import { describe, expect, it, vi } from "vitest";
import { MemoryArtifactResourceStore } from "@kilnai/core/tools";
import { buildAttachedRuntimePerCallToolConfig } from "../../src/gateway/attached-runtime-tool-surface.js";
import { createManagedAgentInvocationResourceProvider } from "../../src/agents/managed-invocation/index.js";
import { attachManagedInvocationSessionEventSink, withManagedInvocationService, type ManagedInvocationSessionEventSink, type ManagedInvocationToolOptions } from "../../src/agents/managed-invocation/runtime-tool/index.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import type { RuntimeBuiltinToolExecutionContext } from "../../src/session/runtime-session-orchestrator.js";
import { createAttachedRuntimeBuiltinToolSurface, makeSession, makeAdapter, makeAdapterWithProgressHandoff, makeTimedOutAdapter, makeSurface, makeRouteCapability, makeManagedRoute } from "./managed-invocation-tool-test-fixture.js";

describe("managed invocation runtime tool — resources and surface contracts", () => {
  it("projects configured managed routes into the model-facing tool definition", () => {
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [
          makeManagedRoute("opencode-readonly-a", "model-a"),
          makeManagedRoute("opencode-readonly-b", "model-b"),
        ],
        agentCatalog: [
          {
            name: "scout",
            displayName: "Dewey",
            role: "Read-only context scout",
            goal: "Map impacted files",
            tier: "fast",
            authorityProfileId: "authority:opencode-readonly-a:foundation-readonly-plan",
            admissionProfile: "foundation-readonly-plan",
            taskAffinity: ["research", "architecture-review"],
          },
          {
            name: "tdd",
            displayName: "Malcolm",
            nicknameCandidates: ["tdd-guide"],
            role: "TDD guide",
            goal: "Write tests first",
            tier: "reasoning",
            authorityProfileId: "authority:opencode-readonly-b:foundation-readonly-plan",
            admissionProfile: "foundation-readonly-plan",
            skills: ["test-generator"],
            taskAffinity: ["test-writing"],
          },
        ],
        skillCatalog: [
          {
            name: "test-generator",
            description: "Generate focused tests.",
            tags: ["test"],
          },
          {
            name: "repo-review",
            description: "Review repository evidence.",
            tags: ["review"],
          },
          {
            name: "manual-release",
            description: "Release only when explicitly named.",
            desiredVisibility: "explicit-only",
          },
          {
            name: "retired-skill",
            description: "Must remain unavailable.",
            desiredVisibility: "disabled",
            admission: { state: "blocked", reason: "Disabled by policy." },
          },
        ],
        unavailableRoutes: [{
          routeId: "openrouter-readonly",
          routeSource: "explicit-managed-route",
          providerId: "openrouter",
          model: "openrouter/free",
          profiles: ["foundation-readonly-plan"],
          reason: "model is not tool-call-capable",
        }],
      },
    });

    const tool = surface.toolDefinitions.find((definition) => definition.name === "managed_agent.invoke");
    const schema = tool?.inputSchema as {
      readonly properties?: {
        readonly routeId?: { readonly enum?: readonly string[] };
        readonly workItemId?: { readonly type?: string };
        readonly requestedAuthority?: {
          readonly enum?: readonly string[];
        };
        readonly expectedEvidence?: {
          readonly items?: { readonly type?: string };
        };
        readonly executionPhase?: {
          readonly properties?: {
            readonly verificationRequirementIds?: {
              readonly items?: { readonly type?: string };
            };
            readonly taskAffinity?: {
              readonly items?: { readonly type?: string };
            };
            readonly instruction?: { readonly type?: string };
          };
        };
        readonly agentProfile?: { readonly enum?: readonly string[] };
        readonly skills?: {
          readonly items?: { readonly enum?: readonly string[] };
          readonly maxItems?: number;
        };
        readonly providerRoute?: {
          readonly properties?: {
            readonly providerId?: { readonly enum?: readonly string[] };
          };
        };
      };
    };

    expect(tool?.description).toContain("Configured healthy managed invocation routes");
    expect(tool?.description).toContain("opencode-readonly-a");
    expect(tool?.description).not.toContain("invocationCapability=");
    expect(tool?.description).toContain("taskSuitability=architecture-review:capable:static-profile");
    expect(tool?.description).toContain("Configured unavailable managed invocation routes");
    expect(tool?.description).toContain("openrouter-readonly");
    expect(tool?.description).toContain("Configured admitted agent profiles");
    expect(tool?.description).toContain("Configured admitted skills: test-generator");
    expect(tool?.description).toContain("Configured skill catalog");
    expect(tool?.description).toContain("repo-review: Review repository evidence");
    expect(tool?.description).not.toContain("manual-release: Release only when explicitly named");
    expect(tool?.description).not.toContain("retired-skill: Must remain unavailable");
    expect(tool?.description).toContain("Task-affinity hints");
    expect(tool?.description).toContain("Routes: opencode-readonly-a -> architecture-review:capable");
    expect(tool?.description).toContain("Agent profiles: scout -> research,architecture-review");
    expect(tool?.description).toContain("scout (Dewey)");
    expect(tool?.description).toContain("tdd (Malcolm/tdd-guide)");
    expect(tool?.description).toContain("Selection policy");
    expect(tool?.description).toContain("Do not invent agentProfile names");
    expect(tool?.description).toContain("Do not invent skill names");
    expect(tool?.description).toContain("pass workItemId, expectedEvidence");
    expect(tool?.description).toContain("Do not use contextMode=resources without resourceUris");
    expect(tool?.description).toContain("timeoutMs=120000");
    expect(tool?.description).toContain("source=explicit-route");
    expect(tool?.description).toContain("For broad repository review, long reasoning, or multi-file analysis, choose a route with a sufficient timeout budget or split the work into smaller children.");
    expect(tool?.description).toContain("Do not put resource_read in requiredToolNames just because contextMode=resources is used");
    expect(tool?.description).toContain("For comparison tasks");
    expect(schema.properties?.routeId?.enum).toEqual([
      "opencode-readonly-a",
      "opencode-readonly-b",
      "openrouter-readonly",
    ]);
    expect(schema.properties?.providerRoute?.properties?.providerId?.enum).toEqual([
      "opencode",
      "openrouter",
    ]);
    expect(schema.properties?.agentProfile?.enum).toEqual([
      "scout",
      "Dewey",
      "tdd",
      "Malcolm",
      "tdd-guide",
    ]);
    expect(schema.properties?.workItemId?.type).toBe("string");
    expect(schema.properties?.requestedAuthority?.enum).toEqual([
      "auto",
      "read_only",
      "audited",
      "destructive",
    ]);
    expect(schema.properties?.expectedEvidence?.items?.type).toBe("string");
    expect(schema.properties?.executionPhase?.properties?.verificationRequirementIds?.items?.type).toBe("string");
    expect(schema.properties?.executionPhase?.properties?.taskAffinity?.items?.type).toBe("string");
    expect(schema.properties?.executionPhase?.properties?.instruction?.type).toBe("string");
    expect(schema.properties?.skills?.items?.enum).toEqual(["test-generator", "repo-review", "manual-release"]);
  });

  it("prevents invented managed child skills when the admitted catalog has none", () => {
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [makeManagedRoute("opencode-readonly", "model-a")],
        agentCatalog: [{
          name: "architect",
          displayName: "Piama",
          role: "Software architect",
          goal: "Review architecture",
          tier: "reasoning",
          authorityProfileId: "authority:opencode-readonly:foundation-readonly-plan",
          admissionProfile: "foundation-readonly-plan",
        }],
        skillCatalog: [],
      },
    });

    const tool = surface.toolDefinitions.find((definition) => definition.name === "managed_agent.invoke");
    const schema = tool?.inputSchema as {
      readonly properties?: {
        readonly skills?: {
          readonly description?: string;
          readonly maxItems?: number;
        };
      };
    };

    expect(tool?.description).toContain("Configured admitted skills: none");
    expect(schema.properties?.skills?.maxItems).toBe(0);
    expect(schema.properties?.skills?.description).toContain("Omit skills");
  });

  it("composes managed invocation session event sinks for operator surfaces", async () => {
    const originalSink = vi.fn();
    const surfaceSink = vi.fn();
    const attachment = attachManagedInvocationSessionEventSink({
      options: {
        routes: [],
        sessionEventSink: { publish: originalSink },
      },
      callerIdentity: {
        kind: "kiln-runtime",
        surface: "runtime-test",
        attachmentId: "attachment:runtime-test",
      },
    }, { publish: surfaceSink });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    };
    const events: Parameters<NonNullable<ManagedInvocationSessionEventSink["publish"]>>[0] = [];

    await attachment?.options.sessionEventSink?.publish(events, context);

    expect(originalSink).toHaveBeenCalledWith(events, context);
    expect(surfaceSink).toHaveBeenCalledWith(events, context);
  });

  it("preserves live managed invocation route catalogs when composing session event sinks", () => {
    const route = {
      ...makeManagedRoute("codex-oauth-auto-review-readonly", "codex-auto-review"),
      providerId: "codex-oauth",
      surface: "direct-provider",
    };
    let current: ManagedInvocationToolOptions = {
      routes: [],
      unavailableRoutes: [{
        routeId: "codex-oauth-auto-review-readonly",
        routeSource: "explicit-managed-route",
        providerId: "codex-oauth",
        model: "codex-auto-review",
        profiles: ["foundation-readonly-plan"],
        reason: "Provider/model discovery is pending.",
      }],
    };
    const liveOptions: ManagedInvocationToolOptions = {
      get routes() {
        return current.routes;
      },
      get unavailableRoutes() {
        return current.unavailableRoutes;
      },
      requestedBy: "assistant",
      requestSource: "gui",
    };

    const attachment = attachManagedInvocationSessionEventSink({
      options: liveOptions,
      callerIdentity: {
        kind: "kiln-runtime",
        surface: "runtime-test",
        attachmentId: "attachment:runtime-test",
      },
    }, { publish: vi.fn() });
    current = {
      routes: [route],
      requestedBy: "assistant",
      requestSource: "gui",
    };

    expect(attachment?.options.routes.map((entry) => entry.routeId)).toEqual(["codex-oauth-auto-review-readonly"]);
    expect(attachment?.options.unavailableRoutes).toBeUndefined();
  });

  it("does not let one managed invocation session event sink block another", async () => {
    const originalSink = vi.fn().mockRejectedValue(new Error("relay unavailable"));
    const surfaceSink = vi.fn();
    const attachment = attachManagedInvocationSessionEventSink({
      options: {
        routes: [],
        sessionEventSink: { publish: originalSink },
      },
      callerIdentity: {
        kind: "kiln-runtime",
        surface: "runtime-test",
        attachmentId: "attachment:runtime-test",
      },
    }, { publish: surfaceSink });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    };
    const events: Parameters<NonNullable<ManagedInvocationSessionEventSink["publish"]>>[0] = [];

    await expect(attachment?.options.sessionEventSink?.publish(events, context)).resolves.toBeUndefined();

    expect(originalSink).toHaveBeenCalledWith(events, context);
    expect(surfaceSink).toHaveBeenCalledWith(events, context);
  });

  it("maps managed_agent.invoke input and runtime context to an admitted managed invocation request", async () => {
    const adapter = makeAdapter();
    const sessionEventSink = { publish: vi.fn() };
    const surface = makeSurface(adapter, sessionEventSink);
    const executeConfig = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-a",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: surface,
    });
    const planConfig = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-a",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: surface,
      executionMode: "plan",
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

    expect(surface.toolDefinitions.map((tool) => tool.name)).toContain("managed_agent.invoke");
    expect(executeConfig.toolAllowlist?.has("managed_agent.invoke")).toBe(true);
    expect(executeConfig.toolAllowlist?.has("managed_agent.start")).toBe(true);
    expect(executeConfig.toolAllowlist?.has("managed_agent.status")).toBe(true);
    expect(executeConfig.toolAllowlist?.has("managed_agent.list")).toBe(true);
    expect(executeConfig.toolAllowlist?.has("managed_agent.join")).toBe(true);
    expect(executeConfig.toolAuthority?.get("managed_agent.invoke")).toMatchObject({
      allowed: false,
      requiresApproval: true,
    });
    expect(planConfig.toolAllowlist?.has("managed_agent.invoke")).toBe(false);
    expect(planConfig.toolAllowlist?.has("managed_agent.start")).toBe(false);
    expect(planConfig.toolAllowlist?.has("managed_agent.status")).toBe(false);
    expect(planConfig.toolAllowlist?.has("managed_agent.list")).toBe(false);
    expect(planConfig.toolAllowlist?.has("managed_agent.join")).toBe(false);

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      task: "Inspect the managed invocation tool contract and report risks.",
      workItemId: "work-42",
      goalRunId: "goal-run-test",
      roleIntent: "Architecture review before implementation.",
      expectedEvidence: ["surface-map", "managed-agent-review", "residual-risk"],
      requiredResultFields: ["summary", "evidence", "residualRisks"],
      doneCriteria: ["Report the top contract risk and cite evidence."],
      residualRiskRequired: true,
      outputVerbosity: "concise",
      requestedAuthority: "read_only",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly invocationId: string;
        readonly childSessionId?: string;
        readonly profile?: string;
        readonly providerRoute?: Record<string, unknown>;
        readonly adapterKind?: string;
        readonly executionMode?: string;
        readonly requestedAuthority?: string;
        readonly authorityProfileId?: string;
        readonly handoffContract?: Record<string, unknown>;
        readonly presentationIntent?: Record<string, unknown>;
      };
    };

    expect(result).toMatchObject({
      output: expect.stringContaining("Child review completed."),
      isError: false,
      metadata: {
        childSessionId: expect.stringContaining("session-parent:managed:"),
        profile: "foundation-readonly-plan",
        providerRoute: {
          providerId: "opencode",
          surface: "cli-harness",
          model: "opencode-default-model",
        },
        adapterKind: "harness",
        executionMode: "cli-harness",
        requestedAuthority: "read_only",
        authorityProfileId: "authority:opencode:readonly",
        handoffContract: {
          workItemId: "work-42",
          roleIntent: "Architecture review before implementation.",
          expectedEvidence: ["surface-map", "managed-agent-review", "residual-risk"],
          requiredResultFields: ["summary", "evidence", "residualRisks"],
          doneCriteria: ["Report the top contract risk and cite evidence."],
          residualRiskRequired: true,
          outputVerbosity: "concise",
        },
        presentationIntent: {
          kind: "comparison_table",
          title: "Managed child invocation",
          rows: [
            expect.objectContaining({
              routeId: "opencode-readonly",
              provider: "opencode",
              model: "opencode-default-model",
              status: "completed",
              substantiveEvidence: true,
            }),
          ],
        },
      },
    });
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
    expect(result.output).not.toContain("Internal child execution detail.");
    expect(result.output).toContain('"verificationUsage"');
    expect((adapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].request).toMatchObject({
      parentSessionId: "session-parent",
      parentTurnId: "session-parent:turn:1",
      profile: "foundation-readonly-plan",
      requestedAuthority: "read_only",
      requestedBy: "assistant",
      requestSource: "runtime-tool",
      providerRoute: {
        providerId: "opencode",
        surface: "cli-harness",
        model: "opencode-default-model",
      },
      authority: {
        authorityProfileId: "authority:opencode:readonly",
        permissionProfile: "read-only",
        toolAuthority: {
          allowedToolNames: ["read", "grep", "glob"],
          writeAllowed: false,
          networkAllowed: false,
        },
        workingDirectory: {
          path: "C:/workspace/kiln",
          mode: "read-only",
        },
      },
      input: {
        summary: "Inspect the managed invocation tool contract and report risks.",
        prompt: "Inspect the managed invocation tool contract and report risks.",
        handoff: {
          workItemId: "work-42",
          expectedEvidence: ["surface-map", "managed-agent-review", "residual-risk"],
          residualRiskRequired: true,
          outputVerbosity: "concise",
        },
      },
    });
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_completed",
    ]);
    expect(session.sessionEvents[0]).toMatchObject({
      requestedAuthority: "read_only",
    });
    expect(sessionEventSink.publish).toHaveBeenCalledTimes(2);
    expect(sessionEventSink.publish).toHaveBeenNthCalledWith(1, session.sessionEvents.slice(0, 2), expect.objectContaining(context));
    expect(sessionEventSink.publish).toHaveBeenNthCalledWith(2, [session.sessionEvents[2]], expect.objectContaining(context));
    expect(session.sessionEvents[2]).toMatchObject({
      requestedAuthority: "read_only",
      handoffContract: {
        workItemId: "work-42",
        residualRiskRequired: true,
      },
      resultSummary: "Child review completed.",
      managedInvocationEvidence: {
        childSessionId: result.metadata.childSessionId,
      },
    });
  });

  it("returns managed_agent.invoke child progress events with the terminal result", async () => {
    const adapter = makeAdapterWithProgressHandoff("Child review completed with evidence.");
    const surface = makeSurface(adapter);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-progress",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      task: "Inspect one file.",
      summary: "Inspect one file.",
      requestedAuthority: "read_only",
    }, context) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: {
        readonly progressEventCount?: number;
        readonly recentProgressEvents?: readonly {
          readonly kind: string;
          readonly summary: string;
          readonly toolName?: string;
        }[];
      };
    };
    const output = JSON.parse(result.output) as {
      readonly progressEventCount?: number;
      readonly recentProgressEvents?: readonly {
        readonly kind: string;
        readonly summary: string;
        readonly toolName?: string;
      }[];
    };

    expect(result.isError).toBe(false);
    expect(result.metadata.progressEventCount).toBe(1);
    expect(result.metadata.recentProgressEvents).toEqual([expect.objectContaining({
      kind: "tool_called",
      summary: "read called",
      toolName: "read",
    })]);
    expect(output.recentProgressEvents).toEqual(result.metadata.recentProgressEvents);
    expect(output).not.toHaveProperty("progressEvents");
  });


  it("returns provider-readable managed transcript URIs when artifact persistence is not configured", async () => {
    const managedInvocation = withManagedInvocationService({
      routes: [makeManagedRoute("opencode-readonly", "opencode-default-model", async () => makeAdapter())],
    });
    const surface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        resourceProviders: [
          createManagedAgentInvocationResourceProvider({
            service: managedInvocation.invocationService,
            parentSessionId: "session-parent",
          }),
        ],
      },
      managedInvocation,
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-provider-readable",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      routeId: "opencode-readonly",
      providerRoute: { providerId: "opencode", model: "opencode-default-model" },
      task: "Inspect managed invocation resource readability.",
    }, context) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly invocationId: string;
        readonly resourceLinks?: readonly { readonly uri: string; readonly title?: string; readonly relation?: string }[];
        readonly transcript?: { readonly uri?: string };
        readonly resultHandoff?: { readonly resourceUris?: readonly string[] };
      };
    };

    const canonicalTranscriptUri = `kiln://managed-agents/invocations/${result.metadata.invocationId}/transcript`;

    expect(result.isError).toBe(false);
    expect(result.metadata.transcript?.uri).toBe(canonicalTranscriptUri);
    expect(result.metadata.resultHandoff?.resourceUris).toContain(canonicalTranscriptUri);
    expect(result.metadata.resourceLinks).toEqual([expect.objectContaining({
      uri: canonicalTranscriptUri,
      title: "Managed invocation transcript",
      relation: "events",
    })]);
    expect(JSON.stringify(result.metadata)).not.toContain("kiln://managed-invocations/");
    await expect(surface.callBuiltinTools.get("resource_read")?.({
      uri: canonicalTranscriptUri,
    }, context)).resolves.toMatchObject({
      isError: false,
      metadata: expect.objectContaining({
        toolName: "resource_read",
        uri: canonicalTranscriptUri,
      }),
    });
  });

  it("scopes shared managed invocation resource tools to the executing runtime session", async () => {
    const managedInvocation = withManagedInvocationService({
      routes: [makeManagedRoute("opencode-readonly", "opencode-default-model", async () => makeAdapter())],
    });
    const surface = createAttachedRuntimeBuiltinToolSurface({ managedInvocation });
    const sessionA = makeSession("session-a");
    const sessionB = makeSession("session-b");
    const contextFor = (session: RuntimeSession, id: string): RuntimeBuiltinToolExecutionContext => ({
      session,
      toolCall: { id, name: "managed_agent.invoke", input: {} },
    });
    const contextA = contextFor(sessionA, "tool-call-session-a");
    const contextB = contextFor(sessionB, "tool-call-session-b");
    const invoke = surface.callBuiltinTools.get("managed_agent.invoke")!;
    const resultA = await invoke({
      profile: "foundation-readonly-plan",
      routeId: "opencode-readonly",
      providerRoute: { providerId: "opencode", model: "opencode-default-model" },
      task: "Session A task.",
    }, contextA) as { readonly metadata: { readonly invocationId: string } };
    const resultB = await invoke({
      profile: "foundation-readonly-plan",
      routeId: "opencode-readonly",
      providerRoute: { providerId: "opencode", model: "opencode-default-model" },
      task: "Session B task.",
    }, contextB) as { readonly metadata: { readonly invocationId: string } };

    const listA = await surface.callBuiltinTools.get("resource_list")?.({}, contextA) as {
      readonly isError: boolean;
      readonly output: string;
    };
    const listedA = JSON.parse(listA.output) as { readonly resources: readonly { readonly uri: string }[] };
    const listedUrisA = listedA.resources.map((resource) => resource.uri);
    expect(listA.isError).toBe(false);
    expect(listedUrisA).toContain(`kiln://managed-agents/invocations/${resultA.metadata.invocationId}`);
    expect(listedUrisA.some((uri) => uri.includes(resultB.metadata.invocationId))).toBe(false);

    const foreignRead = await surface.callBuiltinTools.get("resource_read")?.({
      uri: `kiln://managed-agents/invocations/${resultB.metadata.invocationId}`,
    }, contextA) as { readonly isError: boolean; readonly metadata?: { readonly errorCode?: string } };
    expect(foreignRead).toMatchObject({
      isError: true,
      metadata: expect.objectContaining({ errorCode: "not_found" }),
    });
  });

  it("exposes timeout diagnostic resources with effective timeout evidence", async () => {
    const managedInvocation = withManagedInvocationService({
      routes: [makeManagedRoute("opencode-readonly", "opencode-default-model", async () => makeTimedOutAdapter())],
    });
    const surface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        resourceProviders: [
          createManagedAgentInvocationResourceProvider({
            service: managedInvocation.invocationService,
            parentSessionId: "session-parent",
          }),
        ],
      },
      managedInvocation,
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-provider-readable-timeout",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      routeId: "opencode-readonly",
      providerRoute: { providerId: "opencode", model: "opencode-default-model" },
      task: "Inspect managed invocation timeout resource readability.",
    }, context) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly resultHandoff?: { readonly resourceUris?: readonly string[] };
      };
    };
    const timeoutUri = result.metadata.resultHandoff?.resourceUris
      ?.find((uri) => uri.endsWith("/resources/timeout"));

    expect(result.isError).toBe(true);
    expect(timeoutUri).toEqual(expect.any(String));
    const timeoutResource = await surface.callBuiltinTools.get("resource_read")?.({
      uri: timeoutUri,
    }, context) as {
      readonly isError: boolean;
      readonly output: string;
    };
    const payload = JSON.parse(timeoutResource.output) as {
      readonly resource?: {
        readonly lifecycleState?: string;
        readonly timeoutMs?: number;
        readonly timeoutSource?: string;
        readonly diagnostics?: readonly { readonly kind?: string }[];
      };
    };

    expect(timeoutResource.isError).toBe(false);
    expect(payload.resource).toMatchObject({
      lifecycleState: "timed_out",
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
      diagnostics: [expect.objectContaining({ kind: "timeout" })],
    });
  });

  it("records the effective route model and persists readable handoff resources", async () => {
    const artifactStore = new MemoryArtifactResourceStore();
    const surface = makeSurface(makeAdapter(), undefined, artifactStore);
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-1",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      profile: "foundation-readonly-plan",
      providerRoute: { providerId: "opencode" },
      task: "Inspect the managed invocation tool contract and report risks.",
    }, context) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly providerRoute?: Record<string, unknown>;
        readonly transcript?: { readonly uri?: string };
        readonly resultHandoff?: { readonly resourceUris?: readonly string[] };
      };
    };

    expect(result.isError).toBe(false);
    expect(result.metadata.providerRoute).toMatchObject({
      providerId: "opencode",
      surface: "cli-harness",
      model: "opencode-default-model",
    });
    expect(result.metadata.transcript?.uri).toMatch(/^kiln:\/\/artifacts\/managed-invocations\/artifact_\d+\/content$/u);
    expect(result.metadata.resultHandoff?.resourceUris?.[0]).toBe(result.metadata.transcript?.uri);

    const transcriptUri = result.metadata.transcript?.uri ?? "";
    const firstTranscriptPage = await surface.readResource(transcriptUri, { limit: 2 });
    const nextTranscriptCursor = firstTranscriptPage.nextCursor;
    expect(nextTranscriptCursor).toEqual(expect.any(String));
    if (!nextTranscriptCursor) {
      throw new Error("Expected paged transcript resource to return a next cursor.");
    }
    expect(firstTranscriptPage.contents[0]?._meta?.range).toMatchObject({
      unit: "line",
      offset: 0,
      limit: 2,
      truncated: true,
    });
    const transcript = await surface.readResource(transcriptUri, {
      cursor: nextTranscriptCursor,
      limit: 1_000,
    });
    expect(transcript.contents[0]).toMatchObject({
      mimeType: "text/markdown",
    });
    const firstTranscriptText = String("text" in firstTranscriptPage.contents[0]! ? firstTranscriptPage.contents[0]!.text : "");
    const transcriptText = [
      firstTranscriptText,
      String("text" in transcript.contents[0]! ? transcript.contents[0]!.text : ""),
    ].join("\n");
    expect(transcriptText).toContain("Model: opencode-default-model");
    expect(transcriptText).toContain("## Capability Snapshot");
    expect(transcriptText).toContain("Route ID: opencode-readonly");
    expect(transcriptText).toContain("Route source: explicit-managed-route");
    expect(transcriptText).toContain("Provider proof: live-proven");
    expect(transcriptText).toContain("Child review completed.");
  });

  it("preserves configured provider proof for remote harness routes", async () => {
    const adapter = makeAdapter({
      adapterDescriptorId: "adapter:codex-cloud:remote-harness",
      providerId: "codex-cloud",
      supportedExecutionModes: ["remote-harness"],
    });
    const route = {
      ...makeManagedRoute("codex-cloud-remote-readonly", "gpt-5.5", async () => adapter, "codex-cloud"),
      providerId: "codex-cloud",
      capability: makeRouteCapability({
        routeId: "codex-cloud-remote-readonly",
        providerId: "codex-cloud",
        model: "gpt-5.5",
        profiles: ["foundation-readonly-plan"],
        adapterKind: "governed-external-runtime",
      }),
      surface: "remote-harness",
      providerModelProof: {
        status: "configured" as const,
        source: "remote-harness-config",
        requiresToolCalls: false,
      },
    };
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [route],
      },
    });
    const artifactStore = new MemoryArtifactResourceStore();
    const resourceSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: { artifactResources: { store: artifactStore } },
      managedInvocation: {
        artifactStore,
        routes: [route],
      },
    });
    const session = makeSession();
    const context: RuntimeBuiltinToolExecutionContext = {
      session,
      toolCall: {
        id: "tool-call-remote-proof",
        name: "managed_agent.invoke",
        input: {},
      },
    };

    const result = await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      routeId: "codex-cloud-remote-readonly",
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "codex-cloud",
        model: "gpt-5.5",
      },
      task: "Inspect remote managed invocation proof metadata.",
    }, context) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly capabilitySnapshot?: {
          readonly providerModelProof?: {
            readonly status?: string;
            readonly source?: string;
          };
        };
      };
    };

    expect(result.isError).toBe(false);
    expect(result.metadata.capabilitySnapshot?.providerModelProof).toMatchObject({
      status: "configured",
      source: "remote-harness-config",
    });

    const resourceResult = await resourceSurface.callBuiltinTools.get("managed_agent.invoke")?.({
      routeId: "codex-cloud-remote-readonly",
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "codex-cloud",
        model: "gpt-5.5",
      },
      task: "Inspect remote managed invocation proof metadata.",
    }, {
      ...context,
      toolCall: {
        id: "tool-call-remote-proof-resource",
        name: "managed_agent.invoke",
        input: {},
      },
    }) as {
      readonly metadata: {
        readonly transcript?: { readonly uri?: string };
      };
    };
    const transcript = await resourceSurface.readResource(resourceResult.metadata.transcript?.uri ?? "");
    const transcriptText = String("text" in transcript.contents[0]! ? transcript.contents[0]!.text : "");
    expect(transcriptText).toContain("Provider proof: configured");
    expect(transcriptText).toContain("Provider proof source: remote-harness-config");
  });

});
