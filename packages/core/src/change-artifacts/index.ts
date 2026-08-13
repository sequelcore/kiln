import { sha256ContentIdentity } from "../context/content-identity.js";

export type ChangeVerificationStatus = "passed" | "failed" | "not-run";

export interface ChangeWorkEvidence {
  readonly id: string;
  readonly url?: string;
}

export interface ChangeVerificationEvidence {
  readonly id: string;
  readonly command: string;
  readonly status: ChangeVerificationStatus;
  readonly candidateRevision: string;
}

export interface ChangeArtifactEvidenceInput {
  readonly candidateRevision: string;
  readonly diffHash: string;
  readonly linkedWork: readonly ChangeWorkEvidence[];
  readonly verification: readonly ChangeVerificationEvidence[];
  readonly residualRisks: readonly string[];
}

export interface ChangeArtifactEvidence extends ChangeArtifactEvidenceInput {
  readonly version: "v1";
  readonly identity: string;
}

export interface EvidenceBoundClaim {
  readonly text: string;
  readonly evidenceIds: readonly string[];
}

export interface ChangeArtifactValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface CommitArtifact {
  readonly kind: "commit-message";
  readonly contractVersion: "v1";
  readonly content: string;
  readonly subject: string;
  readonly subjectCeiling: number;
  readonly evidence: ChangeArtifactEvidence;
  readonly evidenceIdentity: string;
  readonly claimEvidence: readonly EvidenceBoundClaim[];
}

export interface PullRequestFinding extends EvidenceBoundClaim {
  readonly severity: "critical" | "high" | "medium" | "low";
  readonly status: "open" | "resolved";
}

export interface PullRequestArtifact {
  readonly kind: "pull-request";
  readonly contractVersion: "v1";
  readonly title: string;
  readonly content: string;
  readonly candidateRevision: string;
  readonly diffHash: string;
  readonly evidence: ChangeArtifactEvidence;
  readonly evidenceIdentity: string;
  readonly claimEvidence: readonly EvidenceBoundClaim[];
  readonly findings: readonly PullRequestFinding[];
}

export function createChangeArtifactEvidence(input: ChangeArtifactEvidenceInput): ChangeArtifactEvidence {
  const candidateRevision = required(input.candidateRevision, "candidateRevision");
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.diffHash)) {
    throw new Error("Change artifact diffHash must be a sha256 content identity.");
  }
  const linkedWork = uniqueBy(input.linkedWork.map((work) => ({
    id: portable(required(work.id, "linkedWork.id"), "linkedWork.id"),
    ...(work.url ? { url: required(work.url, "linkedWork.url") } : {}),
  })), (work) => work.id);
  const verification = uniqueBy(input.verification.map((item) => {
    const revision = required(item.candidateRevision, "verification.candidateRevision");
    if (revision !== candidateRevision) {
      throw new Error("Change artifact verification must match the exact candidate revision.");
    }
    return {
      id: portable(required(item.id, "verification.id"), "verification.id"),
      command: required(item.command, "verification.command"),
      status: item.status,
      candidateRevision: revision,
    };
  }), (item) => item.id);
  const residualRisks = uniqueText(input.residualRisks);
  const value = {
    version: "v1" as const,
    candidateRevision,
    diffHash: input.diffHash,
    linkedWork,
    verification,
    residualRisks,
  };
  return { ...value, identity: sha256ContentIdentity(stableStringify(value)) };
}

export function renderCommitArtifact(input: {
  readonly evidence: ChangeArtifactEvidence;
  readonly subject: { readonly imperativeVerb: string; readonly object: string };
  readonly claims: readonly EvidenceBoundClaim[];
  readonly includeWorkReferences?: boolean;
  readonly subjectCeiling?: number;
}): CommitArtifact {
  validateEvidenceIdentity(input.evidence);
  const imperativeVerb = required(input.subject.imperativeVerb, "commit imperative verb");
  if (!/^\p{Lu}[\p{L}-]*$/u.test(imperativeVerb)) {
    throw new Error("Commit subject must begin with an explicit imperative verb.");
  }
  const object = required(input.subject.object, "commit subject object").replace(/[.]$/u, "");
  const subject = `${imperativeVerb} ${object}`;
  const subjectCeiling = input.subjectCeiling ?? 72;
  if (!Number.isInteger(subjectCeiling) || subjectCeiling < 1 || subject.length > subjectCeiling) {
    throw new Error("Commit subject exceeds the configured practical subject ceiling.");
  }
  const claims = validateClaims(input.claims, input.evidence);
  const includeWorkReferences = input.includeWorkReferences ?? true;
  const body = [
    ...claims.map((claim) => claim.text),
    ...(includeWorkReferences && input.evidence.linkedWork.length > 0
      ? ["", `Refs: ${input.evidence.linkedWork.map((work) => work.id).join(", ")}`]
      : []),
  ];
  const content = body.length > 0 ? [subject, "", ...body].join("\n") : subject;
  const artifact: CommitArtifact = {
    kind: "commit-message",
    contractVersion: "v1",
    content,
    subject,
    subjectCeiling,
    evidence: input.evidence,
    evidenceIdentity: input.evidence.identity,
    claimEvidence: claims,
  };
  const validation = validateCommitArtifact(artifact);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  return artifact;
}

