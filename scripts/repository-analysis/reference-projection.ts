import type { ContextCandidate } from "../../packages/core/src/context/index.js";
import { ReversibleContextProjectionService, type JsonArtifact } from "../../packages/core/src/efficiency/index.js";
import type { CodeIntelligenceRequest } from "../../packages/core/src/tools/domain/code-intelligence.js";
import type { ReferenceEvidence } from "./reference-adapter.js";

/** Research composition only: Core continues to own storage and context admission. */
export function createReferenceProjection(
  service: ReversibleContextProjectionService,
  request: CodeIntelligenceRequest,
  evidence: ReferenceEvidence,
  isCurrent: () => boolean,
  required = false,
) {
  const currentAtProjection = isCurrent();
  const referenceEvidenceJson = JSON.stringify(evidence);
  const artifact: JsonArtifact = {
    kind: "json",
    exitStatus: evidence.disposition === "complete" && currentAtProjection ? 0 : 1,
    warnings: [...evidence.reasons, ...(currentAtProjection ? [] : ["stale-workspace-at-projection"])],
    value: { referenceEvidenceJson, requestJson: JSON.stringify(request), currentAtProjection },
  };
  const { project, ...fields } = evidence;
  const summary = {
    ...fields,
    ...(project
      ? {
          project: {
            configPath: project.configPath,
            rootFiles: project.rootFiles,
            compilerOptionsDigest: project.compilerOptionsDigest,
            inputDigest: project.inputDigest,
            options: project.options,
            deferredInputCount: project.inputs.length,
          },
        }
      : {}),
    currentAtProjection,
    freshnessNotice:
      "Artifact integrity does not prove current workspace state; revalidate captured inputs before use.",
  };
  const base = service.createContextCandidate({ artifact, source: "research:typescript-references", required });
  const candidate: ContextCandidate = {
    ...base,
    projectionOptions: base.projectionOptions?.map((option) =>
      option.mode === "reversible"
        ? {
            ...option,
            content: `${option.content}\nReference summary (input manifest deferred; identifier coordinates are zero-based UTF-16):\n${JSON.stringify(summary)}`,
          }
        : option,
    ),
  };
  return { artifact, candidate, summary, referenceEvidenceJson };
}

export function verifyCurrentReferenceEvidence(
  service: ReversibleContextProjectionService,
  retrievalHandle: string,
  expectedSourceHash: string,
  isCurrent: () => boolean,
) {
  const verification = service.verifyCanonicalEvidence({
    retrievalHandle,
    expectedSourceHash,
    purpose: "verification",
  });
  if (!verification.verified) return verification;
  if (!isCurrent()) return { verified: false as const, reason: "stale-workspace" as const };
  return verification;
}
