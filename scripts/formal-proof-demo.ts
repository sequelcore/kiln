/**
 * Demonstrates Kiln's facts-only formal-verification path against the shipped
 * bounded-work scope policy (#89).
 *
 * The verifier runs inside a throwaway Git sandbox and reads the same
 * canonical candidate blobs used by candidate capture. The script then builds
 * candidate evidence from the real metadata, evaluates the adopted Assurance
 * mapping, and demonstrates an accepted closeout. Finally it mutates the
 * candidate and shows that the prior candidate/evidence pair is stale.
 *
 * Not part of any build or test lane. It needs two external tools that Kiln
 * does not bundle, and it exits with a preflight message when they are absent.
 *
 *   KILN_DEMO_DAFNY  path to the dafny executable, or `dafny` on PATH
 *   KILN_DEMO_LSC    path to LemmaScript's built lsc.js, or `lsc` on PATH
 *
 *   bun run scripts/formal-proof-demo.ts
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseFormalVerificationToolResultMetadata } from "../packages/core/src/tools/domain/tool-result-metadata.js";
import {
  adoptBoundedWorkContractRevision,
  createBoundedWorkCandidateEvidence,
  decideBoundedWorkCloseout,
  evaluateBoundedWorkAssurance,
  type BoundedWorkAccountingSnapshot,
  type BoundedWorkContract,
} from "../packages/core/src/work-governance/index.js";
import {
  captureGitWorktreeCandidate,
  resolveCandidateSubjectDigests,
  type CaptureGitWorktreeCandidateResult,
} from "../packages/runtime/src/work-governance/index.js";
import { createFormalVerifyTool } from "../packages/runtime/src/verification/dafny/formal-verify-tool.js";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const SUBJECT = "packages/core/src/work-governance/bounded-work-scope-policy.ts";
const CRITERION_ID = "denied-root-precedence";
const CRITERION = "A denied root always beats an allowed root";
const WORK_ITEM_ID = "work-scope-policy";
const GOAL_RUN_ID = "goal-demo";
const rule = (title: string): void => console.log(`\n${"=".repeat(74)}\n${title}\n${"=".repeat(74)}`);

function preflight(): { readonly dafny: string; readonly lsc: string } {
  const dafny = process.env.KILN_DEMO_DAFNY ?? "dafny";
  const lsc = process.env.KILN_DEMO_LSC;
  const missing: string[] = [];
  if (process.env.KILN_DEMO_DAFNY && !existsSync(dafny)) missing.push(`KILN_DEMO_DAFNY does not exist: ${dafny}`);
  if (lsc && !existsSync(lsc)) missing.push(`KILN_DEMO_LSC does not exist: ${lsc}`);
  if (!lsc) missing.push("KILN_DEMO_LSC is required: path to LemmaScript's built tools/dist/lsc.js");
  if (missing.length > 0) {
    console.error("This demonstration needs two tools Kiln does not bundle.\n");
    for (const entry of missing) console.error(`  - ${entry}`);
    console.error("\n  Dafny:       https://github.com/dafny-lang/dafny/releases (standalone archive; no .NET SDK needed)");
    console.error("  LemmaScript: https://github.com/midspiral/LemmaScript then `npm install && npm run build`");
    process.exit(1);
  }
  return { dafny, lsc: lsc! };
}

function resolveDafnyVersion(executable: string): string {
  let output: string;
  try {
    output = execFileSync(executable, ["--version"], { encoding: "utf8" });
  } catch (error) {
    throw new Error(`could not resolve Dafny version from ${executable}: ${(error as Error).message}`);
  }
  const version = output.match(/\b\d+\.\d+\.\d+(?:[+.-][0-9A-Za-z.-]+)?\b/u)?.[0];
  if (!version) throw new Error(`Dafny version output from ${executable} was not parseable`);
  return version;
}

/** Translate the annotated TypeScript to Dafny, returning the generated path. */
function generateDafny(lsc: string, source: string, workspace: string): string {
  const staged = join(workspace, basename(source));
  copyFileSync(source, staged);
  execFileSync(process.execPath, [lsc, "gen", "--backend=dafny", staged], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
  });
  const generated = staged.replace(/\.ts$/u, ".dfy.gen");
  if (!existsSync(generated)) throw new Error(`lsc produced no Dafny output for ${staged}`);
  const verifiable = staged.replace(/\.ts$/u, ".dfy");
  copyFileSync(generated, verifiable);
  return verifiable;
}

