import { expect, it } from "vitest";
import {
  ManagedCliHarnessAdapter,
  ManagedRuntimeCredentialRouteLeaseManager,
  RuntimeManagedAgentInvocationService,
} from "../../src/agents/managed-invocation/index.js";
import { ClaudeSession } from "../../../cli/src/wrapper/claude-code-process.js";
import {
  KILN_LIVE_CLAUDE_TESTS_ENV,
  describeManagedAgentProviderLive,
  makeManagedAgentLiveCapabilitySnapshotInput,
  makeManagedAgentLiveHarnessReadOnlyRequest,
  withManagedAgentLiveFixtureWorkspace,
} from "./managed-agent-live-test-harness.js";
import type { CliSessionFactory } from "../../src/execution/cli-session-contract.js";

describeManagedAgentProviderLive("managed agent Claude Code live proof", KILN_LIVE_CLAUDE_TESTS_ENV, () => {
  it("runs a read-only managed child in Claude plan mode without changing the fixture", async () => {
    await withManagedAgentLiveFixtureWorkspace({
      prefix: "kiln-managed-agent-claude-readonly-",
      files: { "proof.txt": "before\n" },
    }, async (workspace) => {
      const model = process.env.KILN_LIVE_CLAUDE_MODEL ?? "default";
      let observedPermissionMode: "plan" | "default" | undefined;
      const request = makeManagedAgentLiveHarnessReadOnlyRequest({
        invocationId: "invocation-claude-live-readonly-1",
        workspaceRoot: workspace.workspaceRoot,
        providerId: "claude",
        model,
        summary: "Inspect a fixture through Claude Code plan mode.",
        prompt: "Read proof.txt and report its exact contents. Do not write, create, delete, or rename any file.",
      });
      const adapter = new ManagedCliHarnessAdapter({
        providerId: "claude",
        model,
        factory: createClaudeLiveSessionFactory(model, (mode) => { observedPermissionMode = mode; }),
        filesystemBoundary: { enabled: true, trackedPaths: [workspace.filePath("proof.txt")], restoreReadOnlyViolations: true },
      });

      const result = await new RuntimeManagedAgentInvocationService({
        credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
          allowedRouteIds: ["credential-route:claude"],
        }),
      }).invoke(
        request,
        adapter,
        makeManagedAgentLiveCapabilitySnapshotInput(request),
      );

      expect(result.status).toBe("completed");
      expect(result.record.lifecycleState, JSON.stringify(result.record.resultHandoff)).toBe("completed");
      expect(observedPermissionMode).toBe("plan");
      expect(result.record.resultHandoff?.structuredResult).toMatchObject({
        version: "structured-execution-result-v1",
        status: "completed",
      });
      expect(JSON.stringify(result.record.resultHandoff?.structuredResult)).toContain("before");
      await expect(workspace.readFile("proof.txt")).resolves.toBe("before\n");
      expect(result.record.writeEvidence ?? []).toEqual([]);
    });
  }, 240000);
});

function createClaudeLiveSessionFactory(
  model: string,
  observePermissionMode: (mode: "plan" | "default") => void,
): CliSessionFactory {
  return (systemPrompt, cwd, context) => {
    const permissionMode = context?.permissionPolicy?.approval === "untrusted" ? "plan" : "default";
    observePermissionMode(permissionMode);
    return new ClaudeSession({
      task: systemPrompt,
      systemPrompt,
      cwd,
      model,
      permissionMode,
      sessionLedgerOwner: "host",
      ...(context?.structuredOutput ? { structuredOutputSchema: context.structuredOutput.schema } : {}),
    });
  };
}
