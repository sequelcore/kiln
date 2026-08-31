import { describe, expect, it } from "vitest";
import { buildTuiTurnPerCallConfig } from "../../src/gateway/tui-gateway.js";
import { RuntimeManagedAgentInvocationService } from "../../src/agents/managed-invocation/index.js";
import { withManagedInvocationService, type ManagedInvocationToolOptions } from "../../src/agents/managed-invocation/runtime-tool/index.js";
import { assertManagedToolResult, createAttachedRuntimeBuiltinToolSurface, makeSession, makeAdapter, makeSurface, makeManagedRoute } from "./managed-invocation-tool-test-fixture.js";

describe("managed invocation runtime tool", () => {
  it("admits Codex parent read-only invocation through explicit OpenCode adapter capability", async () => {
    const adapter = makeAdapter({
      adapterDescriptorId: "adapter:opencode-go:cli-harness",
      providerId: "opencode-go",
    });
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        callerIdentity: {
          kind: "external-harness",
          harness: "codex",
          attachmentId: "attachment:codex:test",
          evidenceId: "evidence:codex:test",
        },
        routes: [makeManagedRoute("opencode-go-readonly", "kimi-k2.7-code", async () => adapter, "opencode-go")],
      },
    });
    const session = makeSession();

    const result = assertManagedToolResult(await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      routeId: "opencode-go-readonly",
      access: "read-only",
      providerRoute: {
        providerId: "opencode-go",
        model: "kimi-k2.7-code",
      },
      task: "Read the architecture docs and report route risks.",
      requestedAuthority: "read_only",
    }, {
      session,
      toolCall: {
        id: "tool-call-codex-opencode-go",
        name: "managed_agent.invoke",
        input: {},
      },
    }) as {
      readonly isError: boolean;
      readonly metadata: {
        readonly status?: string;
        readonly routeId?: string;
        readonly providerRoute?: Record<string, unknown>;
        readonly adapterKind?: string;
        readonly executionMode?: string;
        readonly authoritySnapshot?: Record<string, unknown>;
        readonly capabilitySnapshot?: {
          readonly callerIdentity?: unknown;
          readonly providerRoute?: Record<string, unknown>;
          readonly authorityProfile?: Record<string, unknown>;
        };
      };
    });

    expect(result.isError).toBe(false);
    expect(result.metadata).toMatchObject({
      status: "completed",
      routeId: "opencode-go-readonly",
      providerRoute: {
        providerId: "opencode-go",
        model: "kimi-k2.7-code",
        surface: "cli-harness",
      },
      adapterKind: "harness",
      executionMode: "cli-harness",
      authoritySnapshot: {
        authorityProfileId: "authority:opencode-go-readonly:read-only",
        toolAuthority: {
          allowedToolNames: ["read", "grep", "glob"],
          writeAllowed: false,
          networkAllowed: false,
        },
      },
      capabilitySnapshot: {
        callerIdentity: {
          kind: "external-harness",
          harness: "codex",
          attachmentId: "attachment:codex:test",
          evidenceId: "evidence:codex:test",
        },
        providerRoute: {
          providerId: "opencode-go",
          model: "kimi-k2.7-code",
          surface: "cli-harness",
        },
        authorityProfile: {
          authorityProfileId: "authority:opencode-go-readonly:read-only",
          toolAuthority: {
            allowedToolNames: ["read", "grep", "glob"],
            writeAllowed: false,
            networkAllowed: false,
          },
        },
      },
    });
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
  });

  it("admits external callers through the selected route capability", async () => {
    const adapter = makeAdapter();
    const surface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        callerIdentity: {
          kind: "external-harness",
          harness: "codex",
          attachmentId: "attachment:codex:test",
          evidenceId: "evidence:codex:test",
        },
        routes: [makeManagedRoute("opencode-readonly", "opencode-go/kimi-k2.7-code", async () => adapter)],
      },
    });
    const session = makeSession();

    const result = assertManagedToolResult(await surface.callBuiltinTools.get("managed_agent.invoke")?.({
      routeId: "opencode-readonly",
      access: "read-only",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-go/kimi-k2.7-code",
      },
      task: "Review the runtime boundary.",
    }, {
      session,
      toolCall: {
        id: "tool-call-caller-policy",
        name: "managed_agent.invoke",
        input: {},
      },
    }) as {
      readonly output: string;
      readonly isError: boolean;
      readonly metadata: Record<string, unknown>;
    });

    expect(result.isError).toBe(false);
    expect(result.metadata).toMatchObject({
      status: "completed",
    });
    expect(adapter.invoke).toHaveBeenCalledTimes(1);
  });

  it("normalizes managed invocation options to one shared runtime service", () => {
    const options = {
      routes: [makeManagedRoute("opencode-readonly", "opencode-default-model")],
    } satisfies ManagedInvocationToolOptions;

    const normalized = withManagedInvocationService(options);
    const normalizedAgain = withManagedInvocationService(normalized);

    expect(normalized.invocationService).toBeInstanceOf(RuntimeManagedAgentInvocationService);
    expect(normalizedAgain).toBe(normalized);
  });

  it("is not exposed unless managed invocation routes are configured", () => {
    const surface = createAttachedRuntimeBuiltinToolSurface();

    expect(surface.toolDefinitions.some((tool) => tool.name === "managed_agent.invoke")).toBe(false);
    expect(surface.toolDefinitions.some((tool) => tool.name === "managed_agent.start")).toBe(false);
    expect(surface.toolDefinitions.some((tool) => tool.name === "managed_agent.status")).toBe(false);
    expect(surface.toolDefinitions.some((tool) => tool.name === "managed_agent.list")).toBe(false);
    expect(surface.toolDefinitions.some((tool) => tool.name === "managed_agent.join")).toBe(false);
    expect(surface.toolDefinitions.some((tool) => tool.name === "managed_agent.cancel")).toBe(false);
    expect(surface.toolDefinitions.some((tool) => tool.name === "managed_agent.orchestrate")).toBe(false);
    expect(surface.callBuiltinTools.has("managed_agent.invoke")).toBe(false);
    expect(surface.callBuiltinTools.has("managed_agent.start")).toBe(false);
    expect(surface.callBuiltinTools.has("managed_agent.status")).toBe(false);
    expect(surface.callBuiltinTools.has("managed_agent.list")).toBe(false);
    expect(surface.callBuiltinTools.has("managed_agent.join")).toBe(false);
    expect(surface.callBuiltinTools.has("managed_agent.cancel")).toBe(false);
    expect(surface.callBuiltinTools.has("managed_agent.orchestrate")).toBe(false);
  });

  it("uses the same managed invocation surface contract for TUI turns", () => {
    const surface = makeSurface();
    const executeConfig = buildTuiTurnPerCallConfig(
      "codex-oauth",
      "gpt-5.4-mini",
      surface,
      { supportsFunctionTools: true },
      undefined,
      "execute",
    );
    const planConfig = buildTuiTurnPerCallConfig(
      "codex-oauth",
      "gpt-5.4-mini",
      surface,
      { supportsFunctionTools: true },
      undefined,
      "plan",
    );

    expect(executeConfig.toolAllowlist?.has("managed_agent.invoke")).toBe(true);
    expect(executeConfig.toolAllowlist?.has("managed_agent.start")).toBe(true);
    expect(executeConfig.toolAllowlist?.has("managed_agent.status")).toBe(true);
    expect(executeConfig.toolAllowlist?.has("managed_agent.list")).toBe(true);
    expect(executeConfig.toolAllowlist?.has("managed_agent.join")).toBe(true);
    expect(executeConfig.toolAllowlist?.has("managed_agent.cancel")).toBe(true);
    expect(executeConfig.toolAllowlist?.has("managed_agent.orchestrate")).toBe(true);
    expect(executeConfig.toolAuthority?.get("managed_agent.invoke")).toMatchObject({
      allowed: false,
      requiresApproval: true,
    });
    expect(planConfig.toolAllowlist?.has("managed_agent.invoke")).toBe(false);
    expect(planConfig.toolAllowlist?.has("managed_agent.start")).toBe(false);
    expect(planConfig.toolAllowlist?.has("managed_agent.status")).toBe(false);
    expect(planConfig.toolAllowlist?.has("managed_agent.list")).toBe(false);
    expect(planConfig.toolAllowlist?.has("managed_agent.join")).toBe(false);
    expect(planConfig.toolAllowlist?.has("managed_agent.cancel")).toBe(false);
    expect(planConfig.toolAllowlist?.has("managed_agent.orchestrate")).toBe(false);
  });
});
