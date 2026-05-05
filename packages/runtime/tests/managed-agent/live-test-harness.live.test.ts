import { expect, it } from "vitest";
import {
  collectManagedAgentLiveWriteEvidence,
  normalizeManagedAgentLiveWriteChanges,
} from "../../src/agents/managed-invocation/live-write-event-bridge.js";
import {
  describeManagedAgentLive,
  expectManagedAgentLiveFilesystemAndEvidence,
  makeManagedAgentLiveHarnessWriteRequest,
  withManagedAgentLiveFixtureWorkspace,
} from "./managed-agent-live-test-harness.js";

describeManagedAgentLive("managed agent opt-in live fixture harness", () => {
  it("records filesystem result and canonical write evidence inside an isolated workspace", async () => {
    await withManagedAgentLiveFixtureWorkspace({
      prefix: "kiln-managed-agent-live-opt-in-",
      files: {
        "proof.txt": "before\n",
      },
    }, async (workspace) => {
      const proofPath = workspace.filePath("proof.txt");
      const request = makeManagedAgentLiveHarnessWriteRequest({
        invocationId: "invocation-live-opt-in-1",
        workspaceRoot: workspace.workspaceRoot,
        allowedPaths: [workspace.workspaceRoot],
      });

      await workspace.writeFile("proof.txt", "after\n");

      const fileChanges = normalizeManagedAgentLiveWriteChanges([{
        source: "tool-result",
        path: proofPath,
        changeType: "modified",
        linesAdded: 1,
        linesRemoved: 1,
        diffPreview: "diff --git a/proof.txt b/proof.txt",
        diffTruncated: true,
      }]);
      const result = collectManagedAgentLiveWriteEvidence({
        request,
        fileChanges,
        recordedAt: "2026-05-05T12:00:00.000Z",
      });

      await expectManagedAgentLiveFilesystemAndEvidence({
        workspace,
        relativePath: "proof.txt",
        expectedContents: "after\n",
        evidence: result.evidence,
        expectedEvidenceKinds: [
          "write-proposal-created",
          "write-proposal-approved",
          "write-attempt-completed",
        ],
        forbiddenInlineText: "diff --git",
      });
      expect(result.attemptResourceUris).toEqual([
        "kiln://managed-invocations/invocation-live-opt-in-1/write-attempts/1",
      ]);
    });
  });
});
