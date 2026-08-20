/**
 * Demonstrates Kiln's facts-only formal-verification path against the shipped
 * bounded-work scope policy (#89).
 *
 * The verifier produces real metadata with the executable's reported Dafny
 * version and `establishes: []`. This script deliberately does not mint
 * candidate evidence. The contract carries a pre-adopted Assurance mapping,
 * but its obligation remains unresolved and closeout therefore pauses.
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
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parseFormalVerificationToolResultMetadata } from "../packages/core/src/tools/domain/tool-result-metadata.js";
import { createFormalVerifyTool } from "../packages/core/src/tools/infrastructure/formal-verify-tool.js";
import {
  adoptBoundedWorkContractRevision,
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

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const SUBJECT = "packages/core/src/work-governance/bounded-work-scope-policy.ts";
const CRITERION_ID = "denied-root-precedence";
const CRITERION = "A denied root always beats an allowed root";
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
  execFileSync(process.execPath, [lsc, "gen", "--backend=dafny", staged], { encoding: "utf8" });
  const generated = staged.replace(/\.ts$/u, ".dfy.gen");
  if (!existsSync(generated)) throw new Error(`lsc produced no Dafny output for ${staged}`);
  const verifiable = staged.replace(/\.ts$/u, ".dfy");
  copyFileSync(generated, verifiable);
  return verifiable;
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

/** Builds a throwaway repository for the subject-resolution refusal demonstrations. */
function initTempRepo(root: string, relativePath: string, content: string): void {
  const target = join(root, ...relativePath.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
  const git = (args: readonly string[]): void => {
    execFileSync("git", args, { cwd: root, encoding: "utf8" });
  };
  git(["init", "-q"]);
  git(["config", "core.autocrlf", "true"]);
  git(["-c", "user.email=demo@kiln.invalid", "-c", "user.name=Kiln Demo", "add", "-A"]);
  git(["-c", "user.email=demo@kiln.invalid", "-c", "user.name=Kiln Demo", "commit", "-q", "-m", "initial"]);
}

const { dafny, lsc } = preflight();
const workspace = mkdtempSync(join(tmpdir(), "kiln-formal-proof-demo-"));

try {
  const dafnyVersion = resolveDafnyVersion(dafny);
  const source = join(REPOSITORY_ROOT, SUBJECT);
  const dafnyFile = generateDafny(lsc, source, workspace);

  rule("1. formal_verify reports closed verifier facts");
  const tool = createFormalVerifyTool({ executable: dafny, verifierVersion: dafnyVersion });
  const toolResult = await tool.execute({ input: { file: dafnyFile } } as never);
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

  rule("2. candidate capture and subject resolution remain separate facts");
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
        obligations: [{ id: "denied-root-proof", symbol: "admitPath", subjectPaths: [SUBJECT] }],
        mappings: [{ criterionId: CRITERION_ID, obligationIds: ["denied-root-proof"] }],
      },
    },
    scope: {
      allowedWorkItemIds: ["work-scope-policy"],
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
    accountingLineageId: "goal-demo",
    adoptedAt: "2026-08-17T11:00:00.000Z",
    adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "decision-1" },
  });
  const snapshot: BoundedWorkAccountingSnapshot = {
    schema: "kiln.bounded-work-accounting/v1",
    accountingLineageId: "goal-demo",
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

  const captured = requireCaptured(
    await captureGitWorktreeCandidate({
      goalRunId: "goal-demo",
      workItemId: "work-scope-policy",
      contractRevisionDigest: revision.revisionDigest,
      accountingLineageId: "goal-demo",
      worktreePath: REPOSITORY_ROOT,
      createdAt: "2026-08-17T11:30:00.000Z",
    }),
    REPOSITORY_ROOT,
  );
  const { candidate, snapshot: capture } = captured;
  const candidateSubjects = await resolveCandidateSubjectDigests({
    worktreePath: REPOSITORY_ROOT,
    candidate,
    candidateTreeObjectId: capture.candidateTreeObjectId,
  });
  const subjectDigest = candidateSubjects.digests.get(SUBJECT);
  if (subjectDigest === undefined) throw new Error(`${SUBJECT} is absent from the resolved candidate subject digests`);

  console.log(`candidate   : git_worktree, ${capture.changedFiles} file(s) changed vs baseline`);
  console.log(`candidateId : ${candidate.candidateDigest.slice(0, 30)}...`);
  console.log(`subject     : ${SUBJECT} -> ${subjectDigest.slice(0, 30)}...`);
  console.log("evidence    : not minted by this demo; Runtime owns observation transport");

  rule("3. closeout pauses when the adopted Assurance obligation is unresolved");
  const assuranceEvaluation = evaluateBoundedWorkAssurance({
    revision,
    candidate,
    candidateSubjects,
    candidateEvidence: [],
    evaluatedAt: "2026-08-17T11:31:00.000Z",
  });
  const closeout = decideBoundedWorkCloseout({
    revision,
    snapshot,
    candidateDigest: candidate.candidateDigest,
    candidateEvidence: [],
    assuranceEvaluation,
    decidedAt: "2026-08-17T11:32:00.000Z",
  });
  if (closeout.kind !== "pause_acceptance_incomplete") {
    throw new Error(`closeout unexpectedly completed: ${closeout.kind}`);
  }
  console.log(`closeout    : ${closeout.kind}`);
  console.log(`missing     : ${JSON.stringify(closeout.missingCriteria)}`);
  console.log("authority   : the mapping was adopted before execution; no candidate-bound evidence proves it");

  rule("4. edited candidate tree is refused for the prior candidate");
  const staleRoot = mkdtempSync(join(tmpdir(), "kiln-formal-proof-demo-stale-"));
  try {
    initTempRepo(staleRoot, SUBJECT, readFileSync(source, "utf8"));
    const target = join(staleRoot, ...SUBJECT.split("/"));
    const preEditCaptured = requireCaptured(
      await captureGitWorktreeCandidate({
        goalRunId: "goal-demo",
        workItemId: "work-scope-policy",
        contractRevisionDigest: revision.revisionDigest,
        accountingLineageId: "goal-demo",
        worktreePath: staleRoot,
        createdAt: "2026-08-17T12:59:59.000Z",
      }),
      staleRoot,
    );
    const preEditSubjects = await resolveCandidateSubjectDigests({
      worktreePath: staleRoot,
      candidate: preEditCaptured.candidate,
      candidateTreeObjectId: preEditCaptured.snapshot.candidateTreeObjectId,
    });
    if (preEditSubjects.digests.get(SUBJECT) !== subjectDigest) {
      throw new Error("throwaway repository subject bytes do not match the captured candidate subject");
    }

    writeFileSync(target, `${readFileSync(target, "utf8")}\n// edited after capture\n`, "utf8");
    const editedCaptured = requireCaptured(
      await captureGitWorktreeCandidate({
        goalRunId: "goal-demo",
        workItemId: "work-scope-policy",
        contractRevisionDigest: revision.revisionDigest,
        accountingLineageId: "goal-demo",
        worktreePath: staleRoot,
        createdAt: "2026-08-17T13:00:00.000Z",
      }),
      staleRoot,
    );
    let refused = false;
    try {
      await resolveCandidateSubjectDigests({
        worktreePath: staleRoot,
        candidate: preEditCaptured.candidate,
        candidateTreeObjectId: editedCaptured.snapshot.candidateTreeObjectId,
      });
    } catch (error) {
      refused = true;
      console.log(`REFUSED     ${(error as Error).message}`);
    }
    if (!refused) throw new Error("the prior candidate unexpectedly accepted the edited candidate tree");
  } finally {
    rmSync(staleRoot, { recursive: true, force: true });
  }

  rule("5. a candidate without the subject cannot resolve it");
  const absentRoot = mkdtempSync(join(tmpdir(), "kiln-formal-proof-demo-absent-"));
  try {
    initTempRepo(absentRoot, "README.md", "placeholder\n");
    const absentCaptured = requireCaptured(
      await captureGitWorktreeCandidate({
        goalRunId: "goal-demo",
        workItemId: "work-scope-policy",
        contractRevisionDigest: revision.revisionDigest,
        accountingLineageId: "goal-demo",
        worktreePath: absentRoot,
        createdAt: "2026-08-17T13:30:00.000Z",
      }),
      absentRoot,
    );
    const absentSubjects = await resolveCandidateSubjectDigests({
      worktreePath: absentRoot,
      candidate: absentCaptured.candidate,
      candidateTreeObjectId: absentCaptured.snapshot.candidateTreeObjectId,
    });
    if (absentSubjects.digests.has(SUBJECT)) {
      throw new Error("the absent candidate unexpectedly resolved the subject");
    }
    console.log(`REFUSED     candidate does not contain ${SUBJECT}`);
  } finally {
    rmSync(absentRoot, { recursive: true, force: true });
  }

  rule("What this does not show");
  console.log([
    "The formal tool reports verifier facts only; it does not decide which acceptance criterion a check satisfies.",
    "Candidate subject resolution confirms paths and bytes in one captured tree; it does not mint an evidence record.",
    "The empty establishes tuple therefore leaves closeout paused until #53 names mapping authority and #92 verifies binding.",
  ].join("\n"));
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
