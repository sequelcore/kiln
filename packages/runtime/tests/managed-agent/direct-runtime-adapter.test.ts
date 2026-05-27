import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentResponse,
  ProviderAdapter,
  ToolDefinition,
} from "@kilnai/core";
import {
  AllCredentialsExhaustedError,
  createSessionBuiltinToolOptions,
  defineManagedAgentInvocationRequest,
  textParts,
} from "@kilnai/core";
import {
  ManagedRuntimeSandboxLeaseManager,
  RuntimeManagedAgentInvocationService,
} from "../../src/agents/managed-invocation/index.js";
import { ManagedDirectProviderRuntimeAdapter } from "../../src/agents/managed-invocation/direct-runtime-adapter.js";
import { createAttachedRuntimeBuiltinToolSurface } from "../../src/gateway/attached-runtime-tool-surface.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import type { RuntimeBuiltinToolExecutor } from "../../src/session/runtime-session-orchestrator.types.js";

const READ_TOOL: ToolDefinition = {
  name: "read",
  description: "Read a governed resource.",
  inputSchema: {},
  tags: new Set(["read"]),
};

const WRITE_TOOL: ToolDefinition = {
  name: "write",
  description: "Write a governed resource.",
  inputSchema: {},
  tags: new Set(["write"]),
};

const LIVE_PROVEN_DIRECT_WRITE_AUTHORITY = {
  proposalSupported: true,
  approvedApplySupported: true,
  memoryProposalSupported: true,
  rollbackEvidence: true,
  cleanupEvidence: true,
  scopeReduction: true,
} as const;

function response(
  text: string,
  toolCalls: AgentResponse["toolCalls"] = [],
): AgentResponse {
  return {
    parts: textParts(text),
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 1,
    cacheWriteTokens: 0,
    toolCalls,
    stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
  };
}

