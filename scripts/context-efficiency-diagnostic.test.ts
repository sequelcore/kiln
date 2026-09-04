import { describe, expect, it } from "vitest";
import {
  buildContextEfficiencySchedule,
  buildCliRunCommand,
  buildInternalBenchmarkCommand,
  collectContextEfficiencyTrials,
  createProductionContextEfficiencyDispatcher,
  dispatchContextEfficiencyPredispatchProbe,
  dispatchContextEfficiencySchedule,
  validateContextEfficiencyRunEnvelope,
  verifyContextEfficiencyExecutionTarget,
  verifyContextEfficiencySourceContract,
} from "./context-efficiency-diagnostic.js";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const PLUS_ACCOUNT_POLICY = {
  plan: "plus",
  evidenceState: "fresh",
  allowedAccountIds: ["plus-a", "plus-b"],
  expiresAt: "2099-01-01T00:00:00.000Z",
} as const;

function runEnvelope() {
  return {
    schemaVersion: "kiln.run.output.v1",
    answer: "OK",
    telemetry: {
      sessionId: "session-1",
      sessionSucceeded: true,
      provider: "codex-oauth",
      model: "gpt-5.6-luna",
      inputTokens: 10,
      outputTokens: 2,
      toolCallCount: 0,
      managedChildCount: 0,
      durationMs: 1_000,
      providerRequests: [{
        version: "v1",
        requestIndex: 0,
        providerId: "codex-oauth",
        modelId: "gpt-5.6-luna",
        deliberation: { state: "observed", status: "exact", selectedLevel: "low" },
        authority: {
          state: "observed",
          requestedAuthority: "read_only",
          admittedAuthority: "read_only",
          completeness: "authoritative",
        },
        dispatch: {
          attempt: { state: "observed", value: 1 },
          retry: { state: "observed", value: false },
          fallback: { state: "unknown" },
          outcome: "completed",
        },
        usage: {
          input: { tokens: 10, measurement: "provider_reported" },
          output: { tokens: 2, measurement: "provider_reported" },
          cacheRead: { tokens: 0, measurement: "provider_reported" },
          cacheWrite: { tokens: 0, measurement: "provider_reported" },
        },
        physicalRegions: [{ source: "system", bytes: 100, measurement: "measured" }],
        reconciliation: { state: "unknown", reason: "regional_token_attribution_unavailable" },
        capacity: {
          state: "capacity_unknown",
          contextWindowAuthority: "unknown",
          reason: "context_capacity_unavailable",
        },
        cache: {
          partitionIdentity: { state: "observed", hash: `sha256:${"9".repeat(64)}` },
          regions: [],
          measurement: "provider_reported",
        },
        toolCount: 0,
      }],
    },
    diagnostics: { lastError: null, attempts: [] },
  };
}

describe("context efficiency diagnostic source contract", () => {
  const repositoryRoot = resolve(import.meta.dirname, "..");
  const manifestPath = resolve(
    repositoryRoot,
    "docs/benchmarks/context-efficiency-diagnostic-v1/manifest.json",
  );

  it("rejects a frozen source contract that omits a required transitive owner", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      identity: { startingCommit: string; configurationRevisionId: string; sourceContractPaths: string[] };
    };
    manifest.identity.sourceContractPaths = manifest.identity.sourceContractPaths.filter(
      (path) => path !== "packages/cli/src/application/canonical-run-session-dispatcher.ts",
    );

    expect(() => verifyContextEfficiencySourceContract({
      repositoryRoot,
      manifest,
      headCommit: manifest.identity.startingCommit,
      bunVersion: "1.4.0",
      configurationRevisionId: manifest.identity.configurationRevisionId,
    })).toThrow(/source contract is incomplete/u);
  });

  it("rejects identity and source-contract drift", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      identity: {
        startingCommit: string;
        configurationRevisionId: string;
        inputContractDigest: string;
        protocolContractDigest: string;
        sourceContractDigest: string;
      };
    };
    const verify = (overrides: {
      headCommit?: string;
      bunVersion?: string;
      configurationRevisionId?: string;
      manifest?: unknown;
    }) =>
      verifyContextEfficiencySourceContract({
        repositoryRoot,
        manifest: overrides.manifest ?? manifest,
        headCommit: overrides.headCommit ?? manifest.identity.startingCommit,
        bunVersion: overrides.bunVersion ?? "1.4.0",
        configurationRevisionId: overrides.configurationRevisionId ?? manifest.identity.configurationRevisionId,
      });

    expect(() => verify({ headCommit: "different" })).toThrow(/HEAD differs/);
    expect(() => verify({ bunVersion: "different" })).toThrow(/Bun version differs/);
    expect(() => verify({ configurationRevisionId: "sha256:different" })).toThrow(/configuration revision differs/);

    const changedManifest = structuredClone(manifest);
    changedManifest.identity.sourceContractDigest = "sha256:invalid";
    expect(() => verify({ manifest: changedManifest })).toThrow(/source files differ/u);

  });
});

