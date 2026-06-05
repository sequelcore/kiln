import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV,
  KILN_LIVE_CODEX_TESTS_ENV,
  KILN_LIVE_MANAGED_AGENT_TESTS_ENV,
  KILN_LIVE_OPENCODE_TESTS_ENV,
  KILN_LIVE_OPENAI_DIRECT_TESTS_ENV,
  expectManagedAgentLiveFilesystemAndEvidence,
  isManagedAgentLiveTestsEnabled,
  isManagedAgentProviderLiveTestsEnabled,
  withManagedAgentLiveFixtureWorkspace,
} from "./managed-agent-live-test-harness.js";
import { defineManagedAgentWriteEvidence } from "@kilnai/core";
import { evaluateManagedAgentLivePreflight } from "../../../../scripts/managed-agent-live-preflight.js";

describe("managed agent live test harness", () => {
  it("is disabled unless the explicit live test environment flag is set", () => {
    expect(isManagedAgentLiveTestsEnabled({})).toBe(false);
    expect(isManagedAgentLiveTestsEnabled({ [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "0" })).toBe(false);
    expect(isManagedAgentLiveTestsEnabled({ [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "true" })).toBe(false);
    expect(isManagedAgentLiveTestsEnabled({ [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1" })).toBe(true);
  });

  it("requires both the global and provider-specific live test flags", () => {
    expect(isManagedAgentProviderLiveTestsEnabled(KILN_LIVE_OPENAI_DIRECT_TESTS_ENV, {
      [KILN_LIVE_OPENAI_DIRECT_TESTS_ENV]: "1",
    })).toBe(false);
    expect(isManagedAgentProviderLiveTestsEnabled(KILN_LIVE_OPENAI_DIRECT_TESTS_ENV, {
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
    })).toBe(false);
    expect(isManagedAgentProviderLiveTestsEnabled(KILN_LIVE_OPENAI_DIRECT_TESTS_ENV, {
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      [KILN_LIVE_OPENAI_DIRECT_TESTS_ENV]: "0",
    })).toBe(false);
    expect(isManagedAgentProviderLiveTestsEnabled(KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV, {
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      [KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV]: "1",
    })).toBe(true);
    expect(isManagedAgentProviderLiveTestsEnabled(KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV, {
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      [KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV]: "1",
    })).toBe(false);
    expect(isManagedAgentProviderLiveTestsEnabled(KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV, {
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      [KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV]: "1",
    })).toBe(true);
  });

  it("fails live preflight when the global live flag is absent", () => {
    expect(evaluateManagedAgentLivePreflight({}).ok).toBe(false);
    expect(evaluateManagedAgentLivePreflight({}).message).toContain(KILN_LIVE_MANAGED_AGENT_TESTS_ENV);
  });

  it("keeps explicit global disable stronger than auto-detected live providers", () => {
    const result = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "0",
    }, [KILN_LIVE_CODEX_TESTS_ENV]);

    expect(result.ok).toBe(false);
    expect(result.enabledProviders).toEqual([]);
  });

  it("fails live preflight when no provider-specific flag is enabled", () => {
    const result = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain(KILN_LIVE_OPENAI_DIRECT_TESTS_ENV);
    expect(result.message).toContain(KILN_LIVE_CODEX_TESTS_ENV);
    expect(result.message).toContain(KILN_LIVE_OPENCODE_TESTS_ENV);
  });

  it("passes live preflight from auto-detected provider flags", () => {
    const result = evaluateManagedAgentLivePreflight({}, [KILN_LIVE_CODEX_TESTS_ENV]);

    expect(result.ok).toBe(true);
    expect(result.enabledProviders).toEqual([KILN_LIVE_CODEX_TESTS_ENV]);
    expect(result.environment).toMatchObject({
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      [KILN_LIVE_CODEX_TESTS_ENV]: "1",
    });
  });

  it("passes live preflight with explicit global and provider flags", () => {
    const result = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      [KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV]: "1",
    });

    expect(result.ok).toBe(true);
    expect(result.enabledProviders).toEqual([KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV]);
  });

  it("creates an isolated fixture workspace and removes it after failures", async () => {
    let workspaceRoot: string | undefined;

    await expect(withManagedAgentLiveFixtureWorkspace({
      prefix: "kiln-managed-agent-live-failure-",
      files: {
        "proof.txt": "before\n",
      },
      onWorkspaceCreated: (workspace) => {
        workspaceRoot = workspace.workspaceRoot;
        expect(existsSync(workspace.filePath("proof.txt"))).toBe(true);
      },
    }, async () => {
      throw new Error("synthetic live harness failure");
    })).rejects.toThrow("synthetic live harness failure");

    expect(workspaceRoot).toBeDefined();
    expect(existsSync(workspaceRoot as string)).toBe(false);
  });

  it("compares filesystem result and canonical write evidence", async () => {
    await withManagedAgentLiveFixtureWorkspace({
      prefix: "kiln-managed-agent-live-evidence-",
      files: {
        "proof.txt": "before\n",
      },
    }, async (workspace) => {
      await workspace.writeFile("proof.txt", "after\n");

      await expectManagedAgentLiveFilesystemAndEvidence({
        workspace,
        relativePath: "proof.txt",
        expectedContents: "after\n",
        evidence: [
          defineManagedAgentWriteEvidence({
            evidenceId: "invocation-live-harness-1:write-proposal:1:evidence",
            invocationId: "invocation-live-harness-1",
            kind: "write-proposal-created",
            proposalId: "invocation-live-harness-1:write-proposal:1",
            summary: "Workspace write proposal recorded for modified proof.txt",
            resourceUris: ["kiln://managed-invocations/invocation-live-harness-1/write-proposals/1"],
            recordedAt: "2026-05-05T12:00:00.000Z",
          }),
          defineManagedAgentWriteEvidence({
            evidenceId: "invocation-live-harness-1:write-decision:1:evidence",
            invocationId: "invocation-live-harness-1",
            kind: "write-proposal-approved",
            proposalId: "invocation-live-harness-1:write-proposal:1",
            decisionId: "invocation-live-harness-1:write-decision:1",
            summary: "Workspace write proposal approved for modified proof.txt",
            resourceUris: ["kiln://managed-invocations/invocation-live-harness-1/write-decisions/1"],
            recordedAt: "2026-05-05T12:00:00.000Z",
          }),
          defineManagedAgentWriteEvidence({
            evidenceId: "invocation-live-harness-1:write-attempt:1:evidence",
            invocationId: "invocation-live-harness-1",
            kind: "write-attempt-completed",
            proposalId: "invocation-live-harness-1:write-proposal:1",
            decisionId: "invocation-live-harness-1:write-decision:1",
            attemptId: "invocation-live-harness-1:write-attempt:1",
            summary: "Workspace write attempt completed for modified proof.txt",
            resourceUris: ["kiln://managed-invocations/invocation-live-harness-1/write-attempts/1"],
            recordedAt: "2026-05-05T12:00:00.000Z",
          }),
        ],
        expectedEvidenceKinds: [
          "write-proposal-created",
          "write-proposal-approved",
          "write-attempt-completed",
        ],
      });
    });
  });
});
