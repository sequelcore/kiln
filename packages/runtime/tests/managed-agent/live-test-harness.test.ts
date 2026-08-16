import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS_ENV,
  KILN_LIVE_CODEX_TESTS_ENV,
  KILN_LIVE_MANAGED_AGENT_TESTS_ENV,
  KILN_LIVE_OPENCODE_TESTS_ENV,
  KILN_LIVE_OPENAI_DIRECT_TESTS_ENV,
  expectManagedAgentLiveDurableEvidenceSafe,
  expectManagedAgentLiveFilesystemAndEvidence,
  isManagedAgentLiveTestsEnabled,
  isManagedAgentProviderLiveTestsEnabled,
  makeManagedAgentLiveHarnessReadOnlyRequest,
  withManagedAgentLiveFixtureWorkspace,
} from "./managed-agent-live-test-harness.js";
import { defineManagedAgentWriteEvidence } from "@kilnai/core/agents";
import {
  evaluateManagedAgentLivePreflight,
  KILN_LIVE_CODEX_MODEL,
} from "../../../../scripts/managed-agent-live-preflight.js";

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
    const result = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_CODEX_MODEL]: "gpt-5.6-sol",
    }, [
      KILN_LIVE_CODEX_TESTS_ENV,
      KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV,
    ]);

    expect(result.ok).toBe(true);
    expect(result.enabledProviders).toEqual([
      KILN_LIVE_CODEX_TESTS_ENV,
      KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV,
    ]);
    expect(result.environment).toMatchObject({
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      [KILN_LIVE_CODEX_TESTS_ENV]: "1",
      [KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV]: "1",
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

  it("requires explicit authorization for the managed-account live probe", () => {
    const autoDetected = evaluateManagedAgentLivePreflight(
      {},
      [KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS_ENV],
    );
    expect(autoDetected.ok).toBe(false);
    expect(autoDetected.enabledProviders).toEqual([]);

    const explicit = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      [KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS_ENV]: "1",
    });
    expect(explicit.ok).toBe(true);
    expect(explicit.enabledProviders).toEqual([
      KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS_ENV,
    ]);
  });

  it("preserves an explicit structured handoff contract in a read-only live request", () => {
    const request = makeManagedAgentLiveHarnessReadOnlyRequest({
      invocationId: "invocation-live-readonly-structured-1",
      workspaceRoot: "C:/portable/workspace",
      providerId: "claude",
      model: "claude-sonnet-5",
      deliberationIntent: { mode: "fixed", preferredLevel: "low", onUnsupported: "deny" },
      handoff: {
        roleIntent: "read-only fixture inspector",
        requiredResultFields: ["summary"],
      },
    });

    expect(request.input.handoff).toEqual({
      roleIntent: "read-only fixture inspector",
      requiredResultFields: ["summary"],
    });
    expect(request.providerRoute.deliberationIntent).toEqual({
      mode: "fixed",
      preferredLevel: "low",
      onUnsupported: "deny",
    });
  });

  it("creates an isolated fixture workspace and removes it after failures", async () => {
    let workspaceRoot: string | undefined;
    let cleanupObservedWorkspace = false;

    await expect(withManagedAgentLiveFixtureWorkspace({
      prefix: "kiln-managed-agent-live-failure-",
      files: {
        "proof.txt": "before\n",
      },
      onWorkspaceCreated: (workspace) => {
        workspaceRoot = workspace.workspaceRoot;
        expect(existsSync(workspace.filePath("proof.txt"))).toBe(true);
      },
      onWorkspaceCleanup: (workspace) => {
        cleanupObservedWorkspace = existsSync(workspace.workspaceRoot);
      },
    }, async () => {
      throw new Error("synthetic live harness failure");
    })).rejects.toThrow("synthetic live harness failure");

    expect(workspaceRoot).toBeDefined();
    expect(cleanupObservedWorkspace).toBe(true);
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

  it("rejects machine paths and secret-bearing durable evidence", () => {
    const expectation = {
      forbiddenPaths: ["C:\\Users\\ExampleUser\\AppData\\Local\\Temp\\kiln-live"],
    };
    expect(() => expectManagedAgentLiveDurableEvidenceSafe({
      ...expectation,
      evidence: {
        resource: "C:\\Users\\ExampleUser\\AppData\\Local\\Temp\\kiln-live\\proof.txt",
      },
    })).toThrow();
    expect(() => expectManagedAgentLiveDurableEvidenceSafe({
      ...expectation,
      evidence: {
        accessToken: "must-not-survive",
        header: "Authorization: Bearer must-not-survive",
      },
    })).toThrow();
    expect(() => expectManagedAgentLiveDurableEvidenceSafe({
      ...expectation,
      evidence: {
        summary: "sk-proj-abc123456789",
        diagnostic: "github_pat_1234567890abcdef",
        opaque: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvcGVyYXRvciJ9.signature123",
      },
    })).toThrow();
    expect(() => expectManagedAgentLiveDurableEvidenceSafe({
      ...expectation,
      evidence: {
        resourceUris: ["kiln://managed-accounts/leases/fixture"],
        credentialRevisionId: "a".repeat(64),
      },
    })).not.toThrow();
  });
});