function gitBytes(root: string, args: readonly string[]): Buffer {
  const output = execFileSync("git", [...args], { cwd: root, windowsHide: true });
  return Buffer.isBuffer(output) ? output : Buffer.from(output);
}

function gitText(root: string, args: readonly string[]): string {
  return gitBytes(root, args).toString("utf8");
}

function digestBytes(content: Uint8Array): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

/** Initialize a portable, throwaway Git sandbox with a committed baseline. */
function initGitSandbox(root: string): void {
  gitText(root, ["init", "--quiet"]);
  gitText(root, ["config", "user.email", "demo@kiln.invalid"]);
  gitText(root, ["config", "user.name", "Kiln Demo"]);
  gitText(root, ["config", "core.autocrlf", "true"]);
  writeFileSync(join(root, "README.md"), "baseline\n", "utf8");
  gitText(root, ["add", "--all"]);
  gitText(root, ["commit", "--quiet", "-m", "baseline"]);
}

/** Read one exact blob from a captured Git tree, never from working-tree bytes. */
function readCanonicalGitBlob(root: string, treeObjectId: string, path: string): Buffer {
  const entry = gitBytes(root, ["ls-tree", "-r", "-z", "--full-tree", treeObjectId])
    .toString("utf8")
    .split("\0")
    .find((candidate) => candidate.slice(candidate.indexOf("\t") + 1) === path);
  if (entry === undefined) throw new Error(`captured Git tree does not contain ${path}`);
  const separator = entry.indexOf("\t");
  const [mode, type, objectId] = entry.slice(0, separator).split(" ");
  if (mode === undefined || type !== "blob" || objectId === undefined) {
    throw new Error(`captured Git tree entry for ${path} is not a regular blob`);
  }
  return gitBytes(root, ["cat-file", "blob", objectId]);
}

function requireCaptured(
  result: CaptureGitWorktreeCandidateResult,
  worktreePath: string,
): Extract<CaptureGitWorktreeCandidateResult, { status: "captured" }> {
  if (result.status === "reconciliation_required") {
    throw new Error(
      `capturing ${worktreePath} as a candidate needs reconciliation: ${result.reason}\n`
        + "This usually means the working tree changed between capture's two tree observations, "
        + "or contains a gitlink capture must not silently include. Re-run once the tree is stable.",
    );
  }
  return result;
}

const { dafny, lsc } = preflight();
const workspace = mkdtempSync(join(tmpdir(), "kiln-formal-proof-demo-"));

