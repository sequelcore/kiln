import { describe, expect, it, vi } from "vitest";
import { type ProviderAdapter, type ToolDefinition } from "@kilnai/core/agents";
import { textParts } from "@kilnai/core/engine";
import { EventBus } from "@kilnai/core/events";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import { makeSession } from "./runtime-session-orchestrator-tools-test-fixture.js";

describe("RuntimeSessionOrchestrator - managed recovery and phase transitions", () => {
  it("does not allow a final assistant response while managed invocation recovery needs a work item state transition", async () => {
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn()
        .mockResolvedValueOnce({
          parts: textParts("starting managed visual-reference phase"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "tc-managed", name: "managed_agent.invoke", input: { workItemId: "work-1" } }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("checking local references"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "tc-tree", name: "tree", input: { path: "/workspace/references/t1code" } }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("Blocked before implementation; visual reference evidence was not recorded."),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [],
          stopReason: "end_turn",
        })
        .mockResolvedValueOnce({
          parts: textParts("recording blocked work item state"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{
            id: "tc-update",
            name: "work_item.update",
            input: {
              id: "work-1",
              status: "blocked",
              pauseRequirements: [{
                id: "managed-invocation-handoff-recovery:work-1:recovery-1",
                kind: "operator_input",
                summary: "Managed child completed without substantive phase evidence.",
                status: "pending",
              }],
            },
          }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("Blocked state recorded."),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [],
          stopReason: "end_turn",
        }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const managedInvoke = vi.fn().mockResolvedValue({
      output: JSON.stringify({
        status: "handoff_not_substantive",
        recovery: {
          status: "phase_evidence_required",
          nextTool: "work_item.update",
          workItemId: "work-1",
        },
      }),
      isError: true,
      metadata: {
        toolName: "managed_agent.invoke",
        kind: "managed-invocation",
        status: "handoff_not_substantive",
        managedInvocationRecovery: {
          status: "phase_evidence_required",
          reason: "Managed child completed without substantive phase evidence.",
          nextTool: "work_item.update",
          workItemId: "work-1",
          evidenceToRecord: ["visual-reference-research"],
          requiredToolNames: ["read", "glob", "grep"],
          sourceResourceUris: ["kiln://artifacts/managed-invocations/artifact_3/content"],
          workItemUpdateInputTemplate: {
            id: "work-1",
            providedEvidence: ["visual-reference-research"],
          },
          blockedWorkItemUpdateInputTemplate: {
            id: "work-1",
            status: "blocked",
            pauseRequirements: [{
              id: "managed-invocation-handoff-recovery:work-1:recovery-1",
              kind: "operator_input",
              summary: "Managed child completed without substantive phase evidence.",
              status: "pending",
            }],
          },
          blockedWhen: "Use blockedWorkItemUpdateInputTemplate if sourceResourceUris and local recovery cannot produce qualifying evidence.",
        },
      },
    });
    const tree = vi.fn().mockResolvedValue({
      output: "117 entries under /workspace/references/t1code",
      isError: false,
      metadata: { toolName: "tree", kind: "inspection" },
    });
    const workItemUpdate = vi.fn().mockResolvedValue({
      output: JSON.stringify({
        item: {
          id: "work-1",
          status: "blocked",
          pauseRequirements: [{
            id: "managed-invocation-handoff-recovery:work-1:recovery-1",
            kind: "operator_input",
            summary: "Managed child completed without substantive phase evidence.",
            status: "pending",
          }],
        },
      }),
      isError: false,
      metadata: {
        toolName: "work_item.update",
        kind: "work_item",
        operation: "update",
        id: "work-1",
        status: "blocked",
        item: {
          id: "work-1",
          status: "blocked",
          pauseRequirements: [{
            id: "managed-invocation-handoff-recovery:work-1:recovery-1",
            kind: "operator_input",
            summary: "Managed child completed without substantive phase evidence.",
            status: "pending",
          }],
        },
      },
    });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [
        { name: "managed_agent.invoke", description: "Managed child invocation", inputSchema: {}, tags: new Set() },
        { name: "tree", description: "Inspect directory tree", inputSchema: {}, tags: new Set() },
        { name: "work_item.update", description: "Update governed work item", inputSchema: {}, tags: new Set() },
      ],
      builtinTools: new Map([
        ["managed_agent.invoke", managedInvoke],
        ["tree", tree],
        ["work_item.update", workItemUpdate],
      ]),
      eventBus: new EventBus(100),
      executionEnvelope: { toolRounds: { max: 6 } },
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("improve the GUI"));

    expect(result.parts).toEqual(textParts("Blocked state recorded."));
    expect(provider.createMessage).toHaveBeenCalledTimes(5);
    expect(workItemUpdate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[3]?.[0])).toContain(
      "Managed invocation recovery state transition required",
    );
  });

  it("resolves managed recovery when verification evidence is explicitly skipped with residual risk", async () => {
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn()
        .mockResolvedValueOnce({
          parts: textParts("starting verification"),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "tc-managed", name: "managed_agent.invoke", input: { workItemId: "work-1" } }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("recording governed skips"),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{
            id: "tc-update",
            name: "work_item.update",
            input: {
              id: "work-1",
              skippedVerificationGates: ["tests", "typecheck"],
              residualRisk: "No behavior changed; executable verification was not run.",
            },
          }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("Verification disposition recorded."),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [],
          stopReason: "end_turn",
        }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const managedInvoke = vi.fn().mockResolvedValue({
      output: "Managed route cannot execute bash.",
      isError: true,
      metadata: {
        toolName: "managed_agent.invoke",
        kind: "managed-invocation",
        status: "unavailable",
        managedInvocationRecovery: {
          status: "phase_evidence_required",
          nextTool: "work_item.update",
          workItemId: "work-1",
          evidenceToRecord: ["tests", "typecheck"],
        },
      },
    });
    const item = {
      id: "work-1",
      status: "pending",
      providedEvidence: [],
      skippedVerificationGates: ["tests", "typecheck"],
      verificationGateResults: [
        { gate: "tests", status: "skipped" },
        { gate: "typecheck", status: "skipped" },
      ],
      residualRisk: "No behavior changed; executable verification was not run.",
    };
    const workItemUpdate = vi.fn().mockResolvedValue({
      output: JSON.stringify({ item }),
      isError: false,
      metadata: {
        toolName: "work_item.update",
        kind: "work_item",
        operation: "update",
        id: "work-1",
        item,
      },
    });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [
        { name: "managed_agent.invoke", description: "Managed child invocation", inputSchema: {}, tags: new Set() },
        { name: "work_item.update", description: "Update governed work item", inputSchema: {}, tags: new Set() },
      ],
      builtinTools: new Map([
        ["managed_agent.invoke", managedInvoke],
        ["work_item.update", workItemUpdate],
      ]),
      eventBus: new EventBus(100),
      executionEnvelope: { toolRounds: { max: 4 } },
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("inspect without changes"));

    expect(result.parts).toEqual(textParts("Verification disposition recorded."));
    expect(provider.createMessage).toHaveBeenCalledTimes(3);
    expect(workItemUpdate).toHaveBeenCalledTimes(1);
  });

  it("does not allow a final assistant response while managed invocation phase completion needs a work item update", async () => {
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn()
        .mockResolvedValueOnce({
          parts: textParts("starting managed visual-reference phase"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "tc-managed", name: "managed_agent.invoke", input: { workItemId: "work-ui" } }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("Visual reference research is complete."),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [],
          stopReason: "end_turn",
        })
        .mockResolvedValueOnce({
          parts: textParts("recording child phase evidence"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{
            id: "tc-update",
            name: "work_item.update",
            input: {
              id: "work-ui",
              providedEvidence: ["visual-reference-research"],
            },
          }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("Phase evidence recorded."),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [],
          stopReason: "end_turn",
        }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const managedInvoke = vi.fn().mockResolvedValue({
      output: JSON.stringify({
        status: "completed",
        phaseCompletion: {
          status: "phase_completed_by_child",
          nextTool: "work_item.update",
          workItemId: "work-ui",
          evidenceToRecord: ["visual-reference-research"],
        },
      }),
      isError: false,
      metadata: {
        toolName: "managed_agent.invoke",
        kind: "managed-invocation",
        status: "completed",
        managedInvocationPhaseCompletion: {
          status: "phase_completed_by_child",
          nextTool: "work_item.update",
          workItemId: "work-ui",
          evidenceToRecord: ["visual-reference-research"],
          workItemUpdateInputTemplate: {
            id: "work-ui",
            providedEvidence: ["visual-reference-research"],
          },
        },
      },
    });
    const workItemUpdate = vi.fn().mockResolvedValue({
      output: JSON.stringify({
        item: {
          id: "work-ui",
          providedEvidence: ["visual-reference-research"],
        },
      }),
      isError: false,
      metadata: {
        toolName: "work_item.update",
        kind: "work_item",
        operation: "update",
        id: "work-ui",
        item: {
          id: "work-ui",
          providedEvidence: ["visual-reference-research"],
        },
      },
    });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [
        { name: "managed_agent.invoke", description: "Managed child invocation", inputSchema: {}, tags: new Set() },
        { name: "work_item.update", description: "Update governed work item", inputSchema: {}, tags: new Set() },
      ],
      builtinTools: new Map([
        ["managed_agent.invoke", managedInvoke],
        ["work_item.update", workItemUpdate],
      ]),
      eventBus: new EventBus(100),
      executionEnvelope: { toolRounds: { max: 5 } },
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("improve the GUI"));

    expect(result.parts).toEqual(textParts("Phase evidence recorded."));
    expect(provider.createMessage).toHaveBeenCalledTimes(4);
    expect(workItemUpdate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[2]?.[0])).toContain(
      "Managed invocation phase completion state transition required",
    );
  });

  it("fails closed when managed invocation recovery remains unresolved after the tool-round budget", async () => {
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn()
        .mockResolvedValueOnce({
          parts: textParts("starting managed visual-reference phase"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "tc-managed", name: "managed_agent.invoke", input: { workItemId: "work-1" } }],
          stopReason: "tool_use",
        })
        .mockResolvedValue({
          parts: textParts("I cannot continue without evidence."),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [],
          stopReason: "end_turn",
        }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const managedInvoke = vi.fn().mockResolvedValue({
      output: JSON.stringify({
        status: "handoff_not_substantive",
        recovery: {
          status: "phase_evidence_required",
          nextTool: "work_item.update",
          workItemId: "work-1",
        },
      }),
      isError: true,
      metadata: {
        toolName: "managed_agent.invoke",
        kind: "managed-invocation",
        status: "handoff_not_substantive",
        managedInvocationRecovery: {
          status: "phase_evidence_required",
          nextTool: "work_item.update",
          workItemId: "work-1",
        },
      },
    });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [
        { name: "managed_agent.invoke", description: "Managed child invocation", inputSchema: {}, tags: new Set() },
        { name: "work_item.update", description: "Update governed work item", inputSchema: {}, tags: new Set() },
      ],
      builtinTools: new Map([["managed_agent.invoke", managedInvoke]]),
      eventBus: new EventBus(100),
      executionEnvelope: { toolRounds: { max: 2 } },
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("improve the GUI"));

    expect(result.stopReason).toBe("managed_invocation_state_transition_required");
    expect(result.parts).toEqual(textParts([
      "Managed invocation state transition is still pending after the tool-round budget was exhausted.",
      "Work item work-1 must be transitioned with work_item.update before the governed workflow can continue.",
      "No implementation, verification, or closeout should be treated as complete from this turn.",
    ].join("\n")));
  });

  it("reserves a transition-only round when managed invocation recovery is still pending after normal tool rounds", async () => {
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn()
        .mockResolvedValueOnce({
          parts: textParts("starting managed visual-reference phase"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "tc-managed", name: "managed_agent.invoke", input: { workItemId: "work-1" } }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("inspecting child transcript"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "tc-resource", name: "resource_read", input: { uri: "kiln://artifact/child" } }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("reading local reference files"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "tc-read", name: "read", input: { filePath: "/workspace/references/t1code/apps/web/src/components/Sidebar.tsx" } }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("recording visual reference evidence"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{
            id: "tc-update",
            name: "work_item.update",
            input: {
              id: "work-1",
              providedEvidence: ["visual-reference-research"],
              verificationGateResults: [{
                gate: "visual-reference-research",
                status: "passed",
                summary: "Code-backed frontend evidence from local reference files.",
                evidence: ["/workspace/references/t1code/apps/web/src/components/Sidebar.tsx"],
              }],
            },
          }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("Visual-reference state transition recorded."),
          inputTokens: 25,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [],
          stopReason: "end_turn",
        }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const managedInvoke = vi.fn().mockResolvedValue({
      output: JSON.stringify({ status: "handoff_not_substantive" }),
      isError: true,
      metadata: {
        toolName: "managed_agent.invoke",
        kind: "managed-invocation",
        status: "handoff_not_substantive",
        managedInvocationRecovery: {
          status: "phase_evidence_required",
          reason: "Managed child completed without substantive phase evidence.",
          nextTool: "work_item.update",
          workItemId: "work-1",
          evidenceToRecord: ["visual-reference-research"],
          requiredToolNames: ["read", "glob", "grep"],
          sourceResourceUris: ["kiln://artifact/child"],
          workItemUpdateInputTemplate: {
            id: "work-1",
            providedEvidence: ["visual-reference-research"],
          },
        },
      },
    });
    const resourceRead = vi.fn().mockResolvedValue({
      output: "# Managed child transcript\nNo substantive handoff.",
      isError: false,
      metadata: { toolName: "resource_read", kind: "resource", uri: "kiln://artifact/child" },
    });
    const read = vi.fn().mockResolvedValue({
      output: "export function Sidebar() { return <aside />; }",
      isError: false,
      metadata: {
        toolName: "read",
        kind: "file",
        operation: "read",
        filePath: "/workspace/references/t1code/apps/web/src/components/Sidebar.tsx",
      },
    });
    const workItemUpdate = vi.fn().mockResolvedValue({
      output: JSON.stringify({
        item: {
          id: "work-1",
          status: "pending",
          providedEvidence: ["visual-reference-research"],
        },
      }),
      isError: false,
      metadata: {
        toolName: "work_item.update",
        kind: "work_item",
        operation: "update",
        id: "work-1",
        item: {
          id: "work-1",
          status: "pending",
          providedEvidence: ["visual-reference-research"],
        },
      },
    });
    const eventBus = new EventBus(100);
    const emitSpy = vi.spyOn(eventBus, "emit");
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [
        { name: "managed_agent.invoke", description: "Managed child invocation", inputSchema: {}, tags: new Set() },
        { name: "resource_read", description: "Read managed resources", inputSchema: {}, tags: new Set() },
        { name: "read", description: "Read local files", inputSchema: {}, tags: new Set() },
        { name: "work_item.update", description: "Update governed work item", inputSchema: {}, tags: new Set() },
      ],
      builtinTools: new Map([
        ["managed_agent.invoke", managedInvoke],
        ["resource_read", resourceRead],
        ["read", read],
        ["work_item.update", workItemUpdate],
      ]),
      eventBus,
      executionEnvelope: { toolRounds: { max: 3 } },
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("improve the GUI"));

    expect(result.parts).toEqual(textParts("Visual-reference state transition recorded."));
    expect(result.stopReason).toBe("end_turn");
    expect(provider.createMessage).toHaveBeenCalledTimes(5);
    expect(resourceRead).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(workItemUpdate).toHaveBeenCalledTimes(1);
    expect(
      ((provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[3]?.[0].tools ?? [])
        .map((tool: ToolDefinition) => tool.name),
    ).toEqual(["work_item.update"]);
    expect(JSON.stringify((provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[3]?.[0].messages)).toContain(
      "Managed invocation recovery state transition required",
    );
    expect(JSON.stringify((provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[3]?.[0].messages)).toContain(
      "transition-only reserved tool round",
    );
    expect(emitSpy.mock.calls.some((call) =>
      call[0].type === "error" && JSON.stringify(call[0]).includes("Max tool rounds")
    )).toBe(false);
  });

  it("does not execute non-transition tools during the managed invocation transition reserve", async () => {
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn()
        .mockResolvedValueOnce({
          parts: textParts("starting managed visual-reference phase"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "tc-managed", name: "managed_agent.invoke", input: { workItemId: "work-1" } }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("trying extra inspection while recording evidence"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [
            { id: "tc-read", name: "read", input: { filePath: "/workspace/references/t1code/apps/web/src/components/Sidebar.tsx" } },
            {
              id: "tc-update",
              name: "work_item.update",
              input: {
                id: "work-1",
                providedEvidence: ["visual-reference-research"],
              },
            },
          ],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("Transition recorded without extra inspection."),
          inputTokens: 25,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [],
          stopReason: "end_turn",
        }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const managedInvoke = vi.fn().mockResolvedValue({
      output: JSON.stringify({ status: "handoff_not_substantive" }),
      isError: true,
      metadata: {
        toolName: "managed_agent.invoke",
        kind: "managed-invocation",
        status: "handoff_not_substantive",
        managedInvocationRecovery: {
          status: "phase_evidence_required",
          nextTool: "work_item.update",
          workItemId: "work-1",
          evidenceToRecord: ["visual-reference-research"],
        },
      },
    });
    const read = vi.fn().mockResolvedValue({
      output: "extra read should not happen",
      isError: false,
      metadata: { toolName: "read", kind: "file" },
    });
    const workItemUpdate = vi.fn().mockResolvedValue({
      output: JSON.stringify({
        item: {
          id: "work-1",
          providedEvidence: ["visual-reference-research"],
        },
      }),
      isError: false,
      metadata: {
        toolName: "work_item.update",
        kind: "work_item",
        operation: "update",
        id: "work-1",
        item: {
          id: "work-1",
          providedEvidence: ["visual-reference-research"],
        },
      },
    });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [
        { name: "managed_agent.invoke", description: "Managed child invocation", inputSchema: {}, tags: new Set() },
        { name: "read", description: "Read local files", inputSchema: {}, tags: new Set() },
        { name: "work_item.update", description: "Update governed work item", inputSchema: {}, tags: new Set() },
      ],
      builtinTools: new Map([
        ["managed_agent.invoke", managedInvoke],
        ["read", read],
        ["work_item.update", workItemUpdate],
      ]),
      eventBus: new EventBus(100),
      executionEnvelope: { toolRounds: { max: 1 } },
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("improve the GUI"));

    expect(result.parts).toEqual(textParts("Transition recorded without extra inspection."));
    expect(read).not.toHaveBeenCalled();
    expect(workItemUpdate).toHaveBeenCalledTimes(1);
    expect(result.toolExecutions).toContainEqual(expect.objectContaining({
      toolCallId: "tc-read",
      toolName: "read",
      success: false,
      output: expect.stringContaining("reserved round only permits the required work-item transition"),
    }));
  });

  it("resolves managed invocation recovery when the reserve records a blocked handoff pause", async () => {
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn()
        .mockResolvedValueOnce({
          parts: textParts("starting managed visual-reference phase"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "tc-managed", name: "managed_agent.invoke", input: { workItemId: "work-1" } }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("blocking because no qualifying evidence exists"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{
            id: "tc-update",
            name: "work_item.update",
            input: {
              id: "work-1",
              status: "blocked",
              pauseRequirements: [{
                id: "managed-invocation-handoff-recovery:work-1:recovery-1",
                status: "pending",
              }],
            },
          }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("Blocked recovery transition recorded."),
          inputTokens: 25,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [],
          stopReason: "end_turn",
        }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const managedInvoke = vi.fn().mockResolvedValue({
      output: JSON.stringify({ status: "handoff_not_substantive" }),
      isError: true,
      metadata: {
        toolName: "managed_agent.invoke",
        kind: "managed-invocation",
        status: "handoff_not_substantive",
        managedInvocationRecovery: {
          status: "phase_evidence_required",
          nextTool: "work_item.update",
          workItemId: "work-1",
          evidenceToRecord: ["visual-reference-research"],
          blockedWorkItemUpdateInputTemplate: {
            id: "work-1",
            status: "blocked",
            pauseRequirements: [{
              id: "managed-invocation-handoff-recovery:work-1:recovery-1",
              status: "pending",
            }],
          },
        },
      },
    });
    const workItemUpdate = vi.fn().mockResolvedValue({
      output: JSON.stringify({
        item: {
          id: "work-1",
          status: "blocked",
          pauseRequirements: [{
            id: "managed-invocation-handoff-recovery:work-1:recovery-1",
            status: "pending",
          }],
        },
      }),
      isError: false,
      metadata: {
        toolName: "work_item.update",
        kind: "work_item",
        operation: "update",
        id: "work-1",
        item: {
          id: "work-1",
          status: "blocked",
          pauseRequirements: [{
            id: "managed-invocation-handoff-recovery:work-1:recovery-1",
            status: "pending",
          }],
        },
      },
    });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [
        { name: "managed_agent.invoke", description: "Managed child invocation", inputSchema: {}, tags: new Set() },
        { name: "work_item.update", description: "Update governed work item", inputSchema: {}, tags: new Set() },
      ],
      builtinTools: new Map([
        ["managed_agent.invoke", managedInvoke],
        ["work_item.update", workItemUpdate],
      ]),
      eventBus: new EventBus(100),
      executionEnvelope: { toolRounds: { max: 1 } },
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("improve the GUI"));

    expect(result.parts).toEqual(textParts("Blocked recovery transition recorded."));
    expect(result.stopReason).toBe("end_turn");
    expect(workItemUpdate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[1]?.[0].messages)).toContain(
      "Blocked transition template",
    );
  });

  it("resolves managed invocation recovery when the blocked handoff pause id carries a deterministic per-attempt suffix", async () => {
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn()
        .mockResolvedValueOnce({
          parts: textParts("starting managed visual-reference phase"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "tc-managed", name: "managed_agent.invoke", input: { workItemId: "work-1" } }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("blocking because no qualifying evidence exists"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{
            id: "tc-update",
            name: "work_item.update",
            input: {
              id: "work-1",
              status: "blocked",
              pauseRequirements: [{
                id: "managed-invocation-handoff-recovery:work-1:invocation-9",
                status: "pending",
              }],
            },
          }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("Blocked recovery transition recorded."),
          inputTokens: 25,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [],
          stopReason: "end_turn",
        }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const managedInvoke = vi.fn().mockResolvedValue({
      output: JSON.stringify({ status: "handoff_not_substantive" }),
      isError: true,
      metadata: {
        toolName: "managed_agent.invoke",
        kind: "managed-invocation",
        status: "handoff_not_substantive",
        managedInvocationRecovery: {
          status: "phase_evidence_required",
          nextTool: "work_item.update",
          workItemId: "work-1",
          evidenceToRecord: ["visual-reference-research"],
          blockedWorkItemUpdateInputTemplate: {
            id: "work-1",
            status: "blocked",
            pauseRequirements: [{
              id: "managed-invocation-handoff-recovery:work-1:invocation-9",
              status: "pending",
            }],
          },
        },
      },
    });
    const workItemUpdate = vi.fn().mockResolvedValue({
      output: JSON.stringify({
        item: {
          id: "work-1",
          status: "blocked",
          pauseRequirements: [{
            id: "managed-invocation-handoff-recovery:work-1:invocation-9",
            status: "pending",
          }],
        },
      }),
      isError: false,
      metadata: {
        toolName: "work_item.update",
        kind: "work_item",
        operation: "update",
        id: "work-1",
        item: {
          id: "work-1",
          status: "blocked",
          pauseRequirements: [{
            id: "managed-invocation-handoff-recovery:work-1:invocation-9",
            status: "pending",
          }],
        },
      },
    });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [
        { name: "managed_agent.invoke", description: "Managed child invocation", inputSchema: {}, tags: new Set() },
        { name: "work_item.update", description: "Update governed work item", inputSchema: {}, tags: new Set() },
      ],
      builtinTools: new Map([
        ["managed_agent.invoke", managedInvoke],
        ["work_item.update", workItemUpdate],
      ]),
      eventBus: new EventBus(100),
      executionEnvelope: { toolRounds: { max: 1 } },
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("improve the GUI"));

    expect(result.parts).toEqual(textParts("Blocked recovery transition recorded."));
    expect(result.stopReason).toBe("end_turn");
    expect(workItemUpdate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[1]?.[0].messages)).toContain(
      "Blocked transition template",
    );
  });

  it("resolves managed invocation recovery when a visual-reference gate is blocked with phase-specific pause evidence", async () => {
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn()
        .mockResolvedValueOnce({
          parts: textParts("starting managed visual-reference phase"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "tc-managed", name: "managed_agent.invoke", input: { workItemId: "work-1" } }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("blocking because sibling reference roots are not available to the child"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{
            id: "tc-update",
            name: "work_item.update",
            input: {
              id: "work-1",
              status: "blocked",
              summary: "Visual-reference research is blocked until the child can inspect t1code and vllm-studio.",
              pauseRequirements: [{
                id: "visual-reference-research-recovery",
                kind: "operator_input",
                summary: "Recover visual-reference research with governed read-only reference roots.",
                status: "pending",
              }],
              verificationGateResults: [{
                gate: "visual-reference-research",
                status: "failed",
                summary: "Managed child could not read /workspace/references/t1code or /workspace/references/vllm-studio.",
                evidence: ["/workspace/references/t1code", "/workspace/references/vllm-studio"],
              }],
            },
          }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("Blocked recovery transition recorded."),
          inputTokens: 25,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [],
          stopReason: "end_turn",
        }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const managedInvoke = vi.fn().mockResolvedValue({
      output: JSON.stringify({ status: "handoff_not_substantive" }),
      isError: true,
      metadata: {
        toolName: "managed_agent.invoke",
        kind: "managed-invocation",
        status: "handoff_not_substantive",
        managedInvocationRecovery: {
          status: "phase_evidence_required",
          nextTool: "work_item.update",
          workItemId: "work-1",
          evidenceToRecord: ["visual-reference-research"],
          blockedWorkItemUpdateInputTemplate: {
            id: "work-1",
            status: "blocked",
            pauseRequirements: [{
              id: "managed-invocation-handoff-recovery:work-1:recovery-1",
              status: "pending",
            }],
          },
        },
      },
    });
    const item = {
      id: "work-1",
      status: "blocked",
      pauseRequirements: [{
        id: "visual-reference-research-recovery",
        kind: "operator_input",
        summary: "Recover visual-reference research with governed read-only reference roots.",
        status: "pending",
      }],
      verificationGateResults: [{
        gate: "visual-reference-research",
        status: "failed",
        summary: "Managed child could not read /workspace/references/t1code or /workspace/references/vllm-studio.",
        evidence: ["/workspace/references/t1code", "/workspace/references/vllm-studio"],
      }],
    };
    const workItemUpdate = vi.fn().mockResolvedValue({
      output: JSON.stringify({ item }),
      isError: false,
      metadata: {
        toolName: "work_item.update",
        kind: "work_item",
        operation: "update",
        id: "work-1",
        item,
      },
    });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [
        { name: "managed_agent.invoke", description: "Managed child invocation", inputSchema: {}, tags: new Set() },
        { name: "work_item.update", description: "Update governed work item", inputSchema: {}, tags: new Set() },
      ],
      builtinTools: new Map([
        ["managed_agent.invoke", managedInvoke],
        ["work_item.update", workItemUpdate],
      ]),
      eventBus: new EventBus(100),
      executionEnvelope: { toolRounds: { max: 1 } },
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("improve the GUI"));

    expect(result.parts).toEqual(textParts("Blocked recovery transition recorded."));
    expect(result.stopReason).toBe("end_turn");
    expect(workItemUpdate).toHaveBeenCalledTimes(1);
  });

  it("fails closed before the reserve provider call when the required transition tool is not admitted", async () => {
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn().mockResolvedValueOnce({
        parts: textParts("starting managed visual-reference phase"),
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls: [{ id: "tc-managed", name: "managed_agent.invoke", input: { workItemId: "work-1" } }],
        stopReason: "tool_use",
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const managedInvoke = vi.fn().mockResolvedValue({
      output: JSON.stringify({ status: "handoff_not_substantive" }),
      isError: true,
      metadata: {
        toolName: "managed_agent.invoke",
        kind: "managed-invocation",
        status: "handoff_not_substantive",
        managedInvocationRecovery: {
          status: "phase_evidence_required",
          nextTool: "work_item.update",
          workItemId: "work-1",
          evidenceToRecord: ["visual-reference-research"],
        },
      },
    });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [
        { name: "managed_agent.invoke", description: "Managed child invocation", inputSchema: {}, tags: new Set() },
        { name: "read", description: "Read local files", inputSchema: {}, tags: new Set() },
      ],
      builtinTools: new Map([["managed_agent.invoke", managedInvoke]]),
      eventBus: new EventBus(100),
      executionEnvelope: { toolRounds: { max: 1 } },
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("improve the GUI"));

    expect(result.stopReason).toBe("managed_invocation_state_transition_required");
    expect(provider.createMessage).toHaveBeenCalledTimes(1);
    expect(result.parts).toEqual(textParts([
      "Managed invocation state transition is still pending after the tool-round budget was exhausted.",
      "Work item work-1 must be transitioned with work_item.update before the governed workflow can continue.",
      "No implementation, verification, or closeout should be treated as complete from this turn.",
    ].join("\n")));
  });

  it("reserves a transition-only round for managed invocation phase completion", async () => {
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn()
        .mockResolvedValueOnce({
          parts: textParts("starting managed visual-reference phase"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "tc-managed", name: "managed_agent.invoke", input: { workItemId: "work-ui" } }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("recording child phase evidence"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{
            id: "tc-update",
            name: "work_item.update",
            input: {
              id: "work-ui",
              providedEvidence: ["visual-reference-research"],
            },
          }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("Phase completion transition recorded."),
          inputTokens: 25,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [],
          stopReason: "end_turn",
        }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const managedInvoke = vi.fn().mockResolvedValue({
      output: JSON.stringify({ status: "completed" }),
      isError: false,
      metadata: {
        toolName: "managed_agent.invoke",
        kind: "managed-invocation",
        status: "completed",
        managedInvocationPhaseCompletion: {
          status: "phase_completed_by_child",
          nextTool: "work_item.update",
          workItemId: "work-ui",
          evidenceToRecord: ["visual-reference-research"],
        },
      },
    });
    const workItemUpdate = vi.fn().mockResolvedValue({
      output: JSON.stringify({
        item: {
          id: "work-ui",
          providedEvidence: ["visual-reference-research"],
        },
      }),
      isError: false,
      metadata: {
        toolName: "work_item.update",
        kind: "work_item",
        operation: "update",
        id: "work-ui",
        item: {
          id: "work-ui",
          providedEvidence: ["visual-reference-research"],
        },
      },
    });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [
        { name: "managed_agent.invoke", description: "Managed child invocation", inputSchema: {}, tags: new Set() },
        { name: "work_item.update", description: "Update governed work item", inputSchema: {}, tags: new Set() },
      ],
      builtinTools: new Map([
        ["managed_agent.invoke", managedInvoke],
        ["work_item.update", workItemUpdate],
      ]),
      eventBus: new EventBus(100),
      executionEnvelope: { toolRounds: { max: 1 } },
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("improve the GUI"));

    expect(result.parts).toEqual(textParts("Phase completion transition recorded."));
    expect(workItemUpdate).toHaveBeenCalledTimes(1);
    expect(
      ((provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[1]?.[0].tools ?? [])
        .map((tool: ToolDefinition) => tool.name),
    ).toEqual(["work_item.update"]);
  });

  it("keeps an earlier managed invocation transition pending after a later transition resolves", async () => {
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn()
        .mockResolvedValueOnce({
          parts: textParts("starting two managed visual-reference phases"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [
            { id: "tc-managed-1", name: "managed_agent.invoke", input: { workItemId: "work-1" } },
            { id: "tc-managed-2", name: "managed_agent.invoke", input: { workItemId: "work-2" } },
          ],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("recording the second child only"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{
            id: "tc-update-2",
            name: "work_item.update",
            input: {
              id: "work-2",
              providedEvidence: ["visual-reference-research"],
            },
          }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("done"),
          inputTokens: 25,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [],
          stopReason: "end_turn",
        }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const managedInvoke = vi.fn()
      .mockResolvedValueOnce({
        output: JSON.stringify({ status: "handoff_not_substantive" }),
        isError: true,
        metadata: {
          toolName: "managed_agent.invoke",
          kind: "managed-invocation",
          status: "handoff_not_substantive",
          managedInvocationRecovery: {
            status: "phase_evidence_required",
            nextTool: "work_item.update",
            workItemId: "work-1",
            evidenceToRecord: ["visual-reference-research"],
          },
        },
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({ status: "handoff_not_substantive" }),
        isError: true,
        metadata: {
          toolName: "managed_agent.invoke",
          kind: "managed-invocation",
          status: "handoff_not_substantive",
          managedInvocationRecovery: {
            status: "phase_evidence_required",
            nextTool: "work_item.update",
            workItemId: "work-2",
            evidenceToRecord: ["visual-reference-research"],
          },
        },
      });
    const workItemUpdate = vi.fn().mockResolvedValue({
      output: JSON.stringify({
        item: {
          id: "work-2",
          providedEvidence: ["visual-reference-research"],
        },
      }),
      isError: false,
      metadata: {
        toolName: "work_item.update",
        kind: "work_item",
        operation: "update",
        id: "work-2",
        item: {
          id: "work-2",
          providedEvidence: ["visual-reference-research"],
        },
      },
    });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [
        { name: "managed_agent.invoke", description: "Managed child invocation", inputSchema: {}, tags: new Set() },
        { name: "work_item.update", description: "Update governed work item", inputSchema: {}, tags: new Set() },
      ],
      builtinTools: new Map([
        ["managed_agent.invoke", managedInvoke],
        ["work_item.update", workItemUpdate],
      ]),
      eventBus: new EventBus(100),
      executionEnvelope: { toolRounds: { max: 2 } },
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("improve two GUI areas"));

    expect(result.stopReason).toBe("managed_invocation_state_transition_required");
    expect(result.parts).toEqual(textParts([
      "Managed invocation state transition is still pending after the tool-round budget was exhausted.",
      "Work item work-1 must be transitioned with work_item.update before the governed workflow can continue.",
      "No implementation, verification, or closeout should be treated as complete from this turn.",
    ].join("\n")));
    expect(workItemUpdate).toHaveBeenCalledTimes(1);
  });

  it("does not resolve managed invocation recovery with a same-id work item update that records no required evidence", async () => {
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn()
        .mockResolvedValueOnce({
          parts: textParts("starting managed visual-reference phase"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "tc-managed", name: "managed_agent.invoke", input: { workItemId: "work-1" } }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("updating summary only"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "tc-update-empty", name: "work_item.update", input: { id: "work-1", summary: "Still checking" } }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("Done after summary update."),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [],
          stopReason: "end_turn",
        })
        .mockResolvedValueOnce({
          parts: textParts("recording evidence"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{
            id: "tc-update-evidence",
            name: "work_item.update",
            input: {
              id: "work-1",
              providedEvidence: ["visual-reference-research"],
            },
          }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("Evidence recorded."),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [],
          stopReason: "end_turn",
        }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const managedInvoke = vi.fn().mockResolvedValue({
      output: JSON.stringify({ status: "handoff_not_substantive" }),
      isError: true,
      metadata: {
        toolName: "managed_agent.invoke",
        kind: "managed-invocation",
        status: "handoff_not_substantive",
        managedInvocationRecovery: {
          status: "phase_evidence_required",
          nextTool: "work_item.update",
          workItemId: "work-1",
          evidenceToRecord: ["visual-reference-research"],
        },
      },
    });
    const workItemUpdate = vi.fn()
      .mockResolvedValueOnce({
        output: JSON.stringify({ item: { id: "work-1", status: "pending", providedEvidence: [] } }),
        isError: false,
        metadata: {
          toolName: "work_item.update",
          kind: "work_item",
          operation: "update",
          id: "work-1",
          item: { id: "work-1", status: "pending", providedEvidence: [] },
        },
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          item: {
            id: "work-1",
            status: "pending",
            providedEvidence: ["visual-reference-research"],
          },
        }),
        isError: false,
        metadata: {
          toolName: "work_item.update",
          kind: "work_item",
          operation: "update",
          id: "work-1",
          item: {
            id: "work-1",
            status: "pending",
            providedEvidence: ["visual-reference-research"],
          },
        },
      });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [
        { name: "managed_agent.invoke", description: "Managed child invocation", inputSchema: {}, tags: new Set() },
        { name: "work_item.update", description: "Update governed work item", inputSchema: {}, tags: new Set() },
      ],
      builtinTools: new Map([
        ["managed_agent.invoke", managedInvoke],
        ["work_item.update", workItemUpdate],
      ]),
      eventBus: new EventBus(100),
      executionEnvelope: { toolRounds: { max: 6 } },
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("improve the GUI"));

    expect(result.parts).toEqual(textParts("Evidence recorded."));
    expect(provider.createMessage).toHaveBeenCalledTimes(5);
    expect(workItemUpdate).toHaveBeenCalledTimes(2);
    expect(JSON.stringify((provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[3]?.[0])).toContain(
      "Managed invocation recovery state transition required",
    );
  });
});
