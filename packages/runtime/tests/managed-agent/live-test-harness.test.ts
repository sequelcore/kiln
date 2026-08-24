import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL,
  KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_ROUTE_ENV,
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
  removeManagedAgentLiveFixtureWorkspaceWithRetry,
  requireManagedAgentLiveEnvironment,
  withManagedAgentLiveFixtureWorkspace,
} from "./managed-agent-live-test-harness.js";
import { defineDeliberationLevelId, defineManagedAgentWriteEvidence } from "@kilnai/core/agents";
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

  it("requires a valid KILN environment name and returns only a trimmed value", () => {
    const missing = () => requireManagedAgentLiveEnvironment(KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL, {});
    expect(missing).toThrow(KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL);
    expect(() => requireManagedAgentLiveEnvironment(KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL, {
      [KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL]: " \t",
    })).toThrow(KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL);
    expect(requireManagedAgentLiveEnvironment(KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL, {
      [KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL]: "  explicit-live-model  ",
    })).toBe("explicit-live-model");

    expect(() => requireManagedAgentLiveEnvironment("OPENAI_API_KEY", {
      OPENAI_API_KEY: "secret-value",
    })).toThrow(/KILN_\* identifier/u);
    expect(() => requireManagedAgentLiveEnvironment("OPENAI_API_KEY", {
      OPENAI_API_KEY: "secret-value",
    })).not.toThrow("secret-value");
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

  it("requires explicit global authority", () => {
    const result = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "0",
      [KILN_LIVE_CODEX_TESTS_ENV]: "1",
      [KILN_LIVE_CODEX_MODEL]: "gpt-5.6-sol",
    });

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

  it("does not infer provider authority", () => {
    const result = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_CODEX_MODEL]: "gpt-5.6-sol",
    });

    expect(result.ok).toBe(false);
    expect(result.enabledProviders).toEqual([]);
  });

  it("requires explicit OAuth direct authority", () => {
    const result = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      [KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL]: "gpt-5.5",
    });

    expect(result.ok).toBe(false);
    expect(result.enabledProviders).toEqual([]);
  });

  it("passes live preflight with explicit global and provider flags", () => {
    const result = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      [KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV]: "1",
      [KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL]: "gpt-5.5",
    });

    expect(result.ok).toBe(true);
    expect(result.enabledProviders).toEqual([KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV]);
  });

  it("requires explicit authorization for the managed-account live probe", () => {
    const autoDetected = evaluateManagedAgentLivePreflight({});
    expect(autoDetected.ok).toBe(false);
    expect(autoDetected.enabledProviders).toEqual([]);

    const explicit = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      [KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS_ENV]: "1",
      [KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_ROUTE_ENV]: "codex-oauth-managed-account",
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
      deliberationIntent: { mode: "fixed", preferredLevel: defineDeliberationLevelId("low"), onUnsupported: "deny" },
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

  it("retries transient fixture cleanup through an injectable bounded seam", async () => {
    let workspaceRoot: string | undefined;
    let removeAttempts = 0;
    let waits = 0;

    await withManagedAgentLiveFixtureWorkspace({
      prefix: "kiln-managed-agent-live-cleanup-retry-",
      files: {},
      onWorkspaceCreated: (workspace) => {
        workspaceRoot = workspace.workspaceRoot;
      },
    }, async () => undefined, {
      attempts: 3,
      remove: async (root) => {
        removeAttempts += 1;
        if (removeAttempts < 3) {
          throw Object.assign(new Error("raw transient cleanup detail"), { code: "EBUSY" });
        }
        await rm(root, { recursive: true, force: true });
      },
      wait: async () => {
        waits += 1;
      },
    });

    expect(removeAttempts).toBe(3);
    expect(waits).toBe(2);
    expect(existsSync(workspaceRoot as string)).toBe(false);
  });

  it("fails closed with a sanitized error after transient cleanup retries are exhausted", async () => {
    let workspaceRoot: string | undefined;
    let removeAttempts = 0;
    const rawErrorMessage = "raw cleanup detail C:\\Users\\operator\\fixture-secret";
    const consoleWarning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const failure = await withManagedAgentLiveFixtureWorkspace({
        prefix: "kiln-managed-agent-live-cleanup-final-failure-",
        files: {},
        onWorkspaceCreated: (workspace) => {
          workspaceRoot = workspace.workspaceRoot;
        },
      }, async () => undefined, {
        attempts: 2,
        remove: async () => {
          removeAttempts += 1;
          throw Object.assign(new Error(rawErrorMessage), { code: "EBUSY" });
        },
        wait: async () => undefined,
      }).then(() => undefined, (error) => error);

      expect(failure).toBeInstanceOf(Error);
      const message = failure instanceof Error ? failure.message : String(failure);
      expect(message).toBe("Managed live fixture cleanup failed.");
      expect(message).not.toContain(workspaceRoot as string);
      expect(message).not.toContain(rawErrorMessage);
    } finally {
      expect(existsSync(workspaceRoot as string)).toBe(true);
      await rm(workspaceRoot as string, { recursive: true, force: true });
      consoleWarning.mockRestore();
    }

    expect(removeAttempts).toBe(2);
    expect(consoleWarning).not.toHaveBeenCalled();
    expect(existsSync(workspaceRoot as string)).toBe(false);
  });

  it("rejects invalid cleanup retry bounds before attempting removal", async () => {
    const workspaceRoot = "C:\\portable\\managed-agent-live-cleanup";

    for (const attempts of [0, Number.NaN]) {
      const failure = await removeManagedAgentLiveFixtureWorkspaceWithRetry(workspaceRoot, {
        attempts,
        remove: async () => {
          throw new Error("raw cleanup detail");
        },
        wait: async () => undefined,
      }).then(() => undefined, (error) => error);

      expect(failure).toBeInstanceOf(Error);
      const message = failure instanceof Error ? failure.message : String(failure);
      expect(message).toBe("Managed live fixture cleanup failed.");
      expect(message).not.toContain(workspaceRoot);
      expect(message).not.toContain("raw cleanup detail");
    }
  });

  it("sanitizes nontransient cleanup failures without retrying", async () => {
    let workspaceRoot: string | undefined;
    let removeAttempts = 0;
    let waits = 0;
    const rawErrorMessage = "raw nontransient cleanup detail C:\\fixture\\secret";

    const failure = await withManagedAgentLiveFixtureWorkspace({
      prefix: "kiln-managed-agent-live-cleanup-nontransient-",
      files: {},
      onWorkspaceCreated: (workspace) => {
        workspaceRoot = workspace.workspaceRoot;
      },
    }, async () => undefined, {
      remove: async (root) => {
        removeAttempts += 1;
        await rm(root, { recursive: true, force: true });
        throw Object.assign(new Error(rawErrorMessage), { code: "EACCES" });
      },
      wait: async () => {
        waits += 1;
      },
    }).then(() => undefined, (error) => error);

    expect(failure).toBeInstanceOf(Error);
    const message = failure instanceof Error ? failure.message : String(failure);
    expect(message).toBe("Managed live fixture cleanup failed.");
    expect(message).not.toContain(workspaceRoot as string);
    expect(message).not.toContain(rawErrorMessage);
    expect(removeAttempts).toBe(1);
    expect(waits).toBe(0);
    expect(existsSync(workspaceRoot as string)).toBe(false);
  });

  it("keeps cleanup failure observable when the fixture callback also fails", async () => {
    let workspaceRoot: string | undefined;
    const callbackErrorMessage = "raw callback failure C:\\fixture\\secret";
    const cleanupErrorMessage = "raw cleanup failure C:\\fixture\\secret";

    const failure = await withManagedAgentLiveFixtureWorkspace({
      prefix: "kiln-managed-agent-live-cleanup-callback-failure-",
      files: {},
      onWorkspaceCreated: (workspace) => {
        workspaceRoot = workspace.workspaceRoot;
      },
    }, async () => {
      throw new Error(callbackErrorMessage);
    }, {
      attempts: 1,
      remove: async (root) => {
        await rm(root, { recursive: true, force: true });
        throw Object.assign(new Error(cleanupErrorMessage), { code: "EBUSY" });
      },
      wait: async () => undefined,
    }).then(() => undefined, (error) => error);

    expect(failure).toBeInstanceOf(Error);
    const message = failure instanceof Error ? failure.message : String(failure);
    expect(message).toBe("Managed live fixture cleanup failed.");
    expect(message).not.toContain(workspaceRoot as string);
    expect(message).not.toContain(callbackErrorMessage);
    expect(message).not.toContain(cleanupErrorMessage);
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
