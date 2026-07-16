import { describe, expect, it } from "vitest";
import {
  createManagedInvocationLifecycleToolExecutors,
  RuntimeManagedAgentInvocationService,
  type ManagedInvocationToolAttachment,
} from "../../src/agents/managed-invocation/index.js";
import type { RuntimeBuiltinToolExecutionContext } from "../../src/session/runtime-session-orchestrator.types.js";

describe("managed_agent.orchestrate", () => {
  it("rejects cyclic work graphs before route selection or child start", async () => {
    const result = await execute({
      profile: "foundation-readonly-plan",
      taskRisk: "medium",
      requiresIndependentReview: false,
      workItems: [
        { id: "a", roleIntent: "scout", task: "Inspect A.", dependencies: ["b"] },
        { id: "b", roleIntent: "verifier", task: "Inspect B.", dependencies: ["a"] },
      ],
    });

    expect(result).toMatchObject({ isError: true });
    expect(result.output).toContain("dependencies contain a cycle");
  });

  it("returns the canonical denied decision when runtime capacity is unavailable", async () => {
    const result = await execute({
      profile: "foundation-readonly-plan",
      taskRisk: "low",
      requiresIndependentReview: false,
      workItems: [
        { id: "a", roleIntent: "scout", task: "Inspect A." },
      ],
    });

    expect(result).toMatchObject({
      isError: true,
      metadata: {
        operation: "managed_orchestration_denied",
        coordinationDecision: {
          status: "denied",
          missingCapabilities: ["managed-route", "workspace"],
        },
      },
    });
  });
});

async function execute(input: Record<string, unknown>): Promise<{
  readonly output: string;
  readonly isError: boolean;
  readonly metadata: Record<string, unknown>;
}> {
  const attachment: ManagedInvocationToolAttachment = {
    options: {
      routes: [],
      invocationService: new RuntimeManagedAgentInvocationService(),
      maxParallelChildren: 2,
    },
    callerIdentity: {
      kind: "operator-surface",
      surface: "test",
      attachmentId: "attachment:test",
      evidenceId: "evidence:test",
    },
  };
  const executor = createManagedInvocationLifecycleToolExecutors(attachment)
    .get("managed_agent.orchestrate");
  if (!executor) throw new Error("managed_agent.orchestrate executor was not registered");
  return await executor(input, {
    session: { id: "session-test" } as RuntimeBuiltinToolExecutionContext["session"],
    turnId: "turn-test",
    toolCall: {
      id: "tool-call-test",
      name: "managed_agent.orchestrate",
      input,
    },
  }) as {
    readonly output: string;
    readonly isError: boolean;
    readonly metadata: Record<string, unknown>;
  };
}
