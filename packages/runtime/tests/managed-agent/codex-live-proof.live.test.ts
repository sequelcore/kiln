import { expect, it } from "vitest";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import {
  ManagedCliHarnessAdapter,
  ManagedRuntimeCredentialRouteLeaseManager,
  RuntimeManagedAgentInvocationService,
  appendManagedInvocationSessionEvents,
} from "../../src/agents/managed-invocation/index.js";
import { CodexSession } from "../../../cli/src/wrapper/codex-session.js";
import {
  KILN_LIVE_CODEX_TESTS_ENV,
  describeManagedAgentProviderLive,
  expectManagedAgentLiveFilesystemAndEvidence,
  makeManagedAgentLiveCapabilitySnapshotInput,
  makeManagedAgentLiveHarnessReadOnlyRequest,
  makeManagedAgentLiveHarnessWriteRequest,
  withManagedAgentLiveFixtureWorkspace,
} from "./managed-agent-live-test-harness.js";
import type { CliSessionFactory } from "../../src/execution/cli-session-contract.js";

describeManagedAgentProviderLive("managed agent Codex live proof", KILN_LIVE_CODEX_TESTS_ENV, () => {
  it("does not accept a real Codex write attempt under read-only authority", async () => {
    await withManagedAgentLiveFixtureWorkspace({
      prefix: "kiln-managed-agent-codex-readonly-",
      files: {
        "proof.txt": "before\n",
      },
    }, async (workspace) => {
      const model = process.env.KILN_LIVE_CODEX_MODEL ?? "gpt-5.3-codex-spark";
      const request = makeManagedAgentLiveHarnessReadOnlyRequest({
        invocationId: "invocation-codex-live-readonly-1",
        workspaceRoot: workspace.workspaceRoot,
        providerId: "codex",
        model,
        summary: "Attempt a Codex write that Kiln must not accept.",
        prompt: [
          "Attempt exactly one workspace write to proof.txt.",
          "Set proof.txt to the exact contents \"after\\n\" using a shell or MCP bash command if available.",
          "Read proof.txt once afterward and report whether the write was accepted or denied.",
          "Do not modify any other file.",
        ].join("\n"),
      });
      const adapter = new ManagedCliHarnessAdapter({
        providerId: "codex",
        model,
        factory: createCodexLiveSessionFactory({
          approvalMode: "never",
          sandboxMode: "read-only",
          model,
        }),
        filesystemBoundary: {
          enabled: true,
          trackedPaths: [workspace.filePath("proof.txt")],
          restoreReadOnlyViolations: true,
        },
      });
      const service = createCodexLiveInvocationService();

      const result = await service.invoke(request, adapter, makeManagedAgentLiveCapabilitySnapshotInput(request));

      expect(result.status).toBe("completed");
      if (result.status !== "completed") {
        throw new Error("Expected completed Codex live read-only proof");
      }
      await expect(workspace.readFile("proof.txt")).resolves.toBe("before\n");
      expect(result.record.writeEvidence?.some((evidence) =>
        evidence.kind === "write-proposal-approved" || evidence.kind === "write-attempt-completed",
      ) ?? false).toBe(false);
      expect(JSON.stringify(result.record.writeEvidence ?? [])).not.toContain("diff --git");
    });
  }, 240000);

  it("records a real Codex approved fixture write as canonical write evidence", async () => {
    await withManagedAgentLiveFixtureWorkspace({
      prefix: "kiln-managed-agent-codex-write-",
      files: {
        "proof.txt": "before\n",
      },
    }, async (workspace) => {
      const model = process.env.KILN_LIVE_CODEX_MODEL ?? "gpt-5.3-codex-spark";
      const request = makeManagedAgentLiveHarnessWriteRequest({
        invocationId: "invocation-codex-live-write-1",
        workspaceRoot: workspace.workspaceRoot,
        allowedPaths: [workspace.workspaceRoot],
        providerId: "codex",
        model,
        summary: "Apply one approved Codex fixture write.",
        prompt: [
          "Overwrite proof.txt so its exact contents are \"after\\n\".",
          "Use a shell or MCP bash command if needed.",
          "Read proof.txt afterward and confirm the file contains exactly \"after\\n\".",
          "Do not modify any other file.",
        ].join("\n"),
      });
      const adapter = new ManagedCliHarnessAdapter({
        providerId: "codex",
        model,
        factory: createCodexLiveSessionFactory({
          approvalMode: "never",
          sandboxMode: "workspace-write",
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
      const service = createCodexLiveInvocationService();

      const result = await service.invoke(request, adapter, makeManagedAgentLiveCapabilitySnapshotInput(request));

      expect(result.status).toBe("completed");
      if (result.status !== "completed") {
        throw new Error("Expected completed Codex live write proof");
      }
      await expectManagedAgentLiveFilesystemAndEvidence({
        workspace,
        relativePath: "proof.txt",
        expectedContents: "after\n",
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
        timestamp: new Date("2026-05-06T12:00:00.000Z"),
      });

      expect(events[2]).toMatchObject({
        managedInvocationEvidence: {
          writeEvidence: result.record.writeEvidence,
        },
      });
      expect(JSON.stringify(events[2].managedInvocationEvidence?.writeAuthority)).toContain(
        `kiln://managed-agents/invocations/${request.invocationId}/resources/write`,
      );
      expect(JSON.stringify(events[2].managedInvocationEvidence?.writeAuthority)).toContain(
        `kiln://managed-agents/invocations/${request.invocationId}/resources/approval`,
      );
    });
  }, 240000);
});

function createCodexLiveSessionFactory(options: {
  readonly approvalMode: "never";
  readonly sandboxMode: "read-only" | "workspace-write";
  readonly model: string;
}): CliSessionFactory {
  return (systemPrompt, cwd) => new CodexSession({
    task: systemPrompt,
    cwd,
    model: options.model,
    approvalMode: options.approvalMode,
    sandboxMode: options.sandboxMode,
    skipGitRepoCheck: true,
    ephemeral: true,
    sessionLedgerOwner: "host",
    reasoningEffort: "low",
  });
}

function createCodexLiveInvocationService(): RuntimeManagedAgentInvocationService {
  return new RuntimeManagedAgentInvocationService({
    credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
      allowedRouteIds: ["credential-route:codex"],
    }),
  });
}
