import { describe, expect, it } from "vitest";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import {
  ManagedCliHarnessAdapter,
  RuntimeManagedAgentInvocationService,
  appendManagedInvocationSessionEvents,
} from "../../src/agents/managed-invocation/index.js";
import { OpenCodeSession } from "../../../cli/src/wrapper/opencode-session.js";
import {
  describeManagedAgentLive,
  expectManagedAgentLiveFilesystemAndEvidence,
  makeManagedAgentLiveHarnessReadOnlyRequest,
  makeManagedAgentLiveHarnessWriteRequest,
  withManagedAgentLiveFixtureWorkspace,
} from "./managed-agent-live-test-harness.js";
import type { CliSessionFactory } from "../../src/execution/cli-session-contract.js";

const KILN_LIVE_OPENCODE_TESTS_ENV = "KILN_LIVE_OPENCODE_TESTS";

const describeOpenCodeLive =
  process.env[KILN_LIVE_OPENCODE_TESTS_ENV] === "1" ? describeManagedAgentLive : describe.skip;

describeOpenCodeLive("managed agent OpenCode live proof", () => {
  it("denies a real OpenCode write attempt under read-only authority", async () => {
    await withManagedAgentLiveFixtureWorkspace({
      prefix: "kiln-managed-agent-opencode-readonly-",
      files: {
        "proof.txt": "before\n",
      },
    }, async (workspace) => {
      const model = process.env.KILN_LIVE_OPENCODE_MODEL ?? "opencode/minimax-m2.5-free";
      const request = makeManagedAgentLiveHarnessReadOnlyRequest({
        invocationId: "invocation-opencode-live-readonly-1",
        workspaceRoot: workspace.workspaceRoot,
        providerId: "opencode",
        model,
        summary: "Attempt a write that Kiln must deny.",
        prompt: [
          "Use the OpenCode edit/write tool to replace proof.txt with exactly:",
          "after",
          "Do not modify any other file.",
        ].join("\n"),
      });
      const adapter = new ManagedCliHarnessAdapter({
        providerId: "opencode",
        model,
        factory: createOpenCodeLiveSessionFactory({
          permissionDefault: "deny",
          model,
        }),
        filesystemBoundary: {
          enabled: true,
          trackedPaths: [workspace.filePath("proof.txt")],
          restoreReadOnlyViolations: true,
        },
      });
      const service = new RuntimeManagedAgentInvocationService();

      const result = await service.invoke(request, adapter);

      expect(result.status).toBe("completed");
      if (result.status !== "completed") {
        throw new Error("Expected completed OpenCode live read-only proof");
      }
      await expect(workspace.readFile("proof.txt")).resolves.toBe("before\n");
      expect(result.record.writeEvidence?.map((evidence) => evidence.kind)).toContain("write-authority-denied");
      expect(JSON.stringify(result.record.writeEvidence)).not.toContain("diff --git");
    });
  }, 180000);

  it("records a real OpenCode approved fixture write as canonical write evidence", async () => {
    await withManagedAgentLiveFixtureWorkspace({
      prefix: "kiln-managed-agent-opencode-write-",
      files: {
        "proof.txt": "before\n",
      },
    }, async (workspace) => {
      const model = process.env.KILN_LIVE_OPENCODE_MODEL ?? "opencode/minimax-m2.5-free";
      const request = makeManagedAgentLiveHarnessWriteRequest({
        invocationId: "invocation-opencode-live-write-1",
        workspaceRoot: workspace.workspaceRoot,
        allowedPaths: [workspace.workspaceRoot],
        providerId: "opencode",
        model,
        summary: "Apply one approved OpenCode fixture write.",
        prompt: [
          "Use the OpenCode edit/write tool to replace proof.txt with exactly:",
          "after",
          "Do not modify any other file.",
        ].join("\n"),
      });
      const adapter = new ManagedCliHarnessAdapter({
        providerId: "opencode",
        model,
        factory: createOpenCodeLiveSessionFactory({
          permissionDefault: "allow",
          model,
        }),
        writeAuthority: {
          proposalSupported: true,
          approvedApplySupported: true,
          memoryProposalSupported: true,
          rollbackEvidence: true,
          cleanupEvidence: true,
          scopeReduction: true,
        },
        filesystemBoundary: {
          enabled: true,
          trackedPaths: [workspace.filePath("proof.txt")],
        },
      });
      const service = new RuntimeManagedAgentInvocationService();

      const result = await service.invoke(request, adapter);

      expect(result.status).toBe("completed");
      if (result.status !== "completed") {
        throw new Error("Expected completed OpenCode live write proof");
      }
      await expectManagedAgentLiveFilesystemAndEvidence({
        workspace,
        relativePath: "proof.txt",
        expectedContents: "after",
        evidence: result.record.writeEvidence ?? [],
        expectedEvidenceKinds: [
          "write-proposal-created",
          "write-proposal-approved",
          "write-attempt-completed",
        ],
        forbiddenInlineText: "diff --git",
      });

      const runtimeSession = new RuntimeSession({
        sessionId: request.parentSessionId,
        appName: "test-app",
        tenantId: "tenant-a",
        userId: "user-1",
        systemPrompt: "test",
      });
      const events = appendManagedInvocationSessionEvents({
        session: runtimeSession,
        request,
        decision: result.decision,
        record: result.record,
        durationMs: 20,
        timestamp: new Date("2026-05-05T12:00:00.000Z"),
      });

      expect(events[2]).toMatchObject({
        managedInvocationEvidence: {
          writeAuthority: request.authority.writeAuthority,
          writeEvidence: result.record.writeEvidence,
        },
      });
    });
  }, 180000);
});

function createOpenCodeLiveSessionFactory(options: {
  readonly permissionDefault: "allow" | "deny";
  readonly model: string;
}): CliSessionFactory {
  return (systemPrompt, cwd) => new OpenCodeSession({
    task: systemPrompt,
    cwd,
    model: options.model,
    permissionDefault: options.permissionDefault,
    sandboxMode: options.permissionDefault === "allow" ? "workspace-write" : "read-only",
    sessionLedgerOwner: "host",
    strictPermissionConfig: true,
  });
}
