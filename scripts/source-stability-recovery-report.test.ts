import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_SOURCE_STABILITY_RECOVERY_CASE_IDS,
  KILN_LIVE_MANAGED_AGENT_TESTS,
  buildSourceStabilityRecoveryReport,
  deriveSourceStabilityLiveProofResults,
  deriveSourceStabilityLiveObservation,
  parseSourceStabilityRecoveryManifest,
  parseVitestSourceStabilityResults,
  type SourceStabilityEvidenceLocator,
  type SourceStabilityImplementedLiveProof,
  type ParsedVitestSourceStabilityAssertion,
  type SourceStabilityRecoveryManifest,
  type SourceStabilityRecoveryManifestCase,
  type SourceStabilityRecoveryReportInput,
  type SourceStabilityExecutorProvenance,
} from "./source-stability-recovery-report.js";

const MANIFEST_PATH = new URL("./fixtures/source-stability-recovery.manifest.json", import.meta.url);
const REPOSITORY_ROOT = "C:\\workspace\\kiln";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const OPENCODE_AUTHORITY = "KILN_LIVE_OPENCODE_TESTS";
const OPENCODE_GO_AUTHORITY = "KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_TESTS";

function readManifest(): SourceStabilityRecoveryManifest {
  const parsed = parseSourceStabilityRecoveryManifest(
    JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as unknown,
  );
  if (parsed.status === "invalid") {
    throw new Error(`fixture manifest is invalid: ${parsed.diagnostics.map((diagnostic) => diagnostic.code).join(",")}`);
  }
  return parsed.value;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mutableManifest(manifest: SourceStabilityRecoveryManifest): {
  cases: Array<{
    id: (typeof CANONICAL_SOURCE_STABILITY_RECOVERY_CASE_IDS)[number];
    deterministicEvidence: Array<SourceStabilityEvidenceLocator>;
    liveEvidence: {
      coverage: "exact" | "partial" | "none";
      proofIds: string[];
    };
  }>;
  liveProofs: Array<Record<string, unknown>>;
} {
  return manifest as unknown as {
    cases: Array<{
      id: (typeof CANONICAL_SOURCE_STABILITY_RECOVERY_CASE_IDS)[number];
      deterministicEvidence: Array<SourceStabilityEvidenceLocator>;
      liveEvidence: {
        coverage: "exact" | "partial" | "none";
        proofIds: string[];
      };
    }>;
    liveProofs: Array<Record<string, unknown>>;
  };
}

function executors(): readonly SourceStabilityExecutorProvenance[] {
  return [
    {
      providerId: "opencode",
      harnessId: "opencode-cli",
      harnessVersion: "1.18.18",
      enabledAuthorityFlags: [KILN_LIVE_MANAGED_AGENT_TESTS, OPENCODE_AUTHORITY],
    },
    {
      providerId: "opencode-go",
      harnessId: "kiln-direct-runtime",
      harnessVersion: "3.0.0-beta.1",
      enabledAuthorityFlags: [KILN_LIVE_MANAGED_AGENT_TESTS, OPENCODE_GO_AUTHORITY],
    },
  ];
}

function reportInput(
  manifest: SourceStabilityRecoveryManifest,
  overrides: Partial<SourceStabilityRecoveryReportInput> = {},
): SourceStabilityRecoveryReportInput {
  return {
    manifest,
    repositoryRoot: REPOSITORY_ROOT,
    candidate: { commit: COMMIT, dirty: false },
    environment: { platform: "win32", arch: "x64", bun: "1.4.0", node: "24.15.0" },
    executors: executors(),
    selectedAuthorityFlags: [KILN_LIVE_MANAGED_AGENT_TESTS, OPENCODE_AUTHORITY, OPENCODE_GO_AUTHORITY],
    preflight: "allowed",
    liveRun: { status: "completed", exitCode: 0 },
    liveVitest: { testResults: [] },
    ...overrides,
  } as unknown as SourceStabilityRecoveryReportInput;
}

function vitestResult(
  path: string,
  title: string,
  status: "passed" | "failed" | "skipped" | "todo" | "pending",
): unknown {
  return {
    testResults: [
      {
        name: path,
        assertionResults: [
          {
            title,
            fullName: title,
            status,
            failureMessages: ["raw provider payload must not leak", "raw incident body must not leak"],
            message: "raw error must not leak",
          },
        ],
      },
    ],
  };
}

function deterministicPasses(manifest: SourceStabilityRecoveryManifest): unknown {
  return {
    testResults: manifest.cases.flatMap((entry) => entry.deterministicEvidence.map((locator) => ({
      name: `${REPOSITORY_ROOT}\\${locator.path.replaceAll("/", "\\")}`,
      assertionResults: [{ title: locator.title, fullName: locator.title, status: "passed" }],
    }))),
  };
}

function syntheticExactCase(): SourceStabilityRecoveryManifestCase {
  return {
    id: "revision-pinning",
    owner: "runtime-session",
    expectedState: "synthetic exact evidence",
    cleanup: "synthetic finalizer completed",
    deterministicEvidence: [],
    liveEvidence: {
      coverage: "exact",
      proofIds: ["synthetic-exact"],
      locators: [],
    },
  };
}

function syntheticExactProof(
  overrides: Partial<SourceStabilityImplementedLiveProof> = {},
): SourceStabilityImplementedLiveProof {
  return {
    kind: "implemented",
    id: "synthetic-exact",
    owner: "synthetic owner",
    expectedState: "synthetic exact evidence",
    cleanup: "synthetic finalizer completed",
    locator: { path: "scripts/fixtures/synthetic-live.test.ts", title: "synthetic exact case" },
    providerId: "opencode",
    harnessId: "opencode-cli",
    authorityFlags: [KILN_LIVE_MANAGED_AGENT_TESTS, OPENCODE_AUTHORITY],
    configurationFlags: [],
    ...overrides,
  };
}

function deriveSyntheticObservation(
  entry: SourceStabilityRecoveryManifestCase,
  assertions: readonly ParsedVitestSourceStabilityAssertion[],
  executorList: readonly SourceStabilityExecutorProvenance[] = executors(),
  selectedFlags: readonly string[] = [KILN_LIVE_MANAGED_AGENT_TESTS, OPENCODE_AUTHORITY],
  proof: SourceStabilityImplementedLiveProof = syntheticExactProof(),
  preflight: "allowed" | "denied" = "allowed",
) {
  const proofs = deriveSourceStabilityLiveProofResults(
    [proof],
    assertions,
    executorList,
    selectedFlags,
    preflight,
    { status: "completed", exitCode: 0 },
    true,
  );
  return deriveSourceStabilityLiveObservation(entry, proofs);
}

describe("source-stability recovery manifest", () => {
  it("parses the canonical twelve-case matrix and leaves v1 without exact live mappings", () => {
    const manifest = readManifest();

    expect(manifest.schema).toBe("kiln.source-stability-recovery-manifest/v1");
    expect(manifest.version).toBe(1);
    expect(manifest.scenario).toBe("source-stability-recovery");
    expect(manifest.cases.map((entry) => entry.id)).toEqual(CANONICAL_SOURCE_STABILITY_RECOVERY_CASE_IDS);
    expect(manifest.cases).toHaveLength(12);
    expect(manifest.cases.every((entry) => entry.deterministicEvidence.length > 0)).toBe(true);
    expect(manifest.cases.filter((entry) => entry.liveEvidence.coverage === "exact")).toHaveLength(0);
    expect(manifest.cases.find((entry) => entry.id === "conflicting-evidence")?.deterministicEvidence).toEqual([
      {
        path: "packages/runtime/tests/managed-agent/invocation-service.recovery.test.ts",
        title: "rejects terminal recovery checkpoints when record lifecycle does not match checkpoint state",
      },
    ]);
    expect(manifest.cases.find((entry) => entry.id === "cancellation-settlement")?.liveEvidence.coverage).toBe("partial");
  });

  it("rejects a v1 manifest mutated to exact live coverage at report construction", () => {
    const manifest = clone(readManifest());
    const mutable = mutableManifest(manifest);
    const entry = mutable.cases.find((candidate) => candidate.id === "revision-pinning");
    if (!entry) throw new Error("missing revision-pinning case");
    entry.liveEvidence = {
      coverage: "exact",
      proofIds: ["fixture-isolated-write"],
    };

    expect(() => buildSourceStabilityRecoveryReport(reportInput(manifest))).toThrow(/canonical|exact|manifest/iu);
  });

  it("rejects provider and harness cross-variant live locators", () => {
    const manifest = clone(readManifest());
    const mutable = mutableManifest(manifest);
    const proof = mutable.liveProofs.find((candidate) => candidate.id === "opencode-cancellation");
    if (!proof) throw new Error("missing opencode-cancellation proof");
    proof.harnessId = "kiln-direct-runtime";

    const parsed = parseSourceStabilityRecoveryManifest(manifest);

    expect(parsed.status).toBe("invalid");
    if (parsed.status === "invalid") expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toContain("live-authority-flags");
  });

  it("accepts Codex OAuth direct and managed-account variants only with their matching authority", () => {
    const direct = clone(readManifest());
    const directMutable = mutableManifest(direct);
    const directProof = directMutable.liveProofs.find((candidate) => candidate.id === "opencode-cancellation");
    if (!directProof) throw new Error("missing opencode-cancellation proof");
    directProof.providerId = "codex-oauth";
    directProof.harnessId = "kiln-direct-runtime";
    directProof.authorityFlags = [KILN_LIVE_MANAGED_AGENT_TESTS, "KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS"];
    expect(parseSourceStabilityRecoveryManifest(direct).status).toBe("valid");

    const managed = clone(readManifest());
    const managedMutable = mutableManifest(managed);
    const managedProof = managedMutable.liveProofs.find((candidate) => candidate.id === "opencode-cancellation");
    if (!managedProof) throw new Error("missing opencode-cancellation proof");
    managedProof.providerId = "codex-oauth";
    managedProof.harnessId = "kiln-managed-account-runtime";
    managedProof.authorityFlags = [KILN_LIVE_MANAGED_AGENT_TESTS, "KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS"];
    expect(parseSourceStabilityRecoveryManifest(managed).status).toBe("valid");
  });

  it("rejects configuration variables classified as live authority", () => {
    const manifest = clone(readManifest());
    const mutable = mutableManifest(manifest);
    const proof = mutable.liveProofs.find((candidate) => candidate.id === "opencode-cancellation");
    if (!proof) throw new Error("missing opencode-cancellation proof");
    proof.authorityFlags = [...(proof.authorityFlags as string[]), "KILN_LIVE_OPENCODE_MODEL"];

    const parsed = parseSourceStabilityRecoveryManifest(manifest);

    expect(parsed.status).toBe("invalid");
    if (parsed.status === "invalid") expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toContain("authority-flag");
  });

  it("rejects duplicate cases, unsafe paths, and malformed live authority/configuration fields", () => {
    const manifest = clone(readManifest());
    const mutable = mutableManifest(manifest);
    mutable.cases[1]!.id = mutable.cases[0]!.id;
    mutable.cases[0]!.deterministicEvidence[0]!.path = "C:/operator/private.test.ts";
    (mutable.liveProofs.find((candidate) => candidate.id === "opencode-cancellation")!).configurationFlags = [KILN_LIVE_MANAGED_AGENT_TESTS];

    const parsed = parseSourceStabilityRecoveryManifest(manifest);

    expect(parsed.status).toBe("invalid");
    if (parsed.status === "invalid") {
      expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
        expect.arrayContaining(["case-duplicate", "unsafe-path", "live-configuration-flags"]),
      );
    }
  });

  it("requires locators, required authority, and configuration separation for live coverage", () => {
    const manifest = clone(readManifest());
    const mutable = mutableManifest(manifest);
    const proof = mutable.liveProofs.find((candidate) => candidate.id === "opencode-cancellation");
    if (!proof) throw new Error("missing opencode-cancellation proof");
    proof.authorityFlags = [OPENCODE_AUTHORITY];

    const parsed = parseSourceStabilityRecoveryManifest(manifest);

    expect(parsed.status).toBe("invalid");
    if (parsed.status === "invalid") {
      expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toContain("live-authority-flags");
    }
  });
});

