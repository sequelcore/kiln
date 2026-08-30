import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CommandProcessRequest,
  CommandProcessResult,
  CommandProcessRunner,
  CommandProcessSink,
} from "@kilnai/core";
import { isGentleReviewObservation } from "@kilnai/core";
import { PathValidator, SandboxPolicy } from "@kilnai/core/sandbox";
import { afterEach, describe, expect, it } from "vitest";
import { createGentleReviewTool } from "../../src/verification/gentle-ai/gentle-review-tool.js";

async function makeTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "kiln-gentle-review-"));
}

async function removeTempDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

function makeSandbox(path: string) {
  const policy = new SandboxPolicy({
    config: { fsPolicy: "read-write", netPolicy: "none", allowedPaths: [path], deniedPaths: [], allowedDomains: [] },
    projectPath: path,
  });
  return { cwd: path, policy, pathValidator: new PathValidator({ policy }) };
}

const baseTree = "3e21a205dd9b55021aeae87965092623807e455f";
const candidateTree = "1c3325617279b38743f073302ba190fc421b5a09";
const targetIdentity = `sha256:${"e6".repeat(32)}`;
const revision = `sha256:${"81".repeat(32)}`;
const pathsDigest = `sha256:${"b9".repeat(32)}`;

class SequenceRunner implements CommandProcessRunner {
  readonly requests: CommandProcessRequest[] = [];
  constructor(
    private readonly values: readonly unknown[],
    private readonly results: readonly CommandProcessResult[] = [],
  ) {}
  start(request: CommandProcessRequest, sink: CommandProcessSink) {
    this.requests.push(request);
    sink.output({ stream: "stdout", text: JSON.stringify(this.values[this.requests.length - 1]) });
    sink.finish(this.results[this.requests.length - 1] ?? { exitCode: 0 });
    return { stop: async () => {} };
  }
}