describe("context efficiency diagnostic execution-target preflight", () => {
  const manifest = {
    schemaVersion: "kiln-context-efficiency-diagnostic-manifest-v1",
    identity: {
      targetId: "codex-luna",
      providerId: "codex-oauth",
      modelId: "gpt-5.6-luna",
      plusAccountPolicy: PLUS_ACCOUNT_POLICY,
    },
  };
  const accountUsage = ["plus-a", "plus-b"].map((accountId) => ({
    provider: "codex-oauth",
    accountId,
    plan: "plus",
    availability: "available" as const,
    evidenceState: "fresh" as const,
    source: "provider-endpoint",
    confidence: "authoritative",
    eligibleTargets: ["codex-luna"],
  }));

  it("requires the exact frozen route with fallback disabled", () => {
    expect(() => verifyContextEfficiencyExecutionTarget({
      manifest,
      targets: [{
        id: "codex-luna",
        providerId: "codex-oauth",
        providerModelId: "gpt-5.6-luna",
        economics: { fallbackPosture: "disabled" },
        accountPolicyId: "plus-only",
      }],
      accountPolicies: [{ id: "plus-only", accountIds: ["plus-a", "plus-b"] }],
      accountUsage,
    })).not.toThrow();
    expect(() => verifyContextEfficiencyExecutionTarget({
      manifest,
      targets: [{
        id: "codex-luna",
        providerId: "codex-oauth",
        providerModelId: "gpt-5.6-luna",
        economics: { fallbackPosture: "committed" },
      }],
      accountUsage,
    })).toThrow(/does not disable provider fallback/);

    expect(() => verifyContextEfficiencyExecutionTarget({
      manifest: {
        ...manifest,
        identity: {
          ...manifest.identity,
          plusAccountPolicy: { ...PLUS_ACCOUNT_POLICY, expiresAt: "2020-01-01T00:00:00.000Z" },
        },
      },
      targets: [{
        id: "codex-luna",
        providerId: "codex-oauth",
        providerModelId: "gpt-5.6-luna",
        economics: { fallbackPosture: "disabled" },
        accountPolicyId: "plus-only",
      }],
      accountPolicies: [{ id: "plus-only", accountIds: ["plus-a", "plus-b"] }],
      accountUsage,
    })).toThrow(/evidence is stale/u);

    expect(() => verifyContextEfficiencyExecutionTarget({
      manifest,
      targets: [{
        id: "codex-luna",
        providerId: "codex-oauth",
        providerModelId: "gpt-5.6-luna",
        economics: { fallbackPosture: "disabled" },
        accountPolicyId: "mixed",
      }],
      accountPolicies: [{ id: "mixed", accountIds: ["plus-a", "free-a"] }],
      accountUsage,
    })).toThrow(/not restricted to the registered Plus accounts/u);

    expect(() => verifyContextEfficiencyExecutionTarget({
      manifest,
      targets: [{
        id: "codex-luna",
        providerId: "codex-oauth",
        providerModelId: "gpt-5.6-luna",
        economics: { fallbackPosture: "disabled" },
        accountPolicyId: "plus-only",
      }],
      accountPolicies: [{ id: "plus-only", accountIds: ["plus-a", "plus-b"] }],
      accountUsage: accountUsage.map((entry) => entry.accountId === "plus-a"
        ? { ...entry, plan: "free" }
        : entry),
    })).toThrow(/lacks fresh canonical provider evidence/u);
  });
});

