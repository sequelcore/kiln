/**
 * `formal_verify` — run a deterministic verifier over a candidate and report
 * what it proved.
 *
 * This tool reports; it never accepts. It returns which obligations the
 * verifier discharged and returns failures in a repairable form, and that is
 * the whole of its authority. It deliberately takes no mapping from obligation
 * to acceptance criterion: such a mapping is a claim about intent, and the
 * agent whose work is under verification must not be the party asserting which
 * requirement its proof satisfies. That mapping belongs to the adopted
 * bounded-work contract, and the work-governance boundary resolves it.
 *
 * Called outside a governed work item the tool still verifies. It simply
 * produces a result that satisfies no criterion, which is the correct outcome
 * rather than an error.
 *
 * It serves the `verify.formal` capability identity. Capability discovery,
 * implementation selection, and the cross-harness result contract are owned by
 * the Capability Fabric track; this is one implementation registered behind
 * that identity, not a second selection authority.
 */

import { dirname, join } from "node:path";
import { correctnessEfforts } from "../../verification/dafny-proof-log.js";
import type { DafnyProofEffort, DafnyProofLog } from "../../verification/dafny-proof-log.js";
import type { FormalProofObligation } from "../../work-governance/formal-proof-verdict.js";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import { getBuiltinEffectEnvelope } from "../domain/tool-effect-envelopes.js";
import { DafnyVerifier } from "./dafny-verifier.js";
import { SpawnCommandProcessRunner } from "./command-process.js";
import type { CommandProcessRunner } from "./command-process.js";
import { requireString, resolvePath, toErrorResult, toSuccessResult, validateReadPath } from "./tool-helpers.js";

/** Capability identity this tool implements. Owned by the Capability Fabric catalog. */
export const FORMAL_VERIFY_CAPABILITY = "verify.formal" as const;

const DEFAULT_TIMEOUT_MS = 120_000;

export interface FormalVerifyToolOptions {
  /** Absolute path to the verifier executable. Resolved by configuration, never searched for. */
  readonly executable: string;
  readonly runner?: CommandProcessRunner;
  readonly timeoutMs?: number;
}

export function createFormalVerifyTool(options: FormalVerifyToolOptions): DevTool {
  const schema = TOOL_SCHEMAS.formal_verify;
  return {
    name: schema.name,
    description: schema.description,
    inputSchema: schema.inputSchema,
    ...(getBuiltinEffectEnvelope(schema.name) === undefined
      ? {}
      : { effectEnvelope: getBuiltinEffectEnvelope(schema.name) }),
    async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
      const file = requireString(input, "file");
      if (!file.ok) return file.result;
      const absolute = resolvePath(file.value, sandbox);
      const denied = validateReadPath(absolute, sandbox);
      if (denied) return toErrorResult(denied);

      const verifier = new DafnyVerifier(options.runner ?? new SpawnCommandProcessRunner(), {
        executable: options.executable,
        cwd: dirname(absolute),
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      const run = await verifier.verify({
        file: absolute,
        logFilePath: join(dirname(absolute), `${basenameOf(absolute)}.verification.csv`),
      });

      if (run.status !== "completed") {
        // A run that did not complete proves nothing. Report it as an error so
        // an empty obligation set can never read as a clean verification.
        return toErrorResult(
          `formal verification did not complete (${run.status}): ${run.failure ?? "no detail"}`,
        );
      }
      return toSuccessResult(renderRun(run.log));
    },
  };
}

/**
 * Turn a verifier log into proof obligations, using the criterion mapping the
 * caller resolved from its adopted contract.
 *
 * The mapping is a parameter, never inferred from the log. Which acceptance
 * criterion a proof discharges is a claim about intent, and only the contract
 * can make it. A symbol absent from the mapping proves something real but
 * discharges no declared criterion, so it is not an obligation and is omitted
 * rather than credited against the contract.
 *
 * Only correctness efforts are considered: a well-formedness effort establishes
 * that a specification is meaningful, not that the implementation satisfies it.
 */
export function formalProofObligations(input: {
  readonly log: DafnyProofLog;
  readonly criterionBySymbol: Readonly<Record<string, string>>;
}): readonly FormalProofObligation[] {
  const detail = renderDiagnostics(input.log);
  const obligations: FormalProofObligation[] = [];
  for (const effort of correctnessEfforts(input.log)) {
    const criterionId = input.criterionBySymbol[effort.symbol];
    if (criterionId === undefined) continue;
    const outcome =
      effort.outcome === "passed" ? "proved" : effort.outcome === "failed" ? "refuted" : "unresolved";
    obligations.push({
      id: `${effort.symbol}/${effort.check}`,
      criterionId,
      outcome,
      ...(outcome === "proved" ? {} : { detail }),
    });
  }
  return obligations;
}

function renderDiagnostics(log: DafnyProofLog): string {
  if (log.diagnostics.length === 0) return "verifier reported no diagnostic";
  return log.diagnostics
    .map((diagnostic) =>
      [`${diagnostic.file}:${diagnostic.line}:${diagnostic.character} ${diagnostic.message}`, ...diagnostic.related]
        .join(" | "),
    )
    .join(" ;; ");
}

function renderRun(log: DafnyProofLog): string {
  const efforts = correctnessEfforts(log);
  if (efforts.length === 0) {
    return [
      "No proof obligations were found.",
      "The verifier completed without discharging any correctness obligation, so nothing was established.",
      "Check that the file declares verifiable properties.",
    ].join("\n");
  }
  const failed = efforts.filter((effort) => effort.outcome !== "passed");
  const lines = [
    `${efforts.length - failed.length}/${efforts.length} proof obligations discharged.`,
    "",
    ...efforts.map(renderEffort),
  ];
  if (log.diagnostics.length > 0) {
    lines.push("", "Diagnostics:");
    for (const diagnostic of log.diagnostics) {
      lines.push(`  ${diagnostic.file}:${diagnostic.line}:${diagnostic.character} ${diagnostic.message}`);
      for (const related of diagnostic.related) lines.push(`      ${related}`);
    }
  }
  lines.push(
    "",
    failed.length === 0
      ? "All declared obligations hold. This reports verifier output only; whether it satisfies an acceptance criterion is decided by work governance."
      : "Unproven obligations must be repaired in the implementation or the specification before this candidate can be accepted.",
  );
  return lines.join("\n");
}

function renderEffort(effort: DafnyProofEffort): string {
  const mark = effort.outcome === "passed" ? "proved" : effort.outcome === "failed" ? "REFUTED" : "UNRESOLVED";
  return `  ${effort.symbol}: ${mark} (${effort.durationMs}ms, resource count ${effort.resourceCount})`;
}

function basenameOf(path: string): string {
  const segments = path.split(/[\\/]/u);
  return segments[segments.length - 1] ?? "verification";
}