describe("gentle_review", () => {
  let root: string | undefined;
  afterEach(async () => {
    if (root) await removeTempDir(root);
    root = undefined;
  });

  it("publishes a zero-input model contract", () => {
    const tool = createGentleReviewTool({
      executable: "gentle-ai",
      expectedVersion: "2.5.0-rc.1",
      expectedExecutableDigest: `sha256:${"00".repeat(32)}`,
      repositoryRoot: "fixture",
    });
    expect(tool.inputSchema).toMatchObject({ properties: {}, required: [], additionalProperties: false });
    expect(tool.description).toContain("empty object");
  });

  it("emits a candidate-bound, facts-only status observation", async () => {
    root = await makeTempDir("kiln-gentle-review-");
    const executable = join(root, "gentle-ai");
    await writeFile(executable, "fixture executable");
    const executableDigest = digest("fixture executable");
    const runner = new SequenceRunner([capabilities(executableDigest), discoveryStatus(), status()]);
    const result = await createGentleReviewTool({
      executable,
      expectedVersion: "2.5.0-rc.1",
      expectedExecutableDigest: executableDigest,
      repositoryRoot: root,
      runner,
    }).execute({ name: "gentle_review", input: {} }, makeSandbox(root));
    expect(result.isError).toBe(false);
    expect(isGentleReviewObservation(result.metadata)).toBe(true);
    expect(result.metadata).toMatchObject({
      engine: { version: "2.5.0-rc.1", releaseChannel: "prerelease", executableDigest },
      candidate: { targetIdentity, baseTree, candidateTree, paths: ["tracked.txt"] },
      outcome: { action: "stop", nextTransition: { kind: "collect", reasonCode: "reviewer_results_required" } },
      findings: [],
      establishes: [],
    });
    expect(runner.requests.map((request) => request.args.slice(0, 2))).toEqual([
      ["review", "capabilities"],
      ["review", "status"],
      ["review", "status"],
    ]);
    expect(runner.requests[0]?.cwd).not.toBe(root);
    expect(runner.requests[1]?.cwd).toBe(root);
    expect(runner.requests[1]?.args).not.toContain("--lineage");
    expect(runner.requests[2]?.args).toContain("review-fixture");
  });

  it.each([
    ["candidate mismatch", { statusPatch: { target_identity: `sha256:${"aa".repeat(32)}` } }],
    ["ambiguous lineage", { statusPatch: { applicability: "ambiguous" } }],
    ["incompatible protocol", { capabilitiesPatch: { protocol: { major: 3, minor: 0 } } }],
  ])("fails closed for %s", async (_name, changes) => {
    root = await makeTempDir("kiln-gentle-review-");
    const executable = join(root, "gentle-ai");
    await writeFile(executable, "fixture executable");
    const executableDigest = digest("fixture executable");
    const capabilitiesPatch = "capabilitiesPatch" in changes ? changes.capabilitiesPatch : {};
    const statusPatch = "statusPatch" in changes ? changes.statusPatch : {};
    const runner = new SequenceRunner([
      { ...capabilities(executableDigest), ...capabilitiesPatch },
      discoveryStatus(),
      { ...status(), ...statusPatch },
    ]);
    const result = await createGentleReviewTool({
      executable,
      expectedVersion: "2.5.0-rc.1",
      expectedExecutableDigest: executableDigest,
      repositoryRoot: root,
      runner,
    }).execute({ name: "gentle_review", input: {} }, makeSandbox(root));
    expect(result.isError).toBe(true);
  });

  it("rejects executable drift before provider invocation", async () => {
    root = await makeTempDir("kiln-gentle-review-");
    const executable = join(root, "gentle-ai");
    await writeFile(executable, "changed executable");
    const runner = new SequenceRunner([]);
    const result = await createGentleReviewTool({
      executable,
      expectedVersion: "2.5.0-rc.1",
      expectedExecutableDigest: digest("expected executable"),
      repositoryRoot: root,
      runner,
    }).execute({ name: "gentle_review", input: {} }, makeSandbox(root));
    expect(result.isError).toBe(true);
    expect(runner.requests).toHaveLength(0);
  });

  it.each([
    ["timeout", { timedOut: true }],
    ["cancellation", { cancelled: true }],
  ])("fails closed on %s", async (_name, terminal) => {
    root = await makeTempDir("kiln-gentle-review-");
    const executable = join(root, "gentle-ai");
    await writeFile(executable, "fixture executable");
    const executableDigest = digest("fixture executable");
    const runner = new SequenceRunner([capabilities(executableDigest)], [terminal]);
    const result = await createGentleReviewTool({
      executable,
      expectedVersion: "2.5.0-rc.1",
      expectedExecutableDigest: executableDigest,
      repositoryRoot: root,
      runner,
    }).execute({ name: "gentle_review", input: {} }, makeSandbox(root));
    expect(result.isError).toBe(true);
  });

  it("preserves unknown-mutation classification from a provider failure", async () => {
    root = await makeTempDir("kiln-gentle-review-");
    const executable = join(root, "gentle-ai");
    await writeFile(executable, "fixture executable");
    const executableDigest = digest("fixture executable");
    const failure = {
      schema: "gentle-ai.review-integration.failure/v2",
      operation: "review.capabilities",
      code: "interrupted",
      message: "state uncertain",
      mutation_outcome: "unknown",
      replayability: "status_required",
    };
    const runner = new SequenceRunner([failure], [{ exitCode: 1 }]);
    const result = await createGentleReviewTool({
      executable,
      expectedVersion: "2.5.0-rc.1",
      expectedExecutableDigest: executableDigest,
      repositoryRoot: root,
      runner,
    }).execute({ name: "gentle_review", input: {} }, makeSandbox(root));
    expect(result.output).toContain("mutation_outcome=unknown");
    expect(result.output).toContain("replayability=status_required");
  });

  it("rejects malformed status and stale snapshot identity", async () => {
    root = await makeTempDir("kiln-gentle-review-");
    const executable = join(root, "gentle-ai");
    await writeFile(executable, "fixture executable");
    const executableDigest = digest("fixture executable");
    for (const providerStatus of [
      { malformed: true },
      {
        ...status(),
        projection: {
          ...(status().projection as Record<string, unknown>),
          current_snapshot_identity: `sha256:${"ab".repeat(32)}`,
        },
      },
    ]) {
      const runner = new SequenceRunner([capabilities(executableDigest), discoveryStatus(), providerStatus]);
      const result = await createGentleReviewTool({
        executable,
        expectedVersion: "2.5.0-rc.1",
        expectedExecutableDigest: executableDigest,
        repositoryRoot: root,
        runner,
      }).execute({ name: "gentle_review", input: {} }, makeSandbox(root));
      expect(result.isError).toBe(true);
    }
  });

  it("rejects unknown mandatory capabilities", async () => {
    root = await makeTempDir("kiln-gentle-review-");
    const executable = join(root, "gentle-ai");
    await writeFile(executable, "fixture executable");
    const executableDigest = digest("fixture executable");
    const advertised = capabilities(executableDigest);
    const features = advertised.features as { mandatory: unknown[]; optional: unknown[] };
    const runner = new SequenceRunner([
      {
        ...advertised,
        features: { ...features, mandatory: [...features.mandatory, { name: "future_authority", supported: true }] },
      },
    ]);
    const result = await createGentleReviewTool({
      executable,
      expectedVersion: "2.5.0-rc.1",
      expectedExecutableDigest: executableDigest,
      repositoryRoot: root,
      runner,
    }).execute({ name: "gentle_review", input: {} }, makeSandbox(root));
    expect(result.isError).toBe(true);
    expect(result.output).toContain("unknown mandatory");
  });

  it("rejects unknown mandatory capabilities even when advertised as unsupported", async () => {
    root = await makeTempDir("kiln-gentle-review-");
    const executable = join(root, "gentle-ai");
    await writeFile(executable, "fixture executable");
    const executableDigest = digest("fixture executable");
    const advertised = capabilities(executableDigest);
    const features = advertised.features as { mandatory: unknown[]; optional: unknown[] };
    const runner = new SequenceRunner([
      {
        ...advertised,
        features: { ...features, mandatory: [...features.mandatory, { name: "future_authority", supported: false }] },
      },
    ]);
    const result = await createGentleReviewTool({
      executable,
      expectedVersion: "2.5.0-rc.1",
      expectedExecutableDigest: executableDigest,
      repositoryRoot: root,
      runner,
    }).execute({ name: "gentle_review", input: {} }, makeSandbox(root));
    expect(result.isError).toBe(true);
    expect(result.output).toContain("unknown mandatory");
  });

  it("rejects malformed mandatory capability entries instead of silently dropping them", async () => {
    root = await makeTempDir("kiln-gentle-review-");
    const executable = join(root, "gentle-ai");
    await writeFile(executable, "fixture executable");
    const executableDigest = digest("fixture executable");
    const advertised = capabilities(executableDigest);
    const features = advertised.features as { mandatory: unknown[]; optional: unknown[] };
    const runner = new SequenceRunner([
      {
        ...advertised,
        features: { ...features, mandatory: [...features.mandatory, { name: "target_scoped_status" }] },
      },
    ]);
    const result = await createGentleReviewTool({
      executable,
      expectedVersion: "2.5.0-rc.1",
      expectedExecutableDigest: executableDigest,
      repositoryRoot: root,
      runner,
    }).execute({ name: "gentle_review", input: {} }, makeSandbox(root));
    expect(result.isError).toBe(true);
    expect(result.output).toContain("mandatory feature set is malformed");
  });

  it("rejects caller-supplied transaction internals", async () => {
    root = await makeTempDir("kiln-gentle-review-");
    const executable = join(root, "gentle-ai");
    await writeFile(executable, "fixture executable");
    const runner = new SequenceRunner([]);
    const result = await createGentleReviewTool({
      executable,
      expectedVersion: "2.5.0-rc.1",
      expectedExecutableDigest: digest("fixture executable"),
      repositoryRoot: root,
      runner,
    }).execute({ name: "gentle_review", input: { lineageId: "leaked-internal" } }, makeSandbox(root));
    expect(result.isError).toBe(true);
    expect(result.output).toContain("accepts no input fields");
    expect(runner.requests).toHaveLength(0);
  });

  it("fails closed when current-transaction discovery is ambiguous", async () => {
    root = await makeTempDir("kiln-gentle-review-");
    const executable = join(root, "gentle-ai");
    await writeFile(executable, "fixture executable");
    const executableDigest = digest("fixture executable");
    const runner = new SequenceRunner([
      capabilities(executableDigest),
      { ...discoveryStatus(), applicability: "ambiguous" },
    ]);
    const result = await createGentleReviewTool({
      executable,
      expectedVersion: "2.5.0-rc.1",
      expectedExecutableDigest: executableDigest,
      repositoryRoot: root,
      runner,
    }).execute({ name: "gentle_review", input: {} }, makeSandbox(root));
    expect(result.isError).toBe(true);
    expect(result.output).toContain("not uniquely discoverable");
    expect(runner.requests).toHaveLength(2);
  });
});