describe("Vitest source-stability boundary", () => {
  it("normalizes a real Windows absolute Vitest path against the explicit repository root", () => {
    const parsed = parseVitestSourceStabilityResults(
      vitestResult(
        "C:\\workspace\\kiln\\packages\\runtime\\tests\\managed-agent\\invocation-service.recovery.test.ts",
        "synthetic exact case",
        "passed",
      ),
      REPOSITORY_ROOT,
    );

    expect(parsed.status).toBe("valid");
    if (parsed.status === "valid") expect(parsed.value[0]?.path).toBe("packages/runtime/tests/managed-agent/invocation-service.recovery.test.ts");
  });

  it("rejects a Vitest result outside the trusted repository root", () => {
    const parsed = parseVitestSourceStabilityResults(
      vitestResult("C:\\other\\private.test.ts", "synthetic exact case", "passed"),
      REPOSITORY_ROOT,
    );

    expect(parsed.status).toBe("invalid");
    if (parsed.status === "invalid") expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toContain("outside-root");
  });

  it("ignores failure messages while retaining only the relevant assertion fields", () => {
    const parsed = parseVitestSourceStabilityResults(
      vitestResult("scripts/fixtures/synthetic-live.test.ts", "synthetic exact case", "failed"),
      REPOSITORY_ROOT,
    );

    expect(parsed.status).toBe("valid");
    if (parsed.status === "valid") {
      expect(parsed.value).toEqual([{
        path: "scripts/fixtures/synthetic-live.test.ts",
        title: "synthetic exact case",
        fullName: "synthetic exact case",
        status: "failed",
      }]);
    }
  });
});

