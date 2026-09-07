import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { resolveProjectStateBinding } from "../../packages/cli/src/application/project-state-root.js";
import { DefaultContextGovernor } from "../../packages/core/src/context/index.js";
import { ReversibleContextProjectionService } from "../../packages/core/src/efficiency/index.js";
import type { CodeIntelligenceRequest } from "../../packages/core/src/tools/domain/code-intelligence.js";
import { createFileArtifactResourceStore } from "../../packages/runtime/src/artifacts/file-artifact-resource-store.js";
import { ProjectCapture } from "./project-capture.js";
import { TypeScriptReferenceAdapter } from "./reference-adapter.js";
import { createReferenceProjection } from "./reference-projection.js";

export function referenceStoreDirectory(root: string, kilnHome?: string): string {
  const binding = resolveProjectStateBinding(root, kilnHome ? { kilnHome } : {});
  return join(binding.evidencePath, "repository-analysis");
}

function service(root: string, kilnHome?: string): ReversibleContextProjectionService {
  return new ReversibleContextProjectionService({
    store: createFileArtifactResourceStore({ rootDir: referenceStoreDirectory(root, kilnHome) }),
  });
}

export async function saveLocalReference(
  root: string,
  config: string,
  path: string,
  line: number,
  column: number,
  kilnHome?: string,
) {
  if (!Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 1)
    throw new Error("positions-must-be-positive-integers");
  const capture = new ProjectCapture(root, config);
  const request: CodeIntelligenceRequest = {
    operation: "references",
    workspaceRoot: capture.root,
    path,
    position: { line: line - 1, character: column - 1 },
    limit: 1000,
  };
  const adapter = new TypeScriptReferenceAdapter(capture);
  try {
    const evidence = await adapter.query(request);
    const projection = createReferenceProjection(service(root, kilnHome), request, evidence, () => capture.current());
    const selected = new DefaultContextGovernor().project({
      artifacts: [projection.candidate],
      artifactProjectionPreference: "reversible",
      tokenBudget: 100000,
    });
    const block = selected.blocks[0];
    const handle = block?.projectionEvidence?.retrievalHandle;
    const hash = block?.projectionEvidence?.sourceHash;
    if (!block || !handle || !hash) throw new Error("missing-reference-projection");
    return {
      status: evidence.disposition === "complete" && capture.current() ? ("current" as const) : ("historical" as const),
      disposition: evidence.disposition,
      handle,
      hash,
      content: block.content,
    };
  } finally {
    await adapter.close();
  }
}

/** Integrity only: callers must never interpret this as current workspace evidence. */
export function readLocalReference(root: string, handle: string, hash: string, kilnHome?: string) {
  try {
    const owner = service(root, kilnHome);
    const verification = owner.verifyCanonicalEvidence({
      retrievalHandle: handle,
      expectedSourceHash: hash,
      purpose: "verification",
    });
    if (!verification.verified) return { status: "unavailable" as const, reason: verification.reason };
    const retrieved = owner.retrieve(handle);
    if (retrieved.status !== "available")
      return { status: "unavailable" as const, reason: "canonical-evidence-unavailable" };
    return { status: "historical" as const, handle, hash, artifact: retrieved.artifact };
  } catch {
    return { status: "unavailable" as const, reason: "canonical-evidence-unavailable" };
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid-saved-reference");
  return value as Record<string, unknown>;
}

/** Ignore only query timing/cache state; all captured identities, results and limitations must match. */
function stableEvidence(value: Record<string, unknown>): Record<string, unknown> {
  const { elapsedMs: _elapsed, cacheState: _cache, ...stable } = value;
  return stable;
}

export async function checkLocalReference(root: string, handle: string, hash: string, kilnHome?: string) {
  const saved = readLocalReference(root, handle, hash, kilnHome);
  if (saved.status === "unavailable") return saved;
  let adapter: TypeScriptReferenceAdapter | undefined;
  try {
    if (saved.artifact.kind !== "json") throw new Error("expected-reference-json-artifact");
    const value = record(saved.artifact.value);
    if (typeof value["referenceEvidenceJson"] !== "string" || typeof value["requestJson"] !== "string")
      throw new Error("invalid-saved-reference");
    const old = record(JSON.parse(value["referenceEvidenceJson"]));
    if (value["currentAtProjection"] !== true || old["disposition"] !== "complete")
      return { status: "historical" as const, reason: "original-evidence-incomplete-or-stale" };
    const query = record(JSON.parse(value["requestJson"]));
    const position = record(query["position"]);
    const config = record(old["project"])["configPath"];
    const path = query["path"];
    const line = position["line"];
    const character = position["character"];
    if (
      query["operation"] !== "references" ||
      typeof config !== "string" ||
      typeof path !== "string" ||
      typeof line !== "number" ||
      !Number.isInteger(line) ||
      line < 0 ||
      typeof character !== "number" ||
      !Number.isInteger(character) ||
      character < 0 ||
      query["limit"] !== 1000
    )
      throw new Error("invalid-saved-query");
    const capture = new ProjectCapture(root, config);
    if (query["workspaceRoot"] !== capture.root) return { status: "historical" as const, reason: "workspace-mismatch" };
    const request: CodeIntelligenceRequest = {
      operation: "references",
      workspaceRoot: capture.root,
      path,
      position: { line, character },
      limit: 1000,
    };
    adapter = new TypeScriptReferenceAdapter(capture);
    const fresh = await adapter.query(request);
    if (fresh.disposition !== "complete" || !capture.current())
      return {
        status: "historical" as const,
        reason: "revalidation-incomplete-or-stale",
        disposition: fresh.disposition,
        reasons: fresh.reasons,
      };
    const previous = stableEvidence(old);
    // Compare the persisted JSON representation on both sides; unset compiler options
    // are absent in JSON, although the live API object can contain undefined fields.
    const current = stableEvidence(record(JSON.parse(JSON.stringify(fresh))));
    if (!isDeepStrictEqual(previous, current))
      return {
        status: "historical" as const,
        reason: "captured-evidence-changed",
        changedFields: [...new Set([...Object.keys(previous), ...Object.keys(current)])].filter(
          (key) => !isDeepStrictEqual(previous[key], current[key]),
        ),
      };
    return {
      status: "current" as const,
      handle,
      hash,
      checkedAt: new Date().toISOString(),
      notice: "Current at this check only; recheck after workspace changes.",
    };
  } catch {
    return { status: "historical" as const, reason: "revalidation-failed" };
  } finally {
    await adapter?.close();
  }
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  let result;
  if (command === "save" && args.length === 4) {
    const [config, path, line, column] = args;
    if (!config || !path) throw new Error("missing-query");
    result = await saveLocalReference(process.cwd(), config, path, Number(line), Number(column));
  } else if ((command === "read" || command === "check") && args.length === 2) {
    const [handle, hash] = args;
    if (!handle || !hash) throw new Error("missing-reference-identity");
    result =
      command === "read"
        ? readLocalReference(process.cwd(), handle, hash)
        : await checkLocalReference(process.cwd(), handle, hash);
  } else
    throw new Error(
      "Usage: research:references:local save <tsconfig> <path> <line> <column> | read <handle> <hash> | check <handle> <hash>",
    );
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "unavailable" || (command !== "read" && result.status !== "current")) process.exitCode = 1;
}