function capabilities(executableDigest: string): Record<string, unknown> {
  const mandatory = [
    "compact_v2_authority",
    "immutable_snapshot",
    "legacy_v1_target_scoped_read_only",
    "repository_independent_capabilities",
    "restart_safe_projection",
    "target_scoped_status",
    "uniform_failure_envelope",
  ];
  const optional = [
    "native_next_transition",
    "native_frozen_candidate_context",
    "opaque_repository_context",
    "provider_artifact_admission",
    "provider_bound_native_git_context",
    "provider_submission_descriptors",
  ];
  return {
    schema: "gentle-ai.review-integration.capabilities/v2.2",
    contract: "gentle-ai.review-integration/v2",
    protocol: { major: 2, minor: 2 },
    package: { name: "gentle-ai", version: "2.5.0-rc.1", release_channel: "prerelease" },
    executable: {
      sha256: executableDigest,
      evidence: "self-reported",
      verification: "compare-with-published-manifest",
    },
    operations: ["review.capabilities", "review.status"],
    schemas: ["gentle-ai.review-integration.status/v5", "gentle-ai.review-integration.failure/v2"],
    features: {
      mandatory: mandatory.map((name) => ({ name, supported: true })),
      optional: optional.map((name) => ({ name, supported: true })),
    },
  };
}
function status(): Record<string, unknown> {
  return {
    schema: "gentle-ai.review-integration.status/v5",
    contract: "gentle-ai.review-integration/v2",
    operation: "review.status",
    applicability: "current_target",
    authority: { lineage_id: "review-fixture", state: "reviewing", generation: 1, revision },
    action: "stop",
    replayability: "manual_action_required",
    target_identity: targetIdentity,
    projection: {
      projection: "workspace",
      base_tree: baseTree,
      current_candidate_tree: candidateTree,
      paths_digest: pathsDigest,
      paths: ["tracked.txt"],
    },
    next_transition: { kind: "collect", reason_code: "reviewer_results_required" },
  };
}
function discoveryStatus(): Record<string, unknown> {
  return {
    schema: "gentle-ai.review-integration.status/v5",
    contract: "gentle-ai.review-integration/v2",
    operation: "review.status",
    applicability: "unrelated",
    action: "start",
    replayability: "not_replayable",
    target_identity: targetIdentity,
    next_transition: {
      kind: "execute",
      reason_code: "fresh_target_ready",
      execute: {
        operation: "review.start",
        binding: { lineage_id: "review-fixture", target_identity: targetIdentity },
      },
    },
  };
}
function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