describe("context efficiency diagnostic collector", () => {
  it("expands the frozen manifest into exactly 33 bounded trials", () => {
    const manifest = JSON.parse(readFileSync(resolve(
      import.meta.dirname,
      "../docs/benchmarks/context-efficiency-diagnostic-v1/manifest.json",
    ), "utf8")) as unknown;
    const schedule = buildContextEfficiencySchedule(manifest);

    expect(schedule).toHaveLength(33);
    expect(schedule.filter((trial) => trial.executionStrategy === "cli_continuation")).toHaveLength(3);
    expect(schedule.filter((trial) => trial.executionStrategy.startsWith("internal_benchmark"))).toHaveLength(12);
    expect(schedule.every((trial) => trial.budgets.maximumProviderRequests === 8)).toBe(true);
    expect(schedule.every((trial) => trial.invalidRetryLimit === 1 && trial.timeoutMs === 180_000)).toBe(true);
  });

  it("bounds the diagnostic probe to one cold trivial request and one physical transport", async () => {
    const manifest = JSON.parse(readFileSync(resolve(
      import.meta.dirname,
      "../docs/benchmarks/context-efficiency-diagnostic-v1/manifest.json",
    ), "utf8")) as unknown;
    const calls: Array<{ taskId: string; maximumProviderRequests: number }> = [];
    const collected = await dispatchContextEfficiencyPredispatchProbe({
      manifest,
      providerQuotaAuthorized: true,
      dispatcher: {
        runCli: async ({ trial }) => {
          calls.push({ taskId: trial.taskId, maximumProviderRequests: trial.budgets.maximumProviderRequests });
          return { output: runEnvelope(), continuationSessionId: "probe-session" };
        },
        runConversation: async () => { throw new Error("unexpected conversation probe"); },
        runInternalBenchmark: async () => { throw new Error("unexpected benchmark probe"); },
      },
    });

    expect(calls).toEqual([{ taskId: "trivial_exact", maximumProviderRequests: 1 }]);
    expect(collected).toHaveLength(1);
  });

  it("dispatches sequential strategies and binds warm CLI trials to their cold session", async () => {
    const manifest = {
      schemaVersion: "kiln-context-efficiency-diagnostic-manifest-v1",
      design: {
        repetitionsPerCell: 1,
        invalidRetriesPerCell: 1,
        timeoutMs: 1_000,
        budgetsPerTrial: {
          maximumProviderRequests: 2,
          maximumToolCalls: 2,
          maximumManagedChildren: 1,
          maximumCumulativeInputTokens: 100,
          maximumCumulativeOutputTokens: 50,
        },
      },
      tasks: [
        { id: "direct", executionStrategy: "cli_run", conditions: ["cold", "immediate_warm"] },
        { id: "conversation", executionStrategy: "cli_continuation", conditions: ["long_session"] },
        { id: "child", executionStrategy: "internal_benchmark_managed_child", conditions: ["cold"] },
      ],
    };
    const calls: string[] = [];
    const collected = await dispatchContextEfficiencySchedule({
      manifest,
      providerQuotaAuthorized: true,
      dispatcher: {
        runCli: async ({ trial, continuationSessionId }) => {
          calls.push(`cli:${trial.condition}:${continuationSessionId ?? "new"}`);
          return { output: runEnvelope(), continuationSessionId: continuationSessionId ?? "cold-session" };
        },
        runConversation: async () => {
          calls.push("conversation");
          return { output: runEnvelope() };
        },
        runInternalBenchmark: async () => {
          calls.push("benchmark");
          return { output: runEnvelope(), continuationSessionId: "benchmark-cold" };
        },
      },
    });

    expect(calls).toEqual([
      "cli:cold:new",
      "cli:immediate_warm:cold-session",
      "conversation",
      "benchmark",
    ]);
    expect(collected).toHaveLength(4);
    await expect(dispatchContextEfficiencySchedule({
      manifest,
      providerQuotaAuthorized: false,
      dispatcher: {
        runCli: async () => ({ output: runEnvelope() }),
        runConversation: async () => ({ output: runEnvelope() }),
        runInternalBenchmark: async () => ({ output: runEnvelope() }),
      },
    })).rejects.toThrow("explicit provider-quota authority");
  });

  it("rejects a warm trial when a managed-child cache lineage changes despite a stable top-level partition", async () => {
    const manifest = {
      schemaVersion: "kiln-context-efficiency-diagnostic-manifest-v1",
      design: {
        repetitionsPerCell: 1,
        invalidRetriesPerCell: 0,
        timeoutMs: 1_000,
        budgetsPerTrial: {
          maximumProviderRequests: 2,
          maximumToolCalls: 2,
          maximumManagedChildren: 1,
          maximumCumulativeInputTokens: 100,
          maximumCumulativeOutputTokens: 50,
        },
      },
      tasks: [{
        id: "child",
        executionStrategy: "internal_benchmark_managed_child",
        conditions: ["cold", "immediate_warm"],
      }],
    };
    const withManagedPartition = (hashCharacter: string) => {
      const output = runEnvelope();
      return {
        ...output,
        telemetry: {
          ...output.telemetry,
          providerRequests: [
            ...output.telemetry.providerRequests,
            {
              ...output.telemetry.providerRequests[0],
              requestIndex: 1,
              managedInvocation: {
                invocationId: `invocation-${hashCharacter}`,
                childSessionId: `session-${hashCharacter}`,
                childTurnId: `turn-${hashCharacter}`,
              },
              cache: {
                ...output.telemetry.providerRequests[0]!.cache,
                partitionIdentity: { state: "observed", hash: `sha256:${hashCharacter.repeat(64)}` },
              },
            },
          ],
        },
      };
    };
    let calls = 0;
    const collected = await dispatchContextEfficiencySchedule({
      manifest,
      providerQuotaAuthorized: true,
      dispatcher: {
        runCli: async () => { throw new Error("unexpected CLI trial"); },
        runConversation: async () => { throw new Error("unexpected conversation trial"); },
        runInternalBenchmark: async () => {
          calls += 1;
          return {
            output: withManagedPartition(calls === 1 ? "a" : "b"),
            continuationSessionId: "internal-session",
          };
        },
      },
    });

    expect(collected).toEqual([
      expect.objectContaining({ condition: "cold", validity: "valid" }),
      expect.objectContaining({
        condition: "immediate_warm",
        validity: "invalid",
        invalidReason: "collector_failure",
      }),
    ]);
  });

  it("retains one infrastructure-invalid attempt and uses its single frozen retry", async () => {
    const manifest = {
      schemaVersion: "kiln-context-efficiency-diagnostic-manifest-v1",
      design: {
        repetitionsPerCell: 2,
        invalidRetriesPerCell: 1,
        timeoutMs: 1_000,
        budgetsPerTrial: {
          maximumProviderRequests: 2,
          maximumToolCalls: 2,
          maximumManagedChildren: 1,
          maximumCumulativeInputTokens: 100,
          maximumCumulativeOutputTokens: 50,
        },
      },
      tasks: [{ id: "direct", executionStrategy: "cli_run", conditions: ["cold"] }],
    };
    let calls = 0;
    const collected = await dispatchContextEfficiencySchedule({
      manifest,
      providerQuotaAuthorized: true,
      dispatcher: {
        runCli: async () => {
          calls += 1;
          if (calls === 1 || calls === 3) throw new Error("transient collector failure");
          return { output: runEnvelope(), continuationSessionId: "cold-session" };
        },
        runConversation: async () => ({ output: runEnvelope() }),
        runInternalBenchmark: async () => ({ output: runEnvelope() }),
      },
    });

    expect(calls).toBe(3);
    expect(collected).toEqual([
      expect.objectContaining({ attempt: 1, validity: "invalid", invalidReason: "infrastructure_failure" }),
      expect.objectContaining({ attempt: 2, validity: "valid", output: expect.any(Object) }),
      expect.objectContaining({ repetition: 2, attempt: 1, validity: "invalid" }),
    ]);
    const report = collectContextEfficiencyTrials(collected);
    expect(report.trials[0]).not.toHaveProperty("run");
    expect(report.trials[1]).toHaveProperty("run");
    expect(report.trials[2]).not.toHaveProperty("run");
  });

  it("builds shell-free ordinary CLI and internal benchmark commands from frozen identities", () => {
    const identity = {
      targetId: "codex-luna",
      deliberationLevel: "low",
      plusAccountPolicy: PLUS_ACCOUNT_POLICY,
    };
    const trial = {
      taskId: "direct",
      executionStrategy: "cli_run",
      condition: "immediate_warm" as const,
      repetition: 1,
      invalidRetryLimit: 1,
      timeoutMs: 1_000,
      budgets: {
        maximumProviderRequests: 2,
        maximumToolCalls: 2,
        maximumManagedChildren: 1,
        maximumCumulativeInputTokens: 100,
        maximumCumulativeOutputTokens: 50,
      },
    };
    expect(buildCliRunCommand({
      repositoryRoot: "C:/repo",
      identity,
      trial,
      task: { input: "Reply OK", authority: "read_only" },
      continuationSessionId: "session-cold",
      disableMcp: true,
    })).toEqual([
      "bun", "packages/cli/src/index.ts", "run", "Reply OK",
      "--target", "codex-luna", "--output", "json", "--deliberation-level", "low",
      "--authority", "read_only", "--continue-session", "session-cold",
      "--disable-mcp",
    ]);

    expect(buildInternalBenchmarkCommand({
      identity,
      trial: { ...trial, executionStrategy: "internal_benchmark_managed_child" },
      task: { oracle: { dataset: "fixtures/managed-v1.jsonl" } },
    })).toEqual([
      "bun", "packages/cli/src/index.ts", "benchmark", "run-internal",
      "--profile", "kiln-managed-child-agent", "--dataset", "fixtures/managed-v1.jsonl",
      "--k", "1", "--max-invalid-attempts", "0",
      "--target", "codex-luna", "--accounts", "plus-a,plus-b", "--deliberation-level", "low",
    ]);

    expect(buildInternalBenchmarkCommand({
      identity: {
        ...identity,
        plusAccountPolicy: { ...PLUS_ACCOUNT_POLICY, expiresAt: "2020-01-01T00:00:00.000Z" },
      },
      trial: { ...trial, executionStrategy: "internal_benchmark_managed_child" },
      task: { oracle: { dataset: "fixtures/managed-v1.jsonl" } },
    })).toContain("plus-a,plus-b");
  });

  it("runs the production CLI adapter through an injected runner with a hard Runtime envelope", async () => {
    const observedCommands: string[][] = [];
    let envelopePath: string | undefined;
    const manifest = {
      schemaVersion: "kiln-context-efficiency-diagnostic-manifest-v1",
      identity: {
        targetId: "codex-luna",
        providerId: "codex-oauth",
        modelId: "gpt-5.6-luna",
        deliberationLevel: "low",
        plusAccountPolicy: PLUS_ACCOUNT_POLICY,
      },
    };
    const dispatcher = createProductionContextEfficiencyDispatcher({
      repositoryRoot: resolve(import.meta.dirname, ".."),
      manifest,
      commandRunner: {
        run: async ({ command }) => {
          observedCommands.push([...command]);
          envelopePath = command[command.indexOf("--execution-envelope") + 1];
          const envelope = JSON.parse(readFileSync(envelopePath!, "utf8")) as {
            physicalProviderRequests: number;
            convergence: { providerRequests: number; toolCalls: number; cumulativeInputTokens: number };
          };
          expect(envelope.physicalProviderRequests).toBe(2);
          expect(envelope.convergence).toMatchObject({
            providerRequests: 2,
            toolCalls: 2,
            cumulativeInputTokens: 100,
            recoveryAttempts: 1,
          });
          const output = runEnvelope();
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              ...output,
              telemetry: {
                ...output.telemetry,
                providerRequests: output.telemetry.providerRequests.map((request) => ({
                  ...request,
                  authority: { ...request.authority, admittedAuthority: "fail_closed" },
                })),
              },
            }),
            stderr: "",
          };
        },
      },
    });
    const trial = {
      taskId: "direct",
      executionStrategy: "cli_run",
      condition: "cold" as const,
      repetition: 1,
      invalidRetryLimit: 1,
      timeoutMs: 1_000,
      budgets: {
        maximumProviderRequests: 2,
        maximumToolCalls: 2,
        maximumManagedChildren: 1,
        maximumCumulativeInputTokens: 100,
        maximumCumulativeOutputTokens: 50,
      },
    };
    try {
      const result = await dispatcher.runCli({
        trial,
        task: {
          input: "Reply OK",
          authority: "read_only",
          expectedRuntimeAuthority: "fail_closed",
          oracle: { kind: "exact_text", value: "OK" },
        },
      });
      expect(result.continuationSessionId).toBe("session-1");
      const report = collectContextEfficiencyTrials([{
        taskId: trial.taskId,
        condition: trial.condition,
        repetition: trial.repetition,
        output: result.output,
      }]);
      const projected = report.trials[0];
      if (!projected || !("run" in projected)) throw new Error("Expected one valid projected trial.");
      expect(projected.run.diagnostics).toMatchObject({
        oracle: "passed",
        requestedAuthority: "read_only",
        authority: "passed",
      });
      expect(projected.run).not.toHaveProperty("answer");
      expect(observedCommands).toHaveLength(1);
      expect(observedCommands[0]).toContain("--execution-envelope");
    } finally {
      await dispatcher.cleanup();
    }
    expect(envelopePath).toBeDefined();
    expect(existsSync(envelopePath!)).toBe(false);
  });

  it("classifies a structured pre-dispatch CLI failure as infrastructure failure", async () => {
    const manifest = {
      schemaVersion: "kiln-context-efficiency-diagnostic-manifest-v1",
      identity: {
        targetId: "codex-luna",
        providerId: "codex-oauth",
        modelId: "gpt-5.6-luna",
        deliberationLevel: "low",
        plusAccountPolicy: PLUS_ACCOUNT_POLICY,
      },
      design: {
        repetitionsPerCell: 1,
        invalidRetriesPerCell: 0,
        timeoutMs: 1_000,
        budgetsPerTrial: {
          maximumProviderRequests: 2,
          maximumToolCalls: 2,
          maximumManagedChildren: 1,
          maximumCumulativeInputTokens: 100,
          maximumCumulativeOutputTokens: 50,
        },
      },
      tasks: [{
        id: "direct",
        executionStrategy: "cli_run",
        conditions: ["cold"],
        input: "Reply OK",
        authority: "read_only",
        expectedRuntimeAuthority: "read_only",
        oracle: { kind: "exact_text", value: "OK" },
      }],
    };
    const dispatcher = createProductionContextEfficiencyDispatcher({
      repositoryRoot: resolve(import.meta.dirname, ".."),
      manifest,
      commandRunner: {
        run: async () => ({
          exitCode: 1,
          stdout: JSON.stringify({
            schemaVersion: "kiln.run.output.v1",
            telemetry: { providerRequests: [] },
            diagnostics: { lastError: "Failed to prepare session. private detail must not enter the report" },
          }),
          stderr: "private detail must not enter the report",
        }),
      },
    });
    try {
      const collected = await dispatchContextEfficiencySchedule({
        manifest,
        dispatcher,
        providerQuotaAuthorized: true,
      });
      expect(collected).toEqual([expect.objectContaining({
        validity: "invalid",
        invalidReason: "infrastructure_failure",
        invalidDiagnostic: "session_preparation_failed",
      })]);
      expect(JSON.stringify(collectContextEfficiencyTrials(collected))).not.toContain("private detail");
    } finally {
      await dispatcher.cleanup();
    }
  });

  it("classifies a non-envelope CLI crash without retaining raw diagnostics", async () => {
    const manifest = {
      schemaVersion: "kiln-context-efficiency-diagnostic-manifest-v1",
      identity: {
        targetId: "codex-luna",
        providerId: "codex-oauth",
        modelId: "gpt-5.6-luna",
        deliberationLevel: "low",
        plusAccountPolicy: PLUS_ACCOUNT_POLICY,
      },
      design: {
        repetitionsPerCell: 1,
        invalidRetriesPerCell: 0,
        timeoutMs: 1_000,
        budgetsPerTrial: {
          maximumProviderRequests: 1,
          maximumToolCalls: 1,
          maximumManagedChildren: 1,
          maximumCumulativeInputTokens: 100,
          maximumCumulativeOutputTokens: 50,
        },
      },
      tasks: [{
        id: "direct",
        executionStrategy: "cli_run",
        conditions: ["cold"],
        input: "Reply OK",
        authority: "read_only",
        expectedRuntimeAuthority: "read_only",
        oracle: { kind: "exact_text", value: "OK", maximumToolCalls: 0 },
      }],
    };
    const dispatcher = createProductionContextEfficiencyDispatcher({
      repositoryRoot: resolve(import.meta.dirname, ".."),
      manifest,
      commandRunner: {
        run: async () => ({
          exitCode: 1,
          stdout: "",
          stderr: "private stack trace must not enter the report",
        }),
      },
    });
    try {
      const collected = await dispatchContextEfficiencySchedule({
        manifest,
        dispatcher,
        providerQuotaAuthorized: true,
      });
      expect(collected).toEqual([expect.objectContaining({
        validity: "invalid",
        invalidReason: "infrastructure_failure",
        invalidDiagnostic: "unstructured_command_failure",
      })]);
      expect(JSON.stringify(collectContextEfficiencyTrials(collected))).not.toContain("private stack trace");
    } finally {
      await dispatcher.cleanup();
    }
  });

  it("keeps a governed budget failure in the denominator instead of retrying it as invalid", async () => {
    const manifest = {
      schemaVersion: "kiln-context-efficiency-diagnostic-manifest-v1",
      identity: {
        targetId: "codex-luna",
        providerId: "codex-oauth",
        modelId: "gpt-5.6-luna",
        deliberationLevel: "low",
        plusAccountPolicy: PLUS_ACCOUNT_POLICY,
      },
      design: {
        repetitionsPerCell: 1,
        invalidRetriesPerCell: 1,
        timeoutMs: 1_000,
        budgetsPerTrial: {
          maximumProviderRequests: 2,
          maximumToolCalls: 2,
          maximumManagedChildren: 1,
          maximumCumulativeInputTokens: 5,
          maximumCumulativeOutputTokens: 50,
        },
      },
      tasks: [{
        id: "direct",
        executionStrategy: "cli_run",
        conditions: ["cold"],
        input: "Reply OK",
        authority: "read_only",
        expectedRuntimeAuthority: "read_only",
        oracle: { kind: "exact_text", value: "OK" },
      }],
    };
    let calls = 0;
    const dispatcher = createProductionContextEfficiencyDispatcher({
      repositoryRoot: resolve(import.meta.dirname, ".."),
      manifest,
      commandRunner: {
        run: async () => {
          calls += 1;
          return { exitCode: 0, stdout: JSON.stringify(runEnvelope()), stderr: "" };
        },
      },
    });
    try {
      const collected = await dispatchContextEfficiencySchedule({
        manifest,
        dispatcher,
        providerQuotaAuthorized: true,
      });
      expect(calls).toBe(1);
      expect(collected).toHaveLength(1);
      expect(collected[0]).toMatchObject({ validity: "valid", attempt: 1 });
      const report = collectContextEfficiencyTrials(collected);
      expect(report.trials[0]).toMatchObject({
        validity: "valid",
        run: {
          telemetry: { sessionSucceeded: false },
          diagnostics: { failed: true, oracle: "failed" },
        },
      });
    } finally {
      await dispatcher.cleanup();
    }
  });

  it("retains a content-free frozen-execution-identity invalid reason", async () => {
    const manifest = {
      schemaVersion: "kiln-context-efficiency-diagnostic-manifest-v1",
      identity: {
        targetId: "codex-luna",
        providerId: "codex-oauth",
        modelId: "gpt-5.6-luna",
        deliberationLevel: "low",
        plusAccountPolicy: PLUS_ACCOUNT_POLICY,
      },
      design: {
        repetitionsPerCell: 1,
        invalidRetriesPerCell: 0,
        timeoutMs: 1_000,
        budgetsPerTrial: {
          maximumProviderRequests: 2,
          maximumToolCalls: 2,
          maximumManagedChildren: 1,
          maximumCumulativeInputTokens: 100,
          maximumCumulativeOutputTokens: 50,
        },
      },
      tasks: [{
        id: "direct",
        executionStrategy: "cli_run",
        conditions: ["cold"],
        input: "Reply OK",
        authority: "read_only",
        expectedRuntimeAuthority: "read_only",
        oracle: { kind: "exact_text", value: "OK" },
      }],
    };
    const dispatcher = createProductionContextEfficiencyDispatcher({
      repositoryRoot: resolve(import.meta.dirname, ".."),
      manifest,
      commandRunner: {
        run: async () => {
          const output = runEnvelope();
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              ...output,
              telemetry: {
                ...output.telemetry,
                providerRequests: output.telemetry.providerRequests.map((request) => ({
                  ...request,
                  deliberation: { state: "observed", status: "exact", selectedLevel: "high" },
                })),
              },
            }),
            stderr: "",
          };
        },
      },
    });
    try {
      const collected = await dispatchContextEfficiencySchedule({
        manifest,
        dispatcher,
        providerQuotaAuthorized: true,
      });
      expect(collected).toEqual([
        expect.objectContaining({ validity: "invalid", invalidReason: "route_identity_mismatch" }),
      ]);
    } finally {
      await dispatcher.cleanup();
    }
  });

  it("projects only canonical observations from an internal benchmark artifact", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "kiln-context-efficiency-test-"));
    const artifactPath = resolve(root, "benchmark.json");
    const envelope = runEnvelope();
    writeFileSync(artifactPath, JSON.stringify({
      runs: [{
        consistency: {
          runs: [{
            results: [{
              durationMs: 1_000,
              tokenUsage: { inputTokens: 10, outputTokens: 2 },
              trial: { status: "valid" },
              metadata: {
                sessionId: "benchmark-session",
                sessionSucceeded: true,
                providerId: "codex-oauth",
                modelId: "gpt-5.6-luna",
                providerRequestObservations: envelope.telemetry.providerRequests,
                providerRequests: [{ systemHash: "must-not-be-read" }],
                toolCalls: [],
              },
            }],
          }],
        },
      }],
    }), "utf8");
    const dispatcher = createProductionContextEfficiencyDispatcher({
      repositoryRoot: resolve(import.meta.dirname, ".."),
      worktreeFingerprint: async () => "stable-test-worktree",
      manifest: {
        schemaVersion: "kiln-context-efficiency-diagnostic-manifest-v1",
        identity: {
          targetId: "codex-luna",
          providerId: "codex-oauth",
          modelId: "gpt-5.6-luna",
          deliberationLevel: "low",
          plusAccountPolicy: PLUS_ACCOUNT_POLICY,
        },
      },
      commandRunner: {
        run: async () => ({ exitCode: 0, stdout: JSON.stringify({ outputPath: artifactPath }), stderr: "" }),
      },
    });
    try {
      const result = await dispatcher.runInternalBenchmark({
        trial: {
          taskId: "child",
          executionStrategy: "internal_benchmark_managed_child",
          condition: "cold",
          repetition: 1,
          invalidRetryLimit: 1,
          timeoutMs: 1_000,
          budgets: {
            maximumProviderRequests: 2,
            maximumToolCalls: 2,
            maximumManagedChildren: 1,
            maximumCumulativeInputTokens: 100,
            maximumCumulativeOutputTokens: 50,
          },
        },
        task: {
          authority: "read_only",
          expectedRuntimeAuthority: "read_only",
          oracle: { kind: "managed_child_settlement", dataset: "fixture.jsonl" },
        },
      });
      expect(result.continuationSessionId).toBe("benchmark-session");
      expect(JSON.stringify(result.output)).not.toContain("systemHash");
    } finally {
      await dispatcher.cleanup();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("executes all eight scripted conversation turns in one continued session", async () => {
    const commands: string[][] = [];
    const dispatcher = createProductionContextEfficiencyDispatcher({
      repositoryRoot: resolve(import.meta.dirname, ".."),
      worktreeFingerprint: async () => "stable-test-worktree",
      manifest: {
        schemaVersion: "kiln-context-efficiency-diagnostic-manifest-v1",
        identity: {
          targetId: "codex-luna",
          providerId: "codex-oauth",
          modelId: "gpt-5.6-luna",
          deliberationLevel: "low",
          plusAccountPolicy: PLUS_ACCOUNT_POLICY,
        },
      },
      commandRunner: {
        run: async ({ command }) => {
          commands.push([...command]);
          const ordinal = commands.length;
          const envelope = runEnvelope();
          const answer = ordinal === 8
            ? [
                "KILN-7F3A",
                "preserve terminal truth",
                "keep authority bounded",
                "retain canonical replay",
                "report unknown evidence honestly",
                "never persist raw prompts",
                "preserve required content",
              ].join("\n")
            : `ACK-${ordinal}`;
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              ...envelope,
              answer,
              telemetry: { ...envelope.telemetry, sessionId: `conversation-session-${ordinal}` },
            }),
            stderr: "",
          };
        },
      },
    });
    try {
      const result = await dispatcher.runConversation({
        trial: {
          taskId: "ordinary_conversation_heavy",
          executionStrategy: "cli_continuation",
          condition: "long_session",
          repetition: 1,
          invalidRetryLimit: 1,
          timeoutMs: 180_000,
          budgets: {
            maximumProviderRequests: 8,
            maximumToolCalls: 32,
            maximumManagedChildren: 1,
            maximumCumulativeInputTokens: 500_000,
            maximumCumulativeOutputTokens: 50_000,
          },
        },
        task: {
          authority: "read_only",
          expectedRuntimeAuthority: "read_only",
          oracle: {
            kind: "scripted_conversation_recall",
            scriptFixture: "packages/core/evals/fixtures/context-efficiency-diagnostic-v1/conversation-script.json",
            maximumToolCalls: 0,
          },
        },
      });
      expect(commands).toHaveLength(8);
      expect(commands[0]).not.toContain("--continue-session");
      expect(commands.every((command) => command.includes("--disable-tools"))).toBe(true);
      const conversationEnvelopePath = commands[0]![commands[0]!.indexOf("--execution-envelope") + 1]!;
      expect(JSON.parse(readFileSync(conversationEnvelopePath, "utf8"))).toMatchObject({
        physicalProviderRequests: 1,
        convergence: { providerRequests: 1, recoveryAttempts: 1 },
      });
      for (let index = 1; index < commands.length; index += 1) {
        const continuationIndex = commands[index]!.indexOf("--continue-session");
        expect(commands[index]![continuationIndex + 1]).toBe(`conversation-session-${index}`);
      }
      expect(result.continuationSessionId).toBe("conversation-session-8");
      expect((result.output as ReturnType<typeof runEnvelope>).telemetry.providerRequests).toHaveLength(8);
      const report = collectContextEfficiencyTrials([{
        taskId: "ordinary_conversation_heavy",
        condition: "long_session",
        repetition: 1,
        output: result.output,
      }]);
      const projected = report.trials[0];
      if (!projected || !("run" in projected)) throw new Error("Expected one valid projected trial.");
      expect(projected.run.diagnostics.oracle).toBe("passed");
      expect(projected.run).not.toHaveProperty("answer");
    } finally {
      await dispatcher.cleanup();
    }
  });

  it("accepts ordinary run output only when canonical physical-request evidence is present", () => {
    expect(validateContextEfficiencyRunEnvelope(runEnvelope()).telemetry.providerRequests).toHaveLength(1);
    expect(() => validateContextEfficiencyRunEnvelope({
      ...runEnvelope(),
      telemetry: { ...runEnvelope().telemetry, providerRequests: [] },
    })).toThrow("Canonical provider-request observations are required");
  });

  it("rejects private content correlation fields", () => {
    const envelope = runEnvelope();
    const request = { ...envelope.telemetry.providerRequests[0], systemHash: "sha256:dictionary-testable" };
    expect(() => validateContextEfficiencyRunEnvelope({
      ...envelope,
      telemetry: { ...envelope.telemetry, providerRequests: [request] },
    })).toThrow("Forbidden private correlation field 'systemHash'");
  });

  it("retains failed rows under a diagnostic-only verdict ceiling", () => {
    const failed = runEnvelope();
    const report = collectContextEfficiencyTrials([{
      taskId: "trivial_exact",
      condition: "cold",
      repetition: 1,
      output: {
        ...failed,
        telemetry: { ...failed.telemetry, sessionSucceeded: false },
        diagnostics: { lastError: "provider failed", attempts: [] },
      },
    }]);
    expect(report.verdictCeiling).toBe("diagnostic-only");
    const projected = report.trials[0];
    if (!projected || !("run" in projected)) throw new Error("Expected one valid projected trial.");
    expect(projected.run.telemetry.sessionSucceeded).toBe(false);
    expect(projected.run).not.toHaveProperty("answer");
    expect(projected.run.telemetry).not.toHaveProperty("task");
    expect(projected.run.diagnostics).toEqual({ failed: true, oracle: "unknown", authority: "unknown" });
  });

  it("reports preregistered per-cell counts, medians, nearest-rank p95, and unknowns", () => {
    const outputWithInput = (inputTokens: number) => {
      const output = runEnvelope();
      return { ...output, telemetry: { ...output.telemetry, inputTokens } };
    };
    const report = collectContextEfficiencyTrials([
      { taskId: "trivial_exact", condition: "cold", repetition: 1, output: outputWithInput(10) },
      { taskId: "trivial_exact", condition: "cold", repetition: 2, output: outputWithInput(20) },
      { taskId: "trivial_exact", condition: "cold", repetition: 3, output: outputWithInput(30) },
      {
        taskId: "trivial_exact",
        condition: "cold",
        repetition: 3,
        attempt: 1,
        validity: "invalid",
        invalidReason: "infrastructure_failure",
      },
    ]);

    expect(report.cells).toHaveLength(1);
    expect(report.cells[0]).toMatchObject({
      taskId: "trivial_exact",
      condition: "cold",
      repetitionCount: 3,
      attemptCount: 4,
      sampleCount: 3,
      failureCount: 0,
      invalidCount: 1,
      unsupportedCount: 0,
      metrics: {
        inputTokens: { observedCount: 3, unknownCount: 0, median: 20, p95NearestRank: 30 },
        cacheReadTokens: { observedCount: 3, unknownCount: 0, median: 0, p95NearestRank: 0 },
        compactionCount: { observedCount: 0, unknownCount: 3, median: null, p95NearestRank: null },
      },
    });
  });
});