function providerWithResponses(responses: readonly AgentResponse[]): ProviderAdapter {
  let index = 0;
  return {
    name: "openai",
    createMessage: vi.fn(async () => responses[Math.min(index++, responses.length - 1)]!),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function request(overrides: Partial<Parameters<typeof defineManagedAgentInvocationRequest>[0]> = {}) {
  return defineManagedAgentInvocationRequest({
    invocationId: "inv-direct-1",
    agentId: "direct-readonly:foundation-readonly-plan",
    parentSessionId: "parent-session",
    parentTurnId: "parent-session:turn:1",
    profile: "foundation-readonly-plan",
    requestedBy: "assistant",
    requestSource: "test",
    providerRoute: {
      providerId: "openai",
      surface: "direct-provider",
      model: "gpt-test",
    },
    adapterKind: "direct",
    executionMode: "direct-provider",
    authority: {
      authorityProfileId: "authority:direct-readonly:foundation-readonly-plan",
      permissionProfile: "read-only",
      toolAuthority: {
        allowedToolNames: ["read"],
        writeAllowed: false,
        networkAllowed: false,
      },
      workingDirectory: {
        path: "C:/repo",
        mode: "read-only",
      },
      timeoutMs: 5000,
      credentialRoute: {
        mode: "credentialless",
      },
      memoryScope: {
        scope: { kind: "project", id: "repo" },
        access: "read-only",
      },
    },
    input: {
      summary: "Inspect docs.",
      prompt: "Read the docs and summarize risks.",
    },
    ...overrides,
  });
}

describe("ManagedDirectProviderRuntimeAdapter", () => {
  it("runs a child RuntimeSessionOrchestrator and returns the shared managed invocation record shape", async () => {
    const provider = providerWithResponses([
      response("reading", [{ id: "tool-1", name: "read", input: { uri: "kiln://docs/a" } }]),
      response("Direct child completed."),
    ]);
    const readTool = vi.fn(async () => "doc contents");
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map([["read", readTool]]),
    });
    const service = new RuntimeManagedAgentInvocationService();

    const result = await service.invoke(request(), adapter);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("expected completed");
    }
    expect(readTool).toHaveBeenCalledWith(
      { uri: "kiln://docs/a" },
      expect.objectContaining({ sandbox: expect.any(Object) }),
    );
    expect(provider.createMessage).toHaveBeenCalledTimes(2);
    expect(result.record).toMatchObject({
      invocationId: "inv-direct-1",
      lifecycleState: "completed",
      adapterKind: "direct",
      executionMode: "direct-provider",
      providerRoute: {
        providerId: "openai",
        surface: "direct-provider",
        model: "gpt-test",
      },
      childSessionId: "parent-session:managed:inv-direct-1",
      resultHandoff: {
        summary: "Direct child completed.",
        resourceUris: ["kiln://managed-agents/invocations/inv-direct-1/transcript"],
        memoryWriteProposalUris: [],
      },
      usage: {
        source: "runtime",
        tokenClasses: [
          { name: "input", value: 20 },
          { name: "output", value: 10 },
          { name: "cache_read", value: 2 },
          { name: "cache_write", value: 0 },
        ],
      },
    });
  });

  it("keeps long direct-provider child output bounded while exposing the full result as a managed resource", async () => {
    const fullResultBody = Array.from({ length: 90 }, (_, index) =>
      `finding-${String(index).padStart(2, "0")}: actionable managed-agent review detail with exact evidence and correction.`
    ).join("\n");
    const fullResult = `\n\n${fullResultBody}\n\n`;
    const extractedResult = fullResult.trim();
    const provider = providerWithResponses([response(fullResult)]);
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [],
      builtinTools: new Map(),
    });

    const result = await new RuntimeManagedAgentInvocationService().invoke(request(), adapter);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("expected completed");
    }
    expect(result.record.resultHandoff?.summary.length).toBeLessThanOrEqual(2000);
    expect(result.record.resultHandoff?.summary).toContain("Full child result is available through the managed invocation result resource.");
    expect(result.record.resultHandoff?.summary).not.toContain("finding-89");
    expect(result.record.resultHandoff?.resourceUris).toEqual([
      "kiln://managed-agents/invocations/inv-direct-1/transcript",
      "kiln://managed-agents/invocations/inv-direct-1/resources/result/final",
    ]);
    expect(result.record.replayResources).toEqual([{
      uri: "kiln://managed-agents/invocations/inv-direct-1/resources/result/final",
      title: "Managed invocation final result",
      mimeType: "text/markdown",
      text: extractedResult,
    }]);
  });

  it("hydrates admitted resource context through resource_read without broadening child tool authority", async () => {
    const provider = providerWithResponses([
      response("Resource context summarized."),
    ]);
    const resourceReadTool = vi.fn(async () => ({
      output: "# Managed Invocation Transcript\n\nChild transcript body.",
      isError: false,
      metadata: {
        toolName: "resource_read",
        kind: "resource",
        operation: "read",
        uri: "kiln://managed-agents/invocations/child-1/transcript",
      },
    }));
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map([["resource_read", resourceReadTool]]),
    });
    const service = new RuntimeManagedAgentInvocationService();

    const result = await service.invoke(request({
      input: {
        summary: "Summarize a managed resource.",
        prompt: "Summarize the supplied resource.",
        resourceUris: ["kiln://managed-agents/invocations/child-1/transcript"],
        context: {
          mode: "resources",
        },
      },
    }), adapter);

    expect(result.status).toBe("completed");
    expect(resourceReadTool).toHaveBeenCalledWith(
      {
        uri: "kiln://managed-agents/invocations/child-1/transcript",
      },
      expect.objectContaining({
        session: expect.any(RuntimeSession),
        toolCall: expect.objectContaining({
          name: "resource_read",
        }),
      }),
    );
    const firstProviderCall = (provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      system: string;
      tools?: readonly ToolDefinition[];
    };
    expect(firstProviderCall.system).toContain("kiln://managed-agents/invocations/child-1/transcript");
    expect(firstProviderCall.system).toContain("Child transcript body.");
    expect(firstProviderCall.tools?.map((tool) => tool.name)).not.toContain("resource_read");
  });

  it("hydrates admitted resource context from a late-bound builtin tool surface", async () => {
    const provider = providerWithResponses([
      response("Late resource context summarized."),
    ]);
    const resourceReadTool = vi.fn(async () => ({
      output: "# Late Managed Invocation Transcript\n\nLate child transcript body.",
      isError: false,
      metadata: {
        toolName: "resource_read",
        kind: "resource",
        operation: "read",
        uri: "kiln://managed-agents/invocations/child-late/transcript",
      },
    }));
    let runtimeBuiltinTools: ReadonlyMap<string, RuntimeBuiltinToolExecutor> = new Map();
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map(),
      builtinToolsProvider: () => runtimeBuiltinTools,
    });
    runtimeBuiltinTools = new Map([["resource_read", resourceReadTool]]);
    const service = new RuntimeManagedAgentInvocationService();

    const result = await service.invoke(request({
      input: {
        summary: "Summarize a late managed resource.",
        prompt: "Summarize the supplied late resource.",
        resourceUris: ["kiln://managed-agents/invocations/child-late/transcript"],
        context: {
          mode: "resources",
        },
      },
    }), adapter);

    expect(result.status).toBe("completed");
    expect(resourceReadTool).toHaveBeenCalledWith(
      {
        uri: "kiln://managed-agents/invocations/child-late/transcript",
      },
      expect.objectContaining({
        session: expect.any(RuntimeSession),
        toolCall: expect.objectContaining({
          name: "resource_read",
        }),
      }),
    );
    const firstProviderCall = (provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      system: string;
      tools?: readonly ToolDefinition[];
    };
    expect(firstProviderCall.system).toContain("kiln://managed-agents/invocations/child-late/transcript");
    expect(firstProviderCall.system).toContain("Late child transcript body.");
    expect(firstProviderCall.tools?.map((tool) => tool.name)).not.toContain("resource_read");
  });

  it("keeps read-only authority from executing unlisted write tools", async () => {
    const provider = providerWithResponses([
      response("writing", [{ id: "tool-1", name: "write", input: { path: "x", content: "bad" } }]),
      response("Write was denied."),
    ]);
    const writeTool = vi.fn(async () => "wrote");
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [READ_TOOL, WRITE_TOOL],
      builtinTools: new Map([["write", writeTool]]),
    });
    const service = new RuntimeManagedAgentInvocationService();

    const result = await service.invoke(request(), adapter);

    expect(result.status).toBe("completed");
    expect(writeTool).not.toHaveBeenCalled();
    const secondCall = (provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as {
      messages: Array<{ role: string; parts: Array<{ type: string; content?: string }> }>;
    };
    const toolResult = secondCall.messages.at(-1)?.parts[0];
    expect(toolResult?.content).toContain('Tool "write" is not available');
  });

  it("admits explicit apply-approved direct-provider writes and records write evidence", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "kiln-direct-child-write-"));
    const targetPath = join(workspaceRoot, "direct-write.txt");
    const content = "DIRECT_CHILD_WRITE_MARKER\n";
    const provider = providerWithResponses([
      response("writing", [{
        id: "tool-1",
        name: "write",
        input: {
          filePath: targetPath,
          content,
        },
      }]),
      response("Direct child applied the approved workspace write."),
    ]);
    const writeTool = vi.fn(async (input: Record<string, unknown>) => {
      writeFileSync(String(input.filePath), String(input.content), "utf8");
      return {
        output: "wrote direct-write.txt",
        metadata: {
          toolName: "write",
          kind: "file",
          operation: "write",
          filePath: targetPath,
          changeType: "created",
          linesAdded: 1,
          linesRemoved: 0,
          diffPreview: `+ ${content.trimEnd()}`,
          diffTruncated: false,
        },
      };
    });
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "codex-oauth",
      model: "gpt-test",
      provider,
      tools: [WRITE_TOOL],
      builtinTools: new Map([["write", writeTool]]),
      writeAuthority: LIVE_PROVEN_DIRECT_WRITE_AUTHORITY,
    });
    const service = new RuntimeManagedAgentInvocationService();

    try {
      expect(adapter.descriptor).toMatchObject({
        supportedProfiles: [
          "foundation-readonly-plan",
          "foundation-propose-writes",
          "foundation-apply-approved-writes",
          "foundation-memory-write-proposals",
        ],
        writeAuthority: LIVE_PROVEN_DIRECT_WRITE_AUTHORITY,
      });

      const result = await service.invoke(request({
        agentId: "direct-write:foundation-apply-approved-writes",
        profile: "foundation-apply-approved-writes",
        providerRoute: {
          providerId: "codex-oauth",
          surface: "direct-provider",
          model: "gpt-test",
        },
        authority: {
          ...request().authority,
          permissionProfile: "apply-approved-writes",
          toolAuthority: {
            allowedToolNames: ["write"],
            writeAllowed: true,
            networkAllowed: false,
          },
          workingDirectory: {
            path: workspaceRoot,
            mode: "workspace-write",
          },
          writeAuthority: {
            profile: "foundation-apply-approved-writes",
            scope: {
              workspace: {
                mode: "apply-approved",
                allowedPaths: [workspaceRoot],
                deniedPaths: [],
              },
              memory: {
                mode: "none",
                operations: [],
              },
              artifacts: {
                mode: "none",
                resourceUris: [],
                retention: "none",
              },
              tools: {
                allowedToolNames: ["write"],
                deniedToolNames: [],
              },
            },
            approval: {
              mode: "required-before-apply",
              evidenceRequired: true,
            },
          },
          memoryScope: {
            scope: { kind: "project", id: "direct-write-test" },
            access: "write-proposals",
          },
        },
        input: {
          summary: "Apply an approved direct write.",
          prompt: "Write the admitted file and report completion.",
        },
      }), adapter);

      expect(result.status).toBe("completed");
      if (result.status !== "completed") {
        throw new Error("expected completed");
      }
      expect(writeTool).toHaveBeenCalledWith(
        { filePath: targetPath, content },
        expect.objectContaining({
          sandbox: expect.objectContaining({
            policy: expect.objectContaining({
              config: expect.objectContaining({
                fsPolicy: "read-write",
                allowedPaths: [workspaceRoot],
              }),
            }),
          }),
        }),
      );
      expect(result.record.lifecycleState).toBe("completed");
      expect(result.record.writeEvidence?.map((evidence) => evidence.kind)).toEqual([
        "write-proposal-created",
        "write-proposal-approved",
        "write-attempt-completed",
      ]);
      expect(result.record.resultHandoff?.resourceUris).toContain(
        "kiln://managed-agents/invocations/inv-direct-1/resources/write-attempts/1",
      );
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("records a failed invocation when the child provider fails", async () => {
    const provider: ProviderAdapter = {
      name: "openai",
      createMessage: vi.fn(async () => {
        throw new Error("provider exploded");
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map(),
    });

    const result = await new RuntimeManagedAgentInvocationService().invoke(request(), adapter);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("expected completed");
    }
    expect(result.record.lifecycleState).toBe("failed");
    expect(result.record.resultHandoff?.summary).toContain("Direct provider managed invocation failed for provider openai, model gpt-test.");
    expect(result.record.diagnostics).toEqual([{
      uri: "kiln://managed-agents/invocations/inv-direct-1/resources/failure",
      kind: "failure",
    }]);
  });

  it("records credential pool exhaustion with provider, model, and last outcome details", async () => {
    const provider: ProviderAdapter = {
      name: "openai",
      createMessage: vi.fn(async () => {
        throw new AllCredentialsExhaustedError(
          new Error("model endpoint returned 429"),
          { type: "rate-limited", resetAt: Date.parse("2026-05-19T23:30:00.000Z") },
        );
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "codex-oauth",
      model: "gpt-5.4-mini",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map(),
    });

    const result = await new RuntimeManagedAgentInvocationService().invoke(request({
      providerRoute: {
        providerId: "codex-oauth",
        surface: "direct-provider",
        model: "gpt-5.4-mini",
      },
    }), adapter);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("expected completed");
    }
    expect(result.record.lifecycleState).toBe("failed");
    expect(result.record.resultHandoff?.summary).toContain("provider codex-oauth");
    expect(result.record.resultHandoff?.summary).toContain("model gpt-5.4-mini");
    expect(result.record.resultHandoff?.summary).toContain("last outcome rate-limited until 2026-05-19T23:30:00.000Z");
    expect(result.record.resultHandoff?.summary).toContain("last error model endpoint returned 429");
  });

  it("returns a timed-out invocation record when the child runtime exceeds authority timeout", async () => {
    let observedSignal: AbortSignal | undefined;
    let abortObserved = false;
    const provider: ProviderAdapter = {
      name: "openai",
      createMessage: vi.fn((options) => {
        observedSignal = options.signal;
        return new Promise<AgentResponse>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            abortObserved = true;
            reject(new Error("provider request aborted"));
          }, { once: true });
        });
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map(),
    });

    const result = await new RuntimeManagedAgentInvocationService().invoke(request({
      authority: {
        ...request().authority,
        timeoutMs: 1,
      },
    }), adapter);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("expected completed");
    }
    expect(result.record.lifecycleState).toBe("timed_out");
    expect(result.record.diagnostics).toEqual([{
      uri: "kiln://managed-agents/invocations/inv-direct-1/resources/timeout",
      kind: "timeout",
    }]);
    expect(result.record.resultHandoff?.resourceUris).toEqual([
      "kiln://managed-agents/invocations/inv-direct-1/transcript",
      "kiln://managed-agents/invocations/inv-direct-1/resources/timeout",
    ]);
    expect(result.record.resultHandoff?.summary).toContain("timed out after 1ms");
    expect(result.record.resultHandoff?.summary).toContain(result.record.childSessionId);
    expect(result.record.resultHandoff?.summary).toContain("No completed child handoff was produced before timeout");
    expect(result.record.resultHandoff?.summary).toContain("Inspect the transcript and timeout diagnostic resources");
    expect(observedSignal).toBeDefined();
    expect(observedSignal?.aborted).toBe(true);
    expect(abortObserved).toBe(true);
  });

  it("records external cancellation as a cancelled direct-provider invocation with evidence", async () => {
    let observedSignal: AbortSignal | undefined;
    const provider: ProviderAdapter = {
      name: "openai",
      createMessage: vi.fn((options) => {
        observedSignal = options.signal;
        return new Promise<AgentResponse>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new Error("provider request aborted"));
          }, { once: true });
        });
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [READ_TOOL],
      builtinTools: new Map(),
    });
    const service = new RuntimeManagedAgentInvocationService();
    const started = await service.start(request(), adapter);

    expect(started.status).toBe("started");
    await flushMicrotasks();

    const cancelled = await service.cancel("inv-direct-1", "Operator stopped direct child.");
    await flushMicrotasks();

    expect(cancelled.record.lifecycleState).toBe("cancelled");
    expect(observedSignal?.aborted).toBe(true);
    expect(service.status("inv-direct-1")).toMatchObject({
      lifecycleState: "cancelled",
      record: {
        lifecycleState: "cancelled",
        transcript: {
          uri: "kiln://managed-agents/invocations/inv-direct-1/transcript",
        },
        resultHandoff: {
          summary: "Operator stopped direct child.",
          resourceUris: ["kiln://managed-agents/invocations/inv-direct-1/transcript"],
        },
      },
    });
    expect(service.status("inv-direct-1")?.error).toBeUndefined();
  });

  it("integrates through managed_agent.invoke with Kiln builtin tools and returns only bounded handoff", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "kiln-direct-child-"));
    const docPath = join(tmpDir, "managed-agent-risk.txt");
    const childOnlyMarker = "INTERNAL_DIRECT_CHILD_EVIDENCE";
    writeFileSync(
      docPath,
      `Managed agent direct-provider integration fixture.\n${childOnlyMarker}\nRisk: retain bounded handoff only.\n`,
      "utf8",
    );
    const provider: ProviderAdapter = {
      name: "openai",
      createMessage: vi.fn(async (input) => {
        const serializedInput = JSON.stringify(input);
        if (!serializedInput.includes(childOnlyMarker)) {
          return response("reading governed fixture", [{
            id: "read-fixture-1",
            name: "read",
            input: {
              filePath: docPath,
              limit: 3,
            },
          }]);
        }
        return response("Direct child found one bounded managed-agent risk.");
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const childSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: createSessionBuiltinToolOptions(),
    });
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-5.4-mini",
      provider,
      tools: childSurface.toolDefinitions,
      builtinTools: childSurface.callBuiltinTools,
      capabilityMap: childSurface.capabilities,
      toolAuthority: childSurface.toolAuthority,
    });
    const parentSurface = createAttachedRuntimeBuiltinToolSurface({
      managedInvocation: {
        routes: [{
          routeId: "openai-direct-readonly",
          providerId: "openai",
          model: "gpt-5.4-mini",
          adapter,
          surface: "direct-provider",
          profiles: {
            "foundation-readonly-plan": {
              authorityProfileId: "authority:openai-direct-readonly:foundation-readonly-plan",
              permissionProfile: "read-only",
              allowedToolNames: ["read"],
              writeAllowed: false,
              networkAllowed: false,
              workingDirectory: {
                path: tmpDir,
                mode: "read-only",
              },
              timeoutMs: 5000,
              credentialRoute: {
                mode: "runtime-selected",
                routeId: "credential-route:openai:runtime-selected",
              },
              memoryScope: {
                scope: { kind: "project", id: "direct-child-test" },
                access: "read-only",
              },
            },
          },
        }],
      },
    });
    const parentSession = new RuntimeSession({
      sessionId: "parent-direct-session",
      appName: "managed-agent-test",
      tenantId: "tenant-a",
      userId: "operator-1",
      systemPrompt: "test",
    });
    parentSession.addUserMessage(textParts("Delegate direct child fixture review."));

    try {
      const result = await parentSurface.callBuiltinTools.get("managed_agent.invoke")?.({
        profile: "foundation-readonly-plan",
        routeId: "openai-direct-readonly",
        providerRoute: {
          providerId: "openai",
          model: "gpt-5.4-mini",
        },
        task: "Read the admitted fixture and report bounded managed-agent risks.",
      }, {
        session: parentSession,
        toolCall: {
          id: "managed-direct-tool-call-1",
          name: "managed_agent.invoke",
          input: {},
        },
      }) as {
        readonly output: string;
        readonly isError: boolean;
        readonly metadata: Record<string, unknown>;
      };

      expect(result.isError).toBe(false);
      expect(result.output).toContain("Direct child found one bounded managed-agent risk.");
      expect(result.output).not.toContain(childOnlyMarker);
      expect(provider.createMessage).toHaveBeenCalledTimes(2);
      expect(JSON.stringify((provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[1]?.[0]))
        .toContain(childOnlyMarker);
      expect(parentSession.sessionEvents.map((event) => event.kind)).toEqual([
        "agent_invocation_requested",
        "agent_invocation_started",
        "agent_invocation_completed",
      ]);
      const terminalEvent = parentSession.sessionEvents[2];
      expect(terminalEvent).toMatchObject({
        resultSummary: "Direct child found one bounded managed-agent risk.",
        managedInvocationEvidence: {
          childSessionId: expect.stringContaining("parent-direct-session:managed:"),
        },
      });
      expect(JSON.stringify(terminalEvent)).not.toContain(childOnlyMarker);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("applies managed working-directory sandbox to direct-provider builtin file tools", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "kiln-direct-child-workspace-"));
    const outsideRoot = mkdtempSync(join(tmpdir(), "kiln-direct-child-outside-"));
    const outsidePath = join(outsideRoot, "outside-secret.txt");
    const outsideMarker = "OUTSIDE_DIRECT_CHILD_MARKER";
    writeFileSync(outsidePath, outsideMarker, "utf8");
    const provider: ProviderAdapter = {
      name: "openai",
      createMessage: vi.fn(async (input) => {
        const serializedInput = JSON.stringify(input);
        if (!serializedInput.includes("Read access denied")) {
          return response("reading outside file", [{
            id: "read-outside-1",
            name: "read",
            input: {
              filePath: outsidePath,
            },
          }]);
        }
        return response("Outside read was denied by the managed sandbox.");
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const childSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: createSessionBuiltinToolOptions(),
    });
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: childSurface.toolDefinitions,
      builtinTools: childSurface.callBuiltinTools,
      capabilityMap: childSurface.capabilities,
      toolAuthority: childSurface.toolAuthority,
    });

    try {
      const result = await new RuntimeManagedAgentInvocationService({
        sandboxLeaseManager: new ManagedRuntimeSandboxLeaseManager(),
      }).invoke(request({
        authority: {
          ...request().authority,
          workingDirectory: {
            path: workspaceRoot,
            mode: "sandbox",
          },
        },
        input: {
          summary: "Attempt an out-of-scope read.",
          prompt: "Read the requested file and report the result.",
        },
      }), adapter);

      expect(result.status).toBe("completed");
      if (result.status !== "completed") {
        throw new Error("expected completed");
      }
      expect(result.record.resultHandoff?.summary).toBe("Outside read was denied by the managed sandbox.");
      expect(provider.createMessage).toHaveBeenCalledTimes(2);
      const secondCall = JSON.stringify((provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[1]?.[0]);
      expect(secondCall).toContain("Read access denied");
      expect(secondCall).not.toContain(outsideMarker);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it("admits explicit resource URI context with DefaultContextGovernor audit", async () => {
    const provider: ProviderAdapter = {
      name: "openai",
      createMessage: vi.fn(async (input) => {
        expect(JSON.stringify(input)).toContain("kiln://artifacts/managed-invocations/example/content");
        return response("Resource context was admitted.");
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const adapter = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [],
      builtinTools: new Map(),
    });

    const result = await new RuntimeManagedAgentInvocationService().invoke(request({
      input: {
        summary: "Read admitted resource.",
        prompt: "Use the admitted resource URI.",
        resourceUris: ["kiln://artifacts/managed-invocations/example/content"],
        context: {
          mode: "resources",
        },
      },
    }), adapter);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("expected completed");
    }
    expect(result.record.lifecycleState).toBe("completed");
    expect(result.record.resultHandoff?.summary).toBe("Resource context was admitted.");
  });
});
