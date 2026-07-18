import { describe, expect, it } from "vitest";
import type { ManagedInvocationToolOptionsWithService } from "@kilnai/runtime";
import { createManagedInvocationExecutionProofResolverRef } from "./managed-invocation-attachment.js";

describe("managed invocation execution proof resolver", () => {
  it("admits only completed substantive work-item invocations", () => {
    const ref = createManagedInvocationExecutionProofResolverRef();
    const snapshots = new Map<string, unknown>();
    ref.bind({
      invocationService: {
        status: (invocationId: string) => snapshots.get(invocationId),
      },
    } as unknown as ManagedInvocationToolOptionsWithService);

    snapshots.set("running", snapshot("running"));
    expect(ref.resolve("running")).toBeUndefined();

    snapshots.set("completed", snapshot("completed"));
    expect(ref.resolve("completed")).toEqual({
      invocationId: "completed",
      parentSessionId: "session-1",
      goalRunId: "goal-1",
      workItemId: "work-1",
      resultHandoff: {
        summary: "Verified child result.",
        resourceUris: ["kiln://artifacts/child/handoff"],
        memoryWriteProposalUris: [],
      },
    });
  });
});

function snapshot(lifecycleState: "running" | "completed") {
  return {
    invocationId: lifecycleState,
    parentSessionId: "session-1",
    lifecycleState,
    request: {
      executionScope: {
        kind: "work_item",
        goalRunId: "goal-1",
        workItemId: "work-1",
      },
    },
    ...(lifecycleState === "completed"
      ? {
          record: {
            resultHandoff: {
              summary: "Verified child result.",
              resourceUris: ["kiln://artifacts/child/handoff"],
              memoryWriteProposalUris: [],
            },
          },
        }
      : {}),
  };
}
