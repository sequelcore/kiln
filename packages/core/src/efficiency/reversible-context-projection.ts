import { createHash } from "node:crypto";
import type { ContextCandidate, ContextProjectionOption } from "../context/index.js";
import type { ArtifactResourceStore } from "../tools/infrastructure/artifact-resource-store.js";
import { reduceTypedArtifact, type TypedArtifact } from "./typed-artifact-reducer.js";

export interface ReversibleContextProjectionServiceOptions {
  readonly store: ArtifactResourceStore;
  readonly namespace?: string;
}

export interface CreateReversibleContextCandidateInput {
  readonly artifact: TypedArtifact;
  readonly source: string;
  readonly score?: number;
  readonly required?: boolean;
}

export interface ReversibleRetrievalAvailable {
  readonly status: "available";
  readonly retrievalHandle: string;
  readonly canonicalArtifactUri: string;
  readonly sourceHash: string;
  readonly artifact: TypedArtifact;
}

export interface ReversibleRetrievalMissing {
  readonly status: "missing";
  readonly retrievalHandle: string;
  readonly reason: "invalid-retrieval-handle" | "artifact-not-found" | "invalid-canonical-artifact";
}

export type ReversibleRetrievalResult = ReversibleRetrievalAvailable | ReversibleRetrievalMissing;

export interface ReversibleRetrievalAuditEvent {
  readonly retrievalHandle: string;
  readonly outcome: "available" | "missing";
  readonly reason?: ReversibleRetrievalMissing["reason"];
}

export interface ReversibleRetrievalAudit {
  readonly retrievalOpportunities: number;
  readonly attemptedRetrievals: number;
  readonly successfulRetrievals: number;
  readonly missedAbsenceFailures: number;
  readonly events: readonly ReversibleRetrievalAuditEvent[];
}

export type CanonicalEvidencePurpose = "citation" | "sensitive-action" | "verification";

export interface VerifyCanonicalEvidenceInput {
  readonly retrievalHandle: string;
  readonly expectedSourceHash: string;
  readonly purpose: CanonicalEvidencePurpose;
}

export type CanonicalEvidenceVerification =
  | {
    readonly verified: true;
    readonly purpose: CanonicalEvidencePurpose;
    readonly retrievalHandle: string;
    readonly sourceHash: string;
  }
  | {
    readonly verified: false;
    readonly purpose: CanonicalEvidencePurpose;
    readonly retrievalHandle: string;
    readonly reason: "canonical-evidence-unavailable" | "source-hash-mismatch";
  };

export class ReversibleContextProjectionService {
  private readonly store: ArtifactResourceStore;
  private readonly namespace: string;
  private retrievalOpportunities = 0;
  private attemptedRetrievals = 0;
  private successfulRetrievals = 0;
  private missedAbsenceFailures = 0;
  private readonly events: ReversibleRetrievalAuditEvent[] = [];

  constructor(options: ReversibleContextProjectionServiceOptions) {
    this.store = options.store;
    this.namespace = options.namespace?.trim() || "context-evidence";
  }

  createContextCandidate(input: CreateReversibleContextCandidateInput): ContextCandidate {
    const source = input.source.trim();
    if (source.length === 0) throw new Error("Reversible context candidates require a source.");
    const canonical = JSON.stringify(input.artifact);
    const sourceHash = hash(canonical);
    const metadata = this.store.put({
      namespace: this.namespace,
      title: `${input.artifact.kind} canonical context evidence`,
      mimeType: "application/json",
      content: { type: "json", value: input.artifact },
      producer: { kind: "context", name: "reversible-context-projection" },
      retention: { scope: "verification" },
    });
    const canonicalArtifactUri = `kiln://artifacts/${metadata.namespace}/${metadata.id}/content`;
    const reduction = reduceTypedArtifact({ artifact: input.artifact, canonicalArtifactUri });
    if (reduction.mode === "canonical"
      && (reduction.reason === "unknown-artifact-type" || reduction.reason === "malformed-artifact")) {
      throw new Error("Reversible context projection requires a valid typed artifact.");
    }

    const fullContent = JSON.stringify(input.artifact, null, 2);
    const projectionOptions: ContextProjectionOption[] = [{
      mode: "full",
      transformationMode: "none",
      canonicalArtifactUri,
      sourceHash,
      omissionDisclosed: false,
      content: fullContent,
    }];
    if (reduction.mode === "lossless") {
      projectionOptions.push({
        mode: "lossless",
        transformationMode: "lossless",
        canonicalArtifactUri,
        sourceHash,
        omissionDisclosed: false,
        content: [
          `[Lossless typed artifact projection: ${input.artifact.kind}]`,
          `Encoding: ${reduction.encoding}`,
          `Canonical artifact: ${canonicalArtifactUri}`,
          `Payload: ${reduction.projection}`,
        ].join("\n"),
      });
    }
    projectionOptions.push({
      mode: "reversible",
      transformationMode: "reversible",
      canonicalArtifactUri,
      sourceHash,
      retrievalHandle: canonicalArtifactUri,
      omissionDisclosed: true,
      content: renderReversibleDisclosure(input.artifact, canonicalArtifactUri, sourceHash),
    });
    this.retrievalOpportunities += 1;

    return {
      kind: "artifact",
      source,
      content: fullContent,
      required: input.required,
      score: input.score,
      projectionOptions,
    };
  }