describe("source-stability provenance and report derivation", () => {
  it.each([
    ["passed", "executed", "test-passed"],
    ["failed", "failed", "test-failed"],
    ["skipped", "skipped", "test-skipped"],
    ["todo", "skipped", "test-skipped"],
    ["pending", "skipped", "test-skipped"],
  ] as const)("maps an exact Vitest %s result only through matching executor provenance", (status, expectedStatus, expectedReason) => {
    const entry = syntheticExactCase();
    const parsed = parseVitestSourceStabilityResults(
      vitestResult("C:\\workspace\\kiln\\scripts\\fixtures\\synthetic-live.test.ts", "synthetic exact case", status),
      REPOSITORY_ROOT,
    );
    if (parsed.status === "invalid") throw new Error("synthetic Vitest result is invalid");

    const observation = deriveSyntheticObservation(entry, parsed.value);

    expect(observation).toMatchObject({ status: expectedStatus, reasonCode: expectedReason, coverage: "exact" });
    expect(observation.selectedLocator?.providerId).toBe("opencode");
    expect(observation.executor?.harnessVersion).toBe("1.18.18");
  });

  it("requires and attaches executor provenance for a skipped matched assertion", () => {
    const entry = syntheticExactCase();
    const parsed = parseVitestSourceStabilityResults(
      vitestResult("C:\\workspace\\kiln\\scripts\\fixtures\\synthetic-live.test.ts", "synthetic exact case", "skipped"),
      REPOSITORY_ROOT,
    );
    if (parsed.status === "invalid") throw new Error("synthetic Vitest result is invalid");

    const observation = deriveSyntheticObservation(entry, parsed.value);

    expect(observation.executor).toMatchObject({
      providerId: "opencode",
      harnessId: "opencode-cli",
      harnessVersion: "1.18.18",
    });
    expect(() => deriveSyntheticObservation(entry, parsed.value, [])).toThrow(/provenance/iu);
  });

  it("admits Codex OAuth provenance through the manifest-owned direct authority flag", () => {
    const source = syntheticExactCase();
    const proof = syntheticExactProof({
      providerId: "codex-oauth",
      harnessId: "kiln-direct-runtime",
      authorityFlags: [KILN_LIVE_MANAGED_AGENT_TESTS, "KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS"],
    });
    const entry: SourceStabilityRecoveryManifestCase = {
      ...source,
      liveEvidence: { ...source.liveEvidence },
    };
    const parsed = parseVitestSourceStabilityResults(
      vitestResult("C:\\workspace\\kiln\\scripts\\fixtures\\synthetic-live.test.ts", "synthetic exact case", "passed"),
      REPOSITORY_ROOT,
    );
    if (parsed.status === "invalid") throw new Error("synthetic Vitest result is invalid");

    const observation = deriveSyntheticObservation(entry, parsed.value, [{
      providerId: "codex-oauth",
      harnessId: "kiln-direct-runtime",
      harnessVersion: "3.0.0",
      enabledAuthorityFlags: [KILN_LIVE_MANAGED_AGENT_TESTS, "KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS"],
    }], [KILN_LIVE_MANAGED_AGENT_TESTS, "KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS"], proof);

    expect(observation.executor?.providerId).toBe("codex-oauth");
  });

  it.each([
    ["KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS", "KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS"],
    ["KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS", "KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS"],
  ] as const)("requires the executor to carry the selected Codex OAuth direct authority (%s)", (manifestAuthority, executorOnlyAuthority) => {
    const source = syntheticExactCase();
    const proof = syntheticExactProof({
      providerId: "codex-oauth",
      harnessId: "kiln-direct-runtime",
      authorityFlags: [KILN_LIVE_MANAGED_AGENT_TESTS, manifestAuthority],
    });
    const entry: SourceStabilityRecoveryManifestCase = {
      ...source,
      liveEvidence: { ...source.liveEvidence },
    };
    const parsed = parseVitestSourceStabilityResults(
      vitestResult("C:\\workspace\\kiln\\scripts\\fixtures\\synthetic-live.test.ts", "synthetic exact case", "passed"),
      REPOSITORY_ROOT,
    );
    if (parsed.status === "invalid") throw new Error("synthetic Vitest result is invalid");

    expect(() => deriveSyntheticObservation(entry, parsed.value, [{
      providerId: "codex-oauth",
      harnessId: "kiln-direct-runtime",
      harnessVersion: "3.0.0",
      enabledAuthorityFlags: [KILN_LIVE_MANAGED_AGENT_TESTS, executorOnlyAuthority],
    }], [KILN_LIVE_MANAGED_AGENT_TESTS, manifestAuthority], proof)).toThrow(/authority/iu);
  });

  it("accepts a Codex OAuth direct executor authorized for both read and write", () => {
    const source = syntheticExactCase();
    const bothFlags = [
      KILN_LIVE_MANAGED_AGENT_TESTS,
      "KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS",
      "KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS",
    ];
    const proof = syntheticExactProof({ providerId: "codex-oauth", harnessId: "kiln-direct-runtime", authorityFlags: bothFlags });
    const entry: SourceStabilityRecoveryManifestCase = {
      ...source,
      liveEvidence: { ...source.liveEvidence },
    };
    const parsed = parseVitestSourceStabilityResults(
      vitestResult("C:\\workspace\\kiln\\scripts\\fixtures\\synthetic-live.test.ts", "synthetic exact case", "passed"),
      REPOSITORY_ROOT,
    );
    if (parsed.status === "invalid") throw new Error("synthetic Vitest result is invalid");

    const observation = deriveSyntheticObservation(entry, parsed.value, [{
      providerId: "codex-oauth",
      harnessId: "kiln-direct-runtime",
      harnessVersion: "3.0.0",
      enabledAuthorityFlags: [
        KILN_LIVE_MANAGED_AGENT_TESTS,
        "KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS",
        "KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS",
      ],
    }], bothFlags, proof);

    expect(observation.executor?.enabledAuthorityFlags).toEqual(expect.arrayContaining([
      "KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS",
      "KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS",
    ]));
  });

  it("refuses passed/failed exact evidence without matching executor, authority, or exact harness version", () => {
    const entry = syntheticExactCase();
    const parsed = parseVitestSourceStabilityResults(
      vitestResult("scripts/fixtures/synthetic-live.test.ts", "synthetic exact case", "passed"),
      REPOSITORY_ROOT,
    );
    if (parsed.status === "invalid") throw new Error("synthetic Vitest result is invalid");

    expect(() => deriveSyntheticObservation(entry, parsed.value, [])).toThrow(/provenance/iu);
    expect(() => deriveSyntheticObservation(entry, parsed.value, [{
      ...executors()[0]!,
      enabledAuthorityFlags: [OPENCODE_AUTHORITY],
    }])).toThrow(/authority/iu);
    const actualVersion = deriveSyntheticObservation(entry, parsed.value, [{
      ...executors()[0]!,
      harnessVersion: "1.18.17",
    }]);
    expect(actualVersion.executor?.harnessVersion).toBe("1.18.17");
  });

  it("rejects duplicate executor identities even when no live assertion matches", () => {
    const duplicate = executors()[0]!;

    expect(() => buildSourceStabilityRecoveryReport(reportInput(readManifest(), {
      executors: [duplicate, { ...duplicate }],
      liveVitest: { testResults: [] },
    }))).toThrow(/duplicate|executor/iu);
  });

  it("keeps partial observations omitted and uses no-partial-observation when unmatched", () => {
    const manifest = readManifest();
    const entry = manifest.cases.find((candidate) => candidate.id === "cancellation-settlement");
    if (!entry) throw new Error("missing cancellation-settlement case");

    const noObservation = deriveSourceStabilityLiveObservation(entry, []);
    expect(noObservation).toMatchObject({ status: "omitted", reasonCode: "no-partial-observation" });

    const proof = manifest.liveProofs.find((candidate) => candidate.id === entry.liveEvidence.proofIds[0] && candidate.kind === "implemented");
    if (!proof || proof.kind !== "implemented") throw new Error("missing partial proof");
    const parsed = parseVitestSourceStabilityResults(
      vitestResult(`C:\\workspace\\kiln\\${proof.locator.path.replaceAll("/", "\\")}`, proof.locator.title, "passed"),
      REPOSITORY_ROOT,
    );
    if (parsed.status === "invalid") throw new Error("partial Vitest result is invalid");
    const proofResults = deriveSourceStabilityLiveProofResults(manifest.liveProofs, parsed.value, executors(), [KILN_LIVE_MANAGED_AGENT_TESTS, OPENCODE_AUTHORITY, OPENCODE_GO_AUTHORITY], "allowed");
    const observed = deriveSourceStabilityLiveObservation(entry, proofResults);
    expect(observed).toMatchObject({
      status: "omitted",
      reasonCode: "partial-observation",
      partialObservation: { status: "executed", reasonCode: "test-passed" },
    });
  });

  it.each([
    ["passed", "inconclusive", "not-run", "verified", undefined],
    ["failed", "failed", "unverified", "unverified", "case-failed:cancellation-settlement"],
    ["skipped", "inconclusive", "not-run", "not-run", "case-skipped:cancellation-settlement"],
  ] as const)("includes a %s partial observation in aggregate outcomes without upgrading the canonical case", (status, terminalOutcome, cleanupOutcome, caseCleanup, residualRisk) => {
    const manifest = readManifest();
    const entry = manifest.cases.find((candidate) => candidate.id === "cancellation-settlement");
    if (!entry) throw new Error("missing cancellation-settlement case");
    const proof = manifest.liveProofs.find((candidate) => candidate.id === entry.liveEvidence.proofIds[0] && candidate.kind === "implemented");
    if (!proof || proof.kind !== "implemented") throw new Error("missing partial proof");
    const report = buildSourceStabilityRecoveryReport(reportInput(manifest, {
      deterministicVitest: deterministicPasses(manifest),
      liveVitest: vitestResult(
        `${REPOSITORY_ROOT}\\${proof.locator.path.replaceAll("/", "\\")}`,
        proof.locator.title,
        status,
      ),
    }));
    const observed = report.cases.find((candidate) => candidate.id === entry.id)!;

    expect(observed.live).toMatchObject({
      status: "omitted",
      reasonCode: "partial-observation",
      partialObservation: {
        status: status === "passed" ? "executed" : status,
      },
    });
    expect(observed.cleanup).toBe(caseCleanup);
    expect(report.terminalOutcome).toBe(terminalOutcome);
    expect(report.cleanupOutcome).toBe(cleanupOutcome);
    if (residualRisk) expect(report.residualRisks).toContain(residualRisk);
  });

  it("omits all live cases on denied preflight and does not persist the repository root", () => {
    const report = buildSourceStabilityRecoveryReport(reportInput(readManifest(), {
      preflight: "denied",
      executors: [],
      selectedAuthorityFlags: [],
      liveRun: { status: "not-started", reasonCode: "preflight-denied" },
      liveVitest: undefined,
    }));

    expect(report.cases.every((entry) => entry.live.status === "omitted")).toBe(true);
    expect(report.cases.every((entry) => entry.live.reasonCode === "preflight-denied")).toBe(true);
    expect(JSON.stringify(report)).not.toContain(REPOSITORY_ROOT);
    expect(report.enabledAuthorityFlags).toEqual([]);
  });

  it.each([
    ["spawn-failed", undefined],
    ["test-process-terminated", undefined],
    ["missing-json", 0],
    ["malformed-json", 0],
  ] as const)("records a %s live-run failure without inventing live observations", (reasonCode, exitCode) => {
    const liveRun = {
      status: "failed" as const,
      reasonCode,
      ...(exitCode === undefined ? {} : { exitCode }),
    };
    const report = buildSourceStabilityRecoveryReport(reportInput(readManifest(), {
      liveRun,
      liveVitest: undefined,
    }));

    expect(report.liveRun).toEqual(liveRun);
    expect(report.terminalOutcome).toBe("failed");
    expect(report.cleanupOutcome).toBe(reasonCode === "spawn-failed" ? "not-run" : "unverified");
    expect(report.residualRisks).toContain(`live-run-failed:${reasonCode}`);
    expect(report.cases.every((entry) => entry.live.status === "omitted")).toBe(true);
    expect(report.cases.every((entry) => entry.live.reasonCode === "live-run-failed")).toBe(true);
    expect(JSON.stringify(report)).not.toContain("raw provider payload");
  });

  it("rejects contradictory live-run exit shapes", () => {
    const manifest = readManifest();
    for (const liveRun of [
      { status: "failed", reasonCode: "spawn-failed", exitCode: 1 },
      { status: "failed", reasonCode: "test-process-terminated", exitCode: 1 },
      { status: "failed", reasonCode: "missing-json" },
      { status: "failed", reasonCode: "malformed-json" },
      { status: "failed", reasonCode: "test-process-nonzero", exitCode: 0 },
    ]) {
      expect(() => buildSourceStabilityRecoveryReport(reportInput(manifest, {
        liveRun: liveRun as never,
        liveVitest: undefined,
      }))).toThrow(/liveRun|exitCode|JSON|terminated|nonzero/iu);
    }
  });

  it("retains valid live observations alongside a nonzero test-process failure", () => {
    const manifest = readManifest();
    const entry = manifest.cases.find((candidate) => candidate.id === "cancellation-settlement");
    if (!entry) throw new Error("missing cancellation-settlement case");
    const proof = manifest.liveProofs.find((candidate) => candidate.id === entry.liveEvidence.proofIds[0] && candidate.kind === "implemented");
    if (!proof || proof.kind !== "implemented") throw new Error("missing partial proof");
    const report = buildSourceStabilityRecoveryReport(reportInput(manifest, {
      liveRun: { status: "failed", reasonCode: "test-process-nonzero", exitCode: 1 },
      liveVitest: vitestResult(
        `${REPOSITORY_ROOT}\\${proof.locator.path.replaceAll("/", "\\")}`,
        proof.locator.title,
        "passed",
      ),
    }));

    const observed = report.cases.find((candidate) => candidate.id === entry.id)!;
    expect(report.liveRun).toEqual({ status: "failed", reasonCode: "test-process-nonzero", exitCode: 1 });
    expect(observed.live).toMatchObject({
      status: "omitted",
      reasonCode: "partial-observation",
      partialObservation: { status: "executed" },
    });
    expect(report.terminalOutcome).toBe("failed");
    expect(report.residualRisks).toContain("live-run-failed:test-process-nonzero");
    expect(report.cases.find((candidate) => candidate.id === "revision-pinning")?.live.reasonCode).toBe("live-run-failed");
  });

  it("enforces live-run status and JSON alignment without leaking raw run errors", () => {
    const manifest = readManifest();
    expect(() => buildSourceStabilityRecoveryReport(reportInput(manifest, {
      liveRun: { status: "completed", exitCode: 0 },
      liveVitest: undefined,
    }))).toThrow(/JSON|completed/iu);
    expect(() => buildSourceStabilityRecoveryReport(reportInput(manifest, {
      liveRun: { status: "failed", reasonCode: "spawn-failed", message: "raw secret incident body" } as never,
      liveVitest: undefined,
    }))).toThrow(/live-run|unsafe|field/iu);
    expect(() => buildSourceStabilityRecoveryReport(reportInput(manifest, {
      preflight: "denied",
      liveRun: { status: "not-started", reasonCode: "preflight-denied" },
      liveVitest: vitestResult("scripts/fixtures/ignored.test.ts", "ignored", "passed"),
    }))).toThrow(/live|JSON|preflight/iu);
  });

  it("uses optional deterministic Vitest evidence instead of an arbitrary status seam", () => {
    const manifest = readManifest();
    const locator = manifest.cases.find((entry) => entry.id === "revision-pinning")!.deterministicEvidence[0]!;
    const absent = buildSourceStabilityRecoveryReport(reportInput(manifest, { deterministicVitest: undefined }));
    expect(absent.cases.find((entry) => entry.id === "revision-pinning")?.deterministic).toMatchObject({
      status: "omitted",
      reasonCode: "no-deterministic-observation",
    });

    const observed = buildSourceStabilityRecoveryReport(reportInput(manifest, {
      deterministicVitest: vitestResult(`C:\\workspace\\kiln\\${locator.path.replaceAll("/", "\\")}`, locator.title, "passed"),
    }));
    expect(observed.cases.find((entry) => entry.id === "revision-pinning")?.deterministic).toMatchObject({
      status: "executed",
      reasonCode: "test-passed",
      cleanup: "verified",
    });
  });

  it("requires every deterministic locator for restart-recovery before reporting execution", () => {
    const manifest = readManifest();
    const restart = manifest.cases.find((entry) => entry.id === "restart-recovery");
    if (!restart || restart.deterministicEvidence.length !== 2) throw new Error("restart-recovery must have two locators");
    const [runtimeLocator, cliLocator] = restart.deterministicEvidence;
    if (!runtimeLocator || !cliLocator) throw new Error("restart-recovery locators are incomplete");
    const absolute = (locator: SourceStabilityEvidenceLocator, status: "passed" | "failed") =>
      vitestResult(`C:\\workspace\\kiln\\${locator.path.replaceAll("/", "\\")}`, locator.title, status);

    const onlyRuntime = buildSourceStabilityRecoveryReport(reportInput(manifest, {
      deterministicVitest: absolute(runtimeLocator, "passed"),
    }));
    expect(onlyRuntime.cases.find((entry) => entry.id === "restart-recovery")?.deterministic).toMatchObject({
      status: "omitted",
      reasonCode: "no-deterministic-observation",
      cleanup: "not-run",
    });

    const bothPassed = buildSourceStabilityRecoveryReport(reportInput(manifest, {
      deterministicVitest: {
        testResults: [
          ...(absolute(runtimeLocator, "passed") as { testResults: unknown[] }).testResults,
          ...(absolute(cliLocator, "passed") as { testResults: unknown[] }).testResults,
        ],
      },
    }));
    expect(bothPassed.cases.find((entry) => entry.id === "restart-recovery")?.deterministic).toMatchObject({
      status: "executed",
      reasonCode: "test-passed",
      cleanup: "verified",
    });

    const oneFailed = buildSourceStabilityRecoveryReport(reportInput(manifest, {
      deterministicVitest: {
        testResults: [
          ...(absolute(runtimeLocator, "passed") as { testResults: unknown[] }).testResults,
          ...(absolute(cliLocator, "failed") as { testResults: unknown[] }).testResults,
        ],
      },
    }));
    expect(oneFailed.cases.find((entry) => entry.id === "restart-recovery")?.deterministic).toMatchObject({
      status: "failed",
      reasonCode: "test-failed",
      cleanup: "unverified",
    });
  });

  it("keeps a uniquely attributable deterministic failure when another required locator is missing", () => {
    const manifest = readManifest();
    const restart = manifest.cases.find((entry) => entry.id === "restart-recovery");
    if (!restart) throw new Error("missing restart-recovery case");
    const failedLocator = restart.deterministicEvidence[0]!;

    const report = buildSourceStabilityRecoveryReport(reportInput(manifest, {
      deterministicVitest: vitestResult(
        `${REPOSITORY_ROOT}\\${failedLocator.path.replaceAll("/", "\\")}`,
        failedLocator.title,
        "failed",
      ),
    }));

    expect(report.cases.find((entry) => entry.id === restart.id)?.deterministic).toMatchObject({
      status: "failed",
      reasonCode: "test-failed",
      cleanup: "unverified",
    });
  });

  it("keeps a uniquely attributable deterministic failure when another locator is ambiguous", () => {
    const manifest = readManifest();
    const restart = manifest.cases.find((entry) => entry.id === "restart-recovery");
    if (!restart) throw new Error("missing restart-recovery case");
    const [failedLocator, duplicateLocator] = restart.deterministicEvidence;
    if (!failedLocator || !duplicateLocator) throw new Error("restart-recovery locators are incomplete");

    const failed = vitestResult(
      `${REPOSITORY_ROOT}\\${failedLocator.path.replaceAll("/", "\\")}`,
      failedLocator.title,
      "failed",
    ) as { testResults: unknown[] };
    const duplicate = vitestResult(
      `${REPOSITORY_ROOT}\\${duplicateLocator.path.replaceAll("/", "\\")}`,
      duplicateLocator.title,
      "passed",
    ) as { testResults: unknown[] };
    const report = buildSourceStabilityRecoveryReport(reportInput(manifest, {
      deterministicVitest: { testResults: [...failed.testResults, ...duplicate.testResults, ...duplicate.testResults] },
    }));

    expect(report.cases.find((entry) => entry.id === restart.id)?.deterministic).toMatchObject({
      status: "failed",
      reasonCode: "test-failed",
      cleanup: "unverified",
    });
  });

  it("keeps ambiguous duplicate deterministic evidence omitted without a separate known failure", () => {
    const manifest = readManifest();
    const restart = manifest.cases.find((entry) => entry.id === "restart-recovery");
    if (!restart) throw new Error("missing restart-recovery case");
    const duplicateLocator = restart.deterministicEvidence[0]!;
    const result = vitestResult(
      `${REPOSITORY_ROOT}\\${duplicateLocator.path.replaceAll("/", "\\")}`,
      duplicateLocator.title,
      "failed",
    ) as { testResults: unknown[] };

    const report = buildSourceStabilityRecoveryReport(reportInput(manifest, {
      deterministicVitest: { testResults: [...result.testResults, ...result.testResults] },
    }));

    expect(report.cases.find((entry) => entry.id === restart.id)?.deterministic).toMatchObject({
      status: "omitted",
      reasonCode: "no-deterministic-observation",
      cleanup: "not-run",
    });
  });

  it("derives terminal outcome, cleanup outcome, and stable residual risks", () => {
    const report = buildSourceStabilityRecoveryReport(reportInput(readManifest(), {
      candidate: { commit: COMMIT, dirty: true },
    }));

    expect(report.terminalOutcome).toBe("inconclusive");
    expect(report.cleanupOutcome).toBe("not-run");
    expect(report.residualRisks).toEqual(expect.arrayContaining([
      "candidate-dirty",
      "deterministic-evidence-not-run",
      "live-evidence-not-exact",
    ]));
    expect(report.releaseReadiness).toBe("not-evidence");
    expect(JSON.stringify(report)).toContain("not release-readiness evidence");
  });

  it("requires a lowercase forty- or sixty-four-hex commit OID", () => {
    for (const commit of ["main", "latest", "ABCDEF0123456789abcdef0123456789abcdef01", "0123456"]) {
      expect(() => buildSourceStabilityRecoveryReport(reportInput(readManifest(), {
        candidate: { commit, dirty: false },
      }))).toThrow(/commit/iu);
    }
  });

  it.each([
    "sk-proj-123456789012345678901234",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.signature-value",
    "account-id:acct_123456789",
    "subscription_id:sub_123456789",
    "Bearer abcdefghijklmnop",
  ])("rejects credential/account/subscription-shaped metadata: %s", (value) => {
    expect(() => buildSourceStabilityRecoveryReport(reportInput(readManifest(), {
      executors: [{
        providerId: "opencode",
        harnessId: "opencode-cli",
        harnessVersion: "1.18.18",
        model: value,
        enabledAuthorityFlags: [KILN_LIVE_MANAGED_AGENT_TESTS, OPENCODE_AUTHORITY],
      }],
    }))).toThrow(/unsafe|credential|metadata/iu);
  });

  it("catalogs every implemented managed-agent live assertion and the three planned omissions", () => {
    const manifest = readManifest() as SourceStabilityRecoveryManifest & {
      readonly liveProofs: readonly {
        readonly id: string;
        readonly kind: "implemented" | "planned";
        readonly locator?: { readonly path: string; readonly title: string };
      }[];
    };
    const expected = [
      ["fixture-isolated-write", "packages/runtime/tests/managed-agent/live-test-harness.live.test.ts", "records filesystem result and canonical write evidence inside an isolated workspace"],
      ["codex-read-boundary", "packages/runtime/tests/managed-agent/codex-live-proof.live.test.ts", "does not accept a real Codex write attempt under read-only authority"],
      ["codex-approved-write", "packages/runtime/tests/managed-agent/codex-live-proof.live.test.ts", "records a real Codex approved fixture write as canonical write evidence"],
      ["claude-read-boundary", "packages/runtime/tests/managed-agent/claude-live-proof.live.test.ts", "runs a read-only managed child in Claude plan mode without changing the fixture"],
      ["opencode-read-boundary", "packages/runtime/tests/managed-agent/opencode-live-proof.live.test.ts", "keeps the Kiln fixture boundary unchanged under read-only authority"],
      ["opencode-approved-write", "packages/runtime/tests/managed-agent/opencode-live-proof.live.test.ts", "records a real OpenCode approved fixture write as canonical write evidence"],
      ["opencode-cancellation", "packages/runtime/tests/managed-agent/opencode-live-proof.live.test.ts", "keeps real OpenCode cancellation canonical and suppresses late write evidence"],
      ["opencode-go-approved-write-replay", "packages/runtime/tests/managed-agent/opencode-go-direct-managed-write.live.test.ts", "commits, fences, writes, settles, and replays one approved disposable job"],
      ["openai-direct-read", "packages/runtime/tests/managed-agent/openai-direct-live-proof.live.test.ts", "reads a governed fixture through Kiln builtin tool authority"],
      ["codex-oauth-direct-read", "packages/runtime/tests/managed-agent/codex-oauth-direct-live-proof.live.test.ts", "reads a governed fixture through the subscription-backed direct adapter"],
      ["codex-oauth-direct-write", "packages/runtime/tests/managed-agent/codex-oauth-direct-live-proof.live.test.ts", "records a subscription-backed direct-provider approved fixture write as canonical write evidence"],
      ["codex-oauth-managed-account-fail-closed", "packages/runtime/tests/managed-agent/codex-oauth-managed-account-live-proof.live.test.ts", "fails closed before dispatch while postcommit account execution is unavailable"],
    ] as const;
    const proofs = manifest.liveProofs;
    const implementedProofs = proofs.filter((proof) => proof.kind === "implemented");

    expect(proofs).toHaveLength(15);
    expect(proofs.filter((proof) => proof.kind === "implemented")).toHaveLength(12);
    expect(proofs.filter((proof) => proof.kind === "planned").map((proof) => proof.id)).toEqual([
      "transport-disconnect",
      "credential-expiry",
      "capacity-exhaustion",
    ]);
    for (const [id, path, title] of expected) {
      expect(proofs.find((proof) => proof.id === id)).toMatchObject({
        kind: "implemented",
        locator: { path, title },
      });
    }
    expect(new Set(proofs.map((proof) => proof.id)).size).toBe(proofs.length);
    const locators = implementedProofs.map((proof) => `${proof.locator.path}\u0000${proof.locator.title}`);
    expect(new Set(locators).size).toBe(locators.length);
  });

  it("keeps canonical recovery mappings as proof references and derives partial observations from them", () => {
    const manifest = readManifest() as SourceStabilityRecoveryManifest & {
      readonly cases: readonly (SourceStabilityRecoveryManifest["cases"][number] & {
        readonly liveEvidence: { readonly coverage: "none" | "partial" | "exact"; readonly proofIds: readonly string[] };
      })[];
    };
    expect(manifest.cases.find((entry) => entry.id === "duplicate-ingress")?.liveEvidence).toEqual({
      coverage: "partial",
      proofIds: ["opencode-go-approved-write-replay"],
    });
    expect(manifest.cases.find((entry) => entry.id === "cancellation-settlement")?.liveEvidence).toEqual({
      coverage: "partial",
      proofIds: ["opencode-cancellation"],
    });
    expect(manifest.cases.find((entry) => entry.id === "settlement-capacity-retention")?.liveEvidence).toEqual({
      coverage: "partial",
      proofIds: ["capacity-exhaustion"],
    });
  });

  it("persists allowed preflight executor-provenance-unavailable without inventing executors", () => {
    const manifest = readManifest();
    const flags = [KILN_LIVE_MANAGED_AGENT_TESTS, OPENCODE_AUTHORITY];
    const report = buildSourceStabilityRecoveryReport(reportInput(manifest, {
      executors: [],
      selectedAuthorityFlags: flags,
      liveRun: { status: "not-started", reasonCode: "executor-provenance-unavailable" } as never,
      liveVitest: undefined,
    } as never));

    expect(report.liveRun).toEqual({
      status: "not-started",
      reasonCode: "executor-provenance-unavailable",
    });
    expect(report.executors).toEqual([]);
    expect(report.enabledAuthorityFlags).toEqual(flags);
    expect(report.liveProofOutcome).toBe("inconclusive");
    expect(report.terminalOutcome).toBe("inconclusive");
    expect(report.cleanupOutcome).toBe("not-run");
    expect(report.residualRisks).toContain("executor-provenance-unavailable");
  });

  it("rejects contradictory executor-provenance-unavailable shapes and raw metadata", () => {
    const manifest = readManifest();
    const flags = [KILN_LIVE_MANAGED_AGENT_TESTS, OPENCODE_AUTHORITY];
    const cases = [
      { preflight: "denied", executors: [], selectedAuthorityFlags: flags },
      { preflight: "allowed", executors: executors(), selectedAuthorityFlags: flags },
      { preflight: "allowed", executors: [], selectedAuthorityFlags: [] },
      { preflight: "allowed", executors: [], selectedAuthorityFlags: flags, liveVitest: { testResults: [] } },
      { preflight: "allowed", executors: [], selectedAuthorityFlags: flags, liveRun: { status: "not-started", reasonCode: "executor-provenance-unavailable", callerOutcome: "zero" } },
      { preflight: "allowed", executors: [], selectedAuthorityFlags: flags, liveRun: { status: "not-started", reasonCode: "executor-provenance-unavailable", message: "raw incident body" } },
    ];
    for (const overrides of cases) {
      expect(() => buildSourceStabilityRecoveryReport(reportInput(manifest, {
        ...overrides,
        liveRun: overrides.liveRun ?? { status: "not-started", reasonCode: "executor-provenance-unavailable" },
        liveVitest: "liveVitest" in overrides ? overrides.liveVitest : undefined,
      } as never))).toThrow(/provenance|preflight|authority|JSON|raw|caller|liveRun/iu);
    }
  });

  it("does not treat empty valid Vitest JSON as a successful authorized live proof run", () => {
    const report = buildSourceStabilityRecoveryReport(reportInput(readManifest(), {
      liveRun: { status: "completed", exitCode: 0 },
      liveVitest: { testResults: [] },
    }));

    expect(report.liveProofOutcome).toBe("inconclusive");
    expect(report.liveProofs.some((proof) => proof.status === "executed")).toBe(false);
    expect(report.liveProofs.filter((proof) => proof.kind === "implemented").every((proof) => proof.status === "omitted")).toBe(true);
  });

  it("reports planned proofs as omitted without locators or invented evidence", () => {
    const report = buildSourceStabilityRecoveryReport(reportInput(readManifest()));
    for (const id of ["transport-disconnect", "credential-expiry", "capacity-exhaustion"]) {
      const proof = report.liveProofs.find((candidate) => candidate.id === id);
      expect(proof).toMatchObject({
        kind: "planned",
        status: "omitted",
        reasonCode: "proof-not-implemented",
        cleanup: "not-run",
      });
      expect(proof?.selectedLocator).toBeUndefined();
      expect(proof?.executor).toBeUndefined();
      expect(report.residualRisks).toContain(`proof-not-implemented:${id}`);
    }
  });

  it("omits a disabled proof even when Vitest emitted skipped, then preserves skipped provenance when selected", () => {
    const manifest = readManifest();
    const proof = manifest.liveProofs.find((candidate) => candidate.id === "opencode-approved-write" && candidate.kind === "implemented");
    if (!proof || proof.kind !== "implemented") throw new Error("missing OpenCode write proof");
    const assertion = vitestResult(`${REPOSITORY_ROOT}\\${proof.locator.path.replaceAll("/", "\\")}`, proof.locator.title, "skipped");
    const disabled = buildSourceStabilityRecoveryReport(reportInput(manifest, {
      liveVitest: assertion,
      selectedAuthorityFlags: [KILN_LIVE_MANAGED_AGENT_TESTS, OPENCODE_AUTHORITY],
      executors: [{
        providerId: "opencode",
        harnessId: "opencode-cli",
        harnessVersion: "1.18.18",
        enabledAuthorityFlags: [KILN_LIVE_MANAGED_AGENT_TESTS, OPENCODE_AUTHORITY],
      }],
    } as never));
    expect(disabled.liveProofs.find((candidate) => candidate.id === proof.id)).toMatchObject({
      status: "omitted",
      reasonCode: "authority-not-enabled",
    });

    const writeFlags = [KILN_LIVE_MANAGED_AGENT_TESTS, OPENCODE_AUTHORITY, "KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS"];
    const selected = buildSourceStabilityRecoveryReport(reportInput(manifest, {
      executors: [{
        providerId: "opencode",
        harnessId: "opencode-cli",
        harnessVersion: "1.18.18",
        enabledAuthorityFlags: writeFlags,
      }],
      selectedAuthorityFlags: writeFlags,
      liveVitest: assertion,
    } as never));
    expect(selected.liveProofs.find((candidate) => candidate.id === proof.id)).toMatchObject({
      status: "skipped",
      reasonCode: "test-skipped",
      selectedLocator: proof.locator,
      executor: { providerId: "opencode", harnessId: "opencode-cli" },
    });
  });

  it.each(["passed", "failed"] as const)("rejects a %s assertion for an implemented proof whose authority is disabled", (status) => {
    const manifest = readManifest();
    const proof = manifest.liveProofs.find((candidate) => candidate.id === "opencode-approved-write");
    if (!proof || proof.kind !== "implemented") throw new Error("missing OpenCode write proof");
    expect(() => buildSourceStabilityRecoveryReport(reportInput(manifest, {
      executors: [{
        providerId: "opencode",
        harnessId: "opencode-cli",
        harnessVersion: "1.18.18",
        enabledAuthorityFlags: [KILN_LIVE_MANAGED_AGENT_TESTS, OPENCODE_AUTHORITY],
      }],
      selectedAuthorityFlags: [KILN_LIVE_MANAGED_AGENT_TESTS, OPENCODE_AUTHORITY],
      liveVitest: vitestResult(`${REPOSITORY_ROOT}\\${proof.locator.path.replaceAll("/", "\\")}`, proof.locator.title, status),
    }))).toThrow(/disabled|authority|contradict/iu);
  });

  it("rejects a live assertion that is not uniquely cataloged by one implemented proof", () => {
    const manifest = readManifest();
    expect(() => buildSourceStabilityRecoveryReport(reportInput(manifest, {
      liveVitest: vitestResult(`${REPOSITORY_ROOT}\\packages\\runtime\\tests\\managed-agent\\unknown.live.test.ts`, "unlisted live assertion", "skipped"),
    }))).toThrow(/catalog|proof|locator|uniqu/iu);
  });

  it("requires exact selected/enabled authority accounting across executors", () => {
    const manifest = readManifest();
    expect(() => buildSourceStabilityRecoveryReport(reportInput(manifest, {
      selectedAuthorityFlags: [KILN_LIVE_MANAGED_AGENT_TESTS, OPENCODE_AUTHORITY, "KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS"],
    }))).toThrow(/authority|executor|account/iu);
    expect(() => buildSourceStabilityRecoveryReport(reportInput(manifest, {
      selectedAuthorityFlags: [KILN_LIVE_MANAGED_AGENT_TESTS, OPENCODE_AUTHORITY],
    }))).toThrow(/authority|executor|account/iu);
  });

  it("attaches the synthetic fixture executor when its selected master authority is available", () => {
    const manifest = readManifest();
    const proof = manifest.liveProofs.find((candidate) => candidate.id === "fixture-isolated-write");
    if (!proof || proof.kind !== "implemented") throw new Error("missing fixture proof");
    const flags = [KILN_LIVE_MANAGED_AGENT_TESTS];
    const report = buildSourceStabilityRecoveryReport(reportInput(manifest, {
      executors: [{ providerId: "kiln", harnessId: "kiln-runtime-fixture", harnessVersion: "0.1.0", enabledAuthorityFlags: flags }],
      selectedAuthorityFlags: flags,
      liveVitest: vitestResult(`${REPOSITORY_ROOT}\\${proof.locator.path.replaceAll("/", "\\")}`, proof.locator.title, "passed"),
    } as never));
    expect(report.liveProofs.find((candidate) => candidate.id === proof.id)).toMatchObject({
      status: "executed",
      reasonCode: "test-passed",
      selectedLocator: proof.locator,
      executor: { providerId: "kiln", harnessId: "kiln-runtime-fixture", harnessVersion: "0.1.0" },
    });
    expect(report.liveProofOutcome).toBe("passed");
  });

  it.each([
    ["test-process-timeout", undefined],
    ["test-process-interrupted", undefined],
    ["test-output-limit", undefined],
  ] as const)("marks %s as failed with unverified cleanup and no live JSON", (reasonCode, exitCode) => {
    const report = buildSourceStabilityRecoveryReport(reportInput(readManifest(), {
      liveRun: { status: "failed", reasonCode, ...(exitCode === undefined ? {} : { exitCode }) } as never,
      liveVitest: undefined,
    } as never));
    expect(report.terminalOutcome).toBe("failed");
    expect(report.cleanupOutcome).toBe("unverified");
    expect(report.liveProofOutcome).toBe("failed");
    expect(report.residualRisks).toContain(`live-run-failed:${reasonCode}`);
  });
});