try {
  initGitSandbox(workspace);
  const dafnyVersion = resolveDafnyVersion(dafny);
  const source = join(REPOSITORY_ROOT, SUBJECT);
  const dafnyFile = generateDafny(lsc, source, workspace);
  const verificationSubject = basename(dafnyFile);

  const contract: BoundedWorkContract = {
    schema: "kiln.bounded-work-contract/v2",
    intent: {
      objective: "Prove the path admission rule.",
      acceptanceCriteria: [{ id: CRITERION_ID, statement: CRITERION }],
      nonGoals: [],
    },
    assurance: {
      formalVerification: {
        semantics: "allOf",
        obligations: [{ id: "denied-root-proof", symbol: "admitPath", subjectPaths: [verificationSubject] }],
        mappings: [{ criterionId: CRITERION_ID, obligationIds: ["denied-root-proof"] }],
      },
    },
    scope: {
      allowedWorkItemIds: [WORK_ITEM_ID],
      permittedEffects: ["modify_source", "run_verification"],
      permittedSurfaces: ["core"],
      allowedRoots: ["packages/core"],
      deniedRoots: [],
      refactorAuthority: "scoped",
      migrationAuthority: "none",
      dependencyAuthority: "none",
    },
    limits: {
      maxExecutionAttempts: 3,
      maxManagedInvocations: 1,
      maxConcurrentManagedInvocations: 1,
      maxChildDepth: 1,
      maxReviewRounds: 1,
      maxRemediationRounds: 1,
    },
    tripwires: {},
    policy: { scopeExpansion: "approval_required", budgetExhaustion: "pause", minimumHarnessCapability: "authoritative" },
  };
  const revision = adoptBoundedWorkContractRevision({
    contract,
    accountingLineageId: GOAL_RUN_ID,
    adoptedAt: "2026-08-20T11:00:00.000Z",
    adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "decision-1" },
  });
  const snapshot: BoundedWorkAccountingSnapshot = {
    schema: "kiln.bounded-work-accounting/v1",
    accountingLineageId: GOAL_RUN_ID,
    contractRevisionDigest: revision.revisionDigest,
    revision: 1,
    executionAttempts: 1,
    managedInvocations: 0,
    activeManagedInvocations: 0,
    reviewRounds: 0,
    remediationRounds: 0,
    toolCalls: { kind: "observed", value: 3 },
    activeDurationMs: { kind: "observed", value: 1000 },
  };

  rule("1. formal_verify reports closed verifier facts");
  const tool = createFormalVerifyTool({ executable: dafny, verifierVersion: dafnyVersion });
  const toolResult = await tool.execute({ input: { file: verificationSubject } } as never, { cwd: workspace });
  if (toolResult.isError || toolResult.metadata === undefined) {
    throw new Error(`formal_verify did not produce metadata: ${toolResult.output}`);
  }
  const metadata = parseFormalVerificationToolResultMetadata(toolResult.metadata);
  console.log(toolResult.output);
  console.log(`verifier    : ${metadata.verifier.name} ${metadata.verifier.version}`);
  console.log(`artifact    : ${metadata.artifact.contentDigest.slice(0, 30)}... (isolated verifier input)`);
  console.log(`checks      : ${metadata.checks.map((check) => `${check.symbol}=${check.outcome}`).join(", ")}`);
  console.log(`establishes : ${JSON.stringify(metadata.establishes)}`);
  if (metadata.establishes.length !== 0) {
    throw new Error("formal_verify emitted unexpected acceptance authority");
  }
  const metadataSubject = metadata.subjects.find(({ path }) => path === verificationSubject);
  if (metadataSubject === undefined) {
    throw new Error(`formal_verify did not report the generated Dafny subject ${verificationSubject}`);
  }
  if (metadataSubject.contentDigest !== metadata.artifact.contentDigest) {
    throw new Error("formal_verify artifact and generated Dafny subject digests differ");
  }

  rule("2. candidate capture resolves the same canonical Git bytes");

  const captured = requireCaptured(
    await captureGitWorktreeCandidate({
      goalRunId: GOAL_RUN_ID,
      workItemId: WORK_ITEM_ID,
      contractRevisionDigest: revision.revisionDigest,
      accountingLineageId: GOAL_RUN_ID,
      worktreePath: workspace,
      createdAt: "2026-08-20T11:30:00.000Z",
    }),
    workspace,
  );
  const { candidate, snapshot: capture } = captured;
  const candidateSubjects = await resolveCandidateSubjectDigests({
    worktreePath: workspace,
    candidate,
    candidateTreeObjectId: capture.candidateTreeObjectId,
  });
  const subjectDigest = candidateSubjects.digests.get(verificationSubject);
  if (subjectDigest === undefined) throw new Error(`${verificationSubject} is absent from the resolved candidate subject digests`);
  const canonicalBytes = readCanonicalGitBlob(workspace, capture.candidateTreeObjectId, verificationSubject);
  const canonicalDigest = digestBytes(canonicalBytes);
  if (canonicalDigest !== subjectDigest || canonicalDigest !== metadataSubject.contentDigest) {
    throw new Error("formal metadata is not bound to the candidate's canonical Git blob bytes");
  }

  console.log(`candidate   : git_worktree, ${capture.changedFiles} file(s) changed vs baseline`);
  console.log(`candidateId : ${candidate.candidateDigest.slice(0, 30)}...`);
  console.log(`subject     : ${verificationSubject} -> ${subjectDigest.slice(0, 30)}... (canonical Git blob)`);

  rule("3. metadata becomes candidate evidence and Assurance accepts closeout");
  const candidateEvidence = createBoundedWorkCandidateEvidence({
    candidate,
    executionAttempt: {
      goalRunId: GOAL_RUN_ID,
      workItemId: WORK_ITEM_ID,
      attemptId: "attempt-1",
    },
    invocation: { toolCallScopeId: "goal-demo:attempt-1", toolCallId: "formal-1" },
    attestation: { producer: { kind: "registered_tool", toolName: "formal_verify" }, payload: metadata },
    recordedAt: "2026-08-20T11:31:00.000Z",
  });
  const assuranceEvaluation = evaluateBoundedWorkAssurance({
    revision,
    candidate,
    candidateSubjects,
    candidateEvidence: [candidateEvidence],
    evaluatedAt: "2026-08-20T11:32:00.000Z",
  });
  if (assuranceEvaluation.criterionEvaluations[0]?.outcome !== "established") {
    throw new Error("Assurance did not establish the criterion from candidate evidence");
  }
  const closeout = decideBoundedWorkCloseout({
    revision,
    snapshot,
    candidateDigest: candidate.candidateDigest,
    candidateEvidence: [candidateEvidence],
    assuranceEvaluation,
    decidedAt: "2026-08-20T11:33:00.000Z",
  });
  if (closeout.kind !== "stop_acceptance_complete") {
    throw new Error(`closeout did not accept the candidate: ${closeout.kind}`);
  }
  console.log(`closeout    : ${closeout.kind}`);
  console.log(`criterion   : ${assuranceEvaluation.criterionEvaluations[0]?.outcome}`);

  rule("4. mutating the candidate rejects the prior evidence as stale");
  writeFileSync(dafnyFile, `${readFileSync(dafnyFile, "utf8")}\n// edited after acceptance\n`, "utf8");
  const staleCaptured = requireCaptured(
    await captureGitWorktreeCandidate({
      goalRunId: GOAL_RUN_ID,
      workItemId: WORK_ITEM_ID,
      contractRevisionDigest: revision.revisionDigest,
      accountingLineageId: GOAL_RUN_ID,
      worktreePath: workspace,
      createdAt: "2026-08-20T12:00:00.000Z",
    }),
    workspace,
  );
  if (staleCaptured.candidate.candidateDigest === candidate.candidateDigest) {
    throw new Error("candidate mutation unexpectedly preserved the prior candidate digest");
  }
  let refused = false;
  try {
    await resolveCandidateSubjectDigests({
      worktreePath: workspace,
      candidate,
      candidateTreeObjectId: staleCaptured.snapshot.candidateTreeObjectId,
    });
  } catch (error) {
    refused = true;
    console.log(`REFUSED     ${(error as Error).message}`);
  }
  if (!refused) throw new Error("the prior candidate unexpectedly accepted the edited candidate tree");

  const staleSubjects = await resolveCandidateSubjectDigests({
    worktreePath: workspace,
    candidate: staleCaptured.candidate,
    candidateTreeObjectId: staleCaptured.snapshot.candidateTreeObjectId,
  });
  const staleEvaluation = evaluateBoundedWorkAssurance({
    revision,
    candidate: staleCaptured.candidate,
    candidateSubjects: staleSubjects,
    candidateEvidence: [candidateEvidence],
    evaluatedAt: "2026-08-20T12:01:00.000Z",
  });
  const staleCloseout = decideBoundedWorkCloseout({
    revision,
    snapshot,
    candidateDigest: staleCaptured.candidate.candidateDigest,
    candidateEvidence: [candidateEvidence],
    assuranceEvaluation: staleEvaluation,
    decidedAt: "2026-08-20T12:02:00.000Z",
  });
  if (staleCloseout.kind !== "pause_acceptance_incomplete") {
    throw new Error(`stale evidence unexpectedly completed closeout: ${staleCloseout.kind}`);
  }
  console.log(`stale      : ${staleCloseout.kind}; missing ${JSON.stringify(staleCloseout.missingCriteria)}`);

  rule("What this does not show");
  console.log([
    "The formal tool reports verifier facts only; it does not decide which acceptance criterion a check satisfies.",
    "The demo constructs candidate evidence only after binding metadata to the captured Git tree and adopted policy.",
    "Product surfaces resolve Dafny from global config; this manual demo keeps KILN_DEMO_* inputs explicit and isolated.",
  ].join("\n"));
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
