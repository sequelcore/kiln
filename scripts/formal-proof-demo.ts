/**
 * Reproduces the deterministic-verifier evidence chain end to end against
 * Kiln's own shipped bounded-work scope policy (#89).
 *
 * It proves one authority rule with a verifier, turns the result into evidence
 * bound to the exact source, and then shows closeout refusing three things it
 * used to accept: a fabricated digest, an absent record, and a proof that
 * outlived the code it proved.
 *
 * Not part of any build or test lane. It needs two external tools that Kiln
 * does not bundle, and it exits with a preflight message when they are absent.
 *
 *   KILN_DEMO_DAFNY  path to the dafny executable, or `dafny` on PATH
 *   KILN_DEMO_LSC    path to LemmaScript's built lsc.js, or `lsc` on PATH
 *
 *   bun run scripts/formal-proof-demo.ts
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createFormalVerifyTool, formalProofObligations } from "../packages/core/src/tools/infrastructure/formal-verify-tool.js";
import { SpawnCommandProcessRunner } from "../packages/core/src/tools/infrastructure/command-process.js";
import { DafnyVerifier } from "../packages/core/src/tools/infrastructure/dafny-verifier.js";
import {
  adoptBoundedWorkContractRevision,
  bindFormalProofEvidence,
  createBoundedWorkCandidate,
  decideBoundedWorkCloseout,
  recordFormalProofVerdict,
  unprovenCriteria,
  type BoundedWorkAccountingSnapshot,
  type BoundedWorkContract,
} from "../packages/core/src/work-governance/index.js";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const SUBJECT = "packages/core/src/work-governance/bounded-work-scope-policy.ts";
const CRITERION = "A denied root always beats an allowed root";
/** The verified symbol, and the criterion the adopted contract says it discharges. */
const CRITERION_BY_SYMBOL = { admitPath: CRITERION };

const sha = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;
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

const { dafny, lsc } = preflight();
const workspace = mkdtempSync(join(tmpdir(), "kiln-formal-proof-demo-"));

try {
  const source = join(REPOSITORY_ROOT, SUBJECT);
  const dafnyFile = generateDafny(lsc, source, workspace);

  rule("1. An agent asks Kiln to verify the candidate");
  const tool = createFormalVerifyTool({ executable: dafny });
  console.log((await tool.execute({ input: { file: dafnyFile } } as never)).output);

  rule("2. Kiln binds the verifier result to the exact source it ran against");
  const run = await new DafnyVerifier(new SpawnCommandProcessRunner(), {
    executable: dafny, cwd: workspace, timeoutMs: 120_000,
  }).verify({ file: dafnyFile, logFilePath: "demo.csv" });

  const contentDigest = sha(readFileSync(source, "utf8"));
  const obligations = formalProofObligations({ log: run.log, criterionBySymbol: CRITERION_BY_SYMBOL });
  if (obligations.length === 0) throw new Error("no obligation mapped to the declared criterion");

  const contract: BoundedWorkContract = {
    schema: "kiln.bounded-work-contract/v1",
    intent: { objective: "Prove the path admission rule.", acceptanceCriteria: [CRITERION], nonGoals: [] },
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
      maxExecutionAttempts: 3, maxManagedInvocations: 1, maxConcurrentManagedInvocations: 1,
      maxChildDepth: 1, maxReviewRounds: 1, maxRemediationRounds: 1,
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

  const candidate = createBoundedWorkCandidate({
    goalRunId: "goal-demo", workItemId: "work-scope-policy",
    contractRevisionDigest: revision.revisionDigest, accountingLineageId: "goal-demo",
    kind: "artifact", baseline: { kind: "content_snapshot", digest: sha("baseline") },
    candidateContentDigest: contentDigest, createdAt: "2026-08-17T11:30:00.000Z",
  });
  const verdict = recordFormalProofVerdict({
    verifier: { name: "dafny", version: "external", translator: { name: "lemmascript", version: "external" } },
    subjectContentDigest: contentDigest, obligations, producedAt: "2026-08-17T12:00:00.000Z",
  });
  const evidence = bindFormalProofEvidence({ candidate, verdict, recordedAt: "2026-08-17T12:00:01.000Z" });

  console.log(`subject      : ${SUBJECT}`);
  console.log(`content      : ${contentDigest.slice(0, 30)}...`);
  console.log(`obligations  : ${obligations.map((entry) => `${entry.id}=${entry.outcome}`).join(", ")}`);
  console.log(`verdict      : ${verdict.outcome}`);
  console.log(`unproven     : ${JSON.stringify(unprovenCriteria(verdict, [CRITERION]))}`);
  console.log(`bound as     : ${evidence.kind} -> ${evidence.evidenceDigest.slice(0, 30)}...`);

  const closeout = { revision, snapshot, candidateDigest: candidate.candidateDigest };
  const satisfied = [{ criterion: CRITERION, candidateDigest: candidate.candidateDigest, evidenceDigest: evidence.evidenceDigest }];

  rule("3. Closeout, presented with that evidence");
  console.log(decideBoundedWorkCloseout({ ...closeout, candidateEvidence: [evidence], satisfiedCriteria: satisfied }).kind);

  rule("4. The same claim, with a digest the agent made up");
  try {
    decideBoundedWorkCloseout({
      ...closeout,
      candidateEvidence: [evidence],
      satisfiedCriteria: [{ criterion: CRITERION, candidateDigest: candidate.candidateDigest, evidenceDigest: sha("looks-real-enough") }],
    });
    console.log("ACCEPTED  <- regression: a fabricated digest closed the work");
  } catch (error) { console.log(`REFUSED   ${(error as Error).message}`); }

  rule("5. The same claim, with no evidence recorded at all");
  try {
    decideBoundedWorkCloseout({ ...closeout, candidateEvidence: [], satisfiedCriteria: satisfied });
    console.log("ACCEPTED  <- regression: an unbacked claim closed the work");
  } catch (error) { console.log(`REFUSED   ${(error as Error).message}`); }

  rule("6. The proof, after someone edits the source");
  const edited = createBoundedWorkCandidate({
    goalRunId: "goal-demo", workItemId: "work-scope-policy",
    contractRevisionDigest: revision.revisionDigest, accountingLineageId: "goal-demo",
    kind: "artifact", baseline: { kind: "content_snapshot", digest: sha("baseline") },
    candidateContentDigest: sha("source edited after the proof ran"),
    previousCandidate: candidate, createdAt: "2026-08-17T13:00:00.000Z",
  });
  try {
    bindFormalProofEvidence({ candidate: edited, verdict, recordedAt: "2026-08-17T13:00:01.000Z" });
    console.log("BOUND     <- regression: a stale proof was rebound");
  } catch (error) { console.log(`REFUSED   ${(error as Error).message}`); }

  rule("What this does not show");
  console.log([
    "The bound evidence digest is computed over the verdict here, but the production",
    "path digests self-reported labels instead (#91), and closeout never checks that",
    "evidence establishes the criterion it is credited with (#92). Nothing yet carries",
    "a verdict from a tool run to the attempt that finishes, so this chain is driven",
    "by this script rather than by a Kiln session.",
  ].join("\n"));
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