export function validateCommitArtifact(artifact: CommitArtifact): ChangeArtifactValidation {
  const errors: string[] = [];
  if (!artifact.subject.trim()) errors.push("Commit subject is required.");
  const firstWord = artifact.subject.trim().split(/\s+/u)[0] ?? "";
  if (!/^\p{Lu}[\p{L}-]*$/u.test(firstWord)) {
    errors.push("Commit subject must begin with an explicit imperative verb.");
  }
  if (artifact.subject.endsWith(".")) errors.push("Commit subject must not end with a period.");
  if (!Number.isInteger(artifact.subjectCeiling) || artifact.subjectCeiling < 1
    || artifact.subject.length > artifact.subjectCeiling) errors.push("Commit subject exceeds its ceiling.");
  if (!artifact.content.startsWith(artifact.subject)) errors.push("Commit content must start with its subject.");
  if (artifact.content !== artifact.subject && !artifact.content.startsWith(`${artifact.subject}\n\n`)) {
    errors.push("Commit subject and body must be separated by one blank line.");
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(artifact.evidenceIdentity)) {
    errors.push("Commit artifact requires an evidence identity.");
  }
  validateArtifactEvidence(artifact.evidence, artifact.evidenceIdentity, artifact.claimEvidence, errors, "Commit");
  return { valid: errors.length === 0, errors };
}

export function renderPullRequestArtifact(input: {
  readonly evidence: ChangeArtifactEvidence;
  readonly title: string;
  readonly outcome: EvidenceBoundClaim;
  readonly problem: EvidenceBoundClaim;
  readonly scope: readonly EvidenceBoundClaim[];
  readonly exclusions: readonly string[];
  readonly decisions: readonly EvidenceBoundClaim[];
  readonly findings?: readonly PullRequestFinding[];
}): PullRequestArtifact {
  validateEvidenceIdentity(input.evidence);
  const title = required(input.title, "pull request title");
  const outcome = validateClaim(input.outcome, input.evidence);
  const problem = validateClaim(input.problem, input.evidence);
  const scope = validateClaims(input.scope, input.evidence);
  const decisions = validateClaims(input.decisions, input.evidence);
  const findings = (input.findings ?? []).map((finding) => ({
    ...validateClaim(finding, input.evidence),
    severity: finding.severity,
    status: finding.status,
  }));
  const unresolved = findings.filter((finding) => finding.status === "open");
  const lines = [
    ...(unresolved.length > 0
      ? ["## Findings", "", ...unresolved.map((finding) => `- **${finding.severity}:** ${finding.text}`), ""]
      : []),
    "## Outcome",
    "",
    outcome.text,
    "",
    "## Problem",
    "",
    problem.text,
    "",
    "## Scope",
    "",
    ...(scope.length > 0 ? scope.map((claim) => `- ${claim.text}`) : ["- No implementation scope recorded."]),
    "",
    "## Exclusions",
    "",
    ...listOrNone(input.exclusions),
    "",
    "## Decisions",
    "",
    ...(decisions.length > 0 ? decisions.map((claim) => `- ${claim.text}`) : ["- None recorded."]),
    "",
    "## Verification",
    "",
    ...(input.evidence.verification.length > 0
      ? input.evidence.verification.map((item) => `- \`${item.command}\` — ${item.status}`)
      : ["- Not run."]),
    "",
    "## Residual risk",
    "",
    ...listOrNone(input.evidence.residualRisks),
    "",
    "## Evidence",
    "",
    `- Candidate revision: \`${input.evidence.candidateRevision}\``,
    `- Diff: \`${input.evidence.diffHash}\``,
    ...input.evidence.linkedWork.map((work) => `- Work: ${work.url ? `[${work.id}](${work.url})` : work.id}`),
  ];
  const artifact: PullRequestArtifact = {
    kind: "pull-request",
    contractVersion: "v1",
    title,
    content: lines.join("\n"),
    candidateRevision: input.evidence.candidateRevision,
    diffHash: input.evidence.diffHash,
    evidence: input.evidence,
    evidenceIdentity: input.evidence.identity,
    claimEvidence: [outcome, problem, ...scope, ...decisions, ...findings],
    findings,
  };
  const validation = validatePullRequestArtifact(artifact);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  return artifact;
}