  retrieve(retrievalHandle: string): ReversibleRetrievalResult {
    this.attemptedRetrievals += 1;
    const identity = this.parseHandle(retrievalHandle);
    if (!identity) return this.missing(retrievalHandle, "invalid-retrieval-handle");
    const resource = this.store.get(identity.namespace, identity.id);
    if (!resource) return this.missing(retrievalHandle, "artifact-not-found");
    if (resource.content.type !== "json") return this.missing(retrievalHandle, "invalid-canonical-artifact");
    const validation = reduceTypedArtifact({ artifact: resource.content.value, canonicalArtifactUri: retrievalHandle });
    if (validation.mode === "canonical"
      && (validation.reason === "unknown-artifact-type" || validation.reason === "malformed-artifact")) {
      return this.missing(retrievalHandle, "invalid-canonical-artifact");
    }
    const artifact = resource.content.value as TypedArtifact;
    const sourceHash = hash(JSON.stringify(artifact));
    this.successfulRetrievals += 1;
    this.events.push({ retrievalHandle, outcome: "available" });
    return {
      status: "available",
      retrievalHandle,
      canonicalArtifactUri: retrievalHandle,
      sourceHash,
      artifact,
    };
  }

  verifyCanonicalEvidence(input: VerifyCanonicalEvidenceInput): CanonicalEvidenceVerification {
    const result = this.retrieve(input.retrievalHandle);
    if (result.status === "missing") {
      return {
        verified: false,
        purpose: input.purpose,
        retrievalHandle: input.retrievalHandle,
        reason: "canonical-evidence-unavailable",
      };
    }
    if (result.sourceHash !== input.expectedSourceHash) {
      return {
        verified: false,
        purpose: input.purpose,
        retrievalHandle: input.retrievalHandle,
        reason: "source-hash-mismatch",
      };
    }
    return {
      verified: true,
      purpose: input.purpose,
      retrievalHandle: input.retrievalHandle,
      sourceHash: result.sourceHash,
    };
  }

  audit(): ReversibleRetrievalAudit {
    return {
      retrievalOpportunities: this.retrievalOpportunities,
      attemptedRetrievals: this.attemptedRetrievals,
      successfulRetrievals: this.successfulRetrievals,
      missedAbsenceFailures: this.missedAbsenceFailures,
      events: [...this.events],
    };
  }

  private parseHandle(handle: string): { readonly namespace: string; readonly id: string } | undefined {
    const prefix = "kiln://artifacts/";
    if (!handle.startsWith(prefix)) return undefined;
    const parts = handle.slice(prefix.length).split("/");
    if (parts.length !== 3 || parts[0] !== this.namespace || parts[2] !== "content") return undefined;
    const id = parts[1];
    if (!id || !/^artifact_\d+$/u.test(id)) return undefined;
    return { namespace: this.namespace, id };
  }

  private missing(
    retrievalHandle: string,
    reason: ReversibleRetrievalMissing["reason"],
  ): ReversibleRetrievalMissing {
    this.missedAbsenceFailures += 1;
    this.events.push({ retrievalHandle, outcome: "missing", reason });
    return { status: "missing", retrievalHandle, reason };
  }
}

function renderReversibleDisclosure(
  artifact: TypedArtifact,
  retrievalHandle: string,
  sourceHash: string,
): string {
  const entryCount = "entries" in artifact
    ? artifact.entries.length
    : artifact.kind === "table"
      ? artifact.rows.length
      : 1;
  return [
    `[Reversible artifact projection: ${artifact.kind}]`,
    "Canonical evidence is omitted from active context.",
    `Retrieval handle: ${retrievalHandle}`,
    `Canonical source hash: ${sourceHash}`,
    `Exit status: ${artifact.exitStatus === null ? "not reported" : artifact.exitStatus}`,
    `Warnings: ${artifact.warnings.length}`,
    `Omitted records: ${entryCount}`,
    "Retrieve the canonical artifact before asserting absence, citing exact evidence, or taking a sensitive action.",
  ].join("\n");
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