export function validatePullRequestArtifact(artifact: PullRequestArtifact): ChangeArtifactValidation {
  const errors: string[] = [];
  if (!artifact.title.trim()) errors.push("Pull request title is required.");
  for (const section of ["## Outcome", "## Problem", "## Scope", "## Verification", "## Residual risk", "## Evidence"]) {
    if (!artifact.content.includes(section)) errors.push(`Pull request is missing ${section}.`);
  }
  if (!artifact.content.includes(`Candidate revision: \`${artifact.candidateRevision}\``)) {
    errors.push("Pull request does not identify its candidate revision.");
  }
  if (!artifact.content.includes(artifact.diffHash)) errors.push("Pull request does not identify its diff.");
  if (artifact.candidateRevision !== artifact.evidence.candidateRevision) {
    errors.push("Pull request candidate revision does not match its evidence.");
  }
  if (artifact.diffHash !== artifact.evidence.diffHash) {
    errors.push("Pull request diff does not match its evidence.");
  }
  validateArtifactEvidence(
    artifact.evidence,
    artifact.evidenceIdentity,
    [...artifact.claimEvidence, ...artifact.findings],
    errors,
    "Pull request",
  );
  const firstSection = /^## ([^\n]+)/u.exec(artifact.content)?.[1];
  if (artifact.findings.some((finding) => finding.status === "open") && firstSection !== "Findings") {
    errors.push("Pull request with unresolved findings must lead with findings.");
  }
  return { valid: errors.length === 0, errors };
}

function validateArtifactEvidence(
  evidence: ChangeArtifactEvidence,
  evidenceIdentity: string,
  claims: readonly EvidenceBoundClaim[],
  errors: string[],
  label: string,
): void {
  try {
    validateEvidenceIdentity(evidence);
  } catch (error) {
    errors.push(`${label} ${error instanceof Error ? error.message : String(error)}`);
  }
  if (evidenceIdentity !== evidence.identity) {
    errors.push(`${label} evidence identity does not match its embedded evidence.`);
  }
  for (const claim of claims) {
    try {
      validateClaim(claim, evidence);
    } catch (error) {
      errors.push(`${label} ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function validateEvidenceIdentity(evidence: ChangeArtifactEvidence): void {
  const { identity: _identity, ...value } = evidence;
  if (sha256ContentIdentity(stableStringify(value)) !== evidence.identity) {
    throw new Error("Change artifact evidence identity does not match its content.");
  }
}

function validateClaims(
  claims: readonly EvidenceBoundClaim[],
  evidence: ChangeArtifactEvidence,
): readonly EvidenceBoundClaim[] {
  return claims.map((claim) => validateClaim(claim, evidence));
}

function validateClaim(claim: EvidenceBoundClaim, evidence: ChangeArtifactEvidence): EvidenceBoundClaim {
  const text = required(claim.text, "artifact claim");
  const evidenceIds = uniqueText(claim.evidenceIds);
  if (evidenceIds.length === 0) throw new Error("Artifact claim requires evidence.");
  const known = new Set([
    "diff",
    ...evidence.linkedWork.map((work) => `work:${work.id}`),
    ...evidence.verification.map((item) => `verification:${item.id}`),
  ]);
  const unknown = evidenceIds.find((id) => !known.has(id));
  if (unknown) throw new Error(`Artifact claim references unknown evidence '${unknown}'.`);
  return { text, evidenceIds };
}

function listOrNone(values: readonly string[]): readonly string[] {
  const normalized = uniqueText(values);
  return normalized.length > 0 ? normalized.map((value) => `- ${value}`) : ["- None recorded."];
}

function uniqueText(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => required(value, "list value")))];
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): readonly T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identity = key(value);
    if (seen.has(identity)) throw new Error(`Change artifact evidence duplicates '${identity}'.`);
    seen.add(identity);
    return true;
  });
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must be non-empty.`);
  return normalized;
}

function portable(value: string, field: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(value)) {
    throw new Error(`${field} must be a portable identifier.`);
  }
  return value;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}
