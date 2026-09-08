import { sha256ContentIdentity } from "../content-addressing/content-identity.js";

export type ChangeVerificationStatus = "passed" | "failed" | "not-run";

export interface ChangeWorkEvidence {
  readonly id: string;
  readonly url?: string;
}

export interface ChangeVerificationEvidence {
  readonly id: string;
  readonly command: string;
  readonly status: ChangeVerificationStatus;
  readonly revision: string;
}

export interface ChangeArtifactEvidenceInput {
  readonly candidateRevision: string;
  readonly baselineRevision?: string;
  readonly diffHash: string;
  readonly linkedWork: readonly ChangeWorkEvidence[];
  readonly verification: readonly ChangeVerificationEvidence[];
  readonly residualRisks: readonly string[];
}

export interface ChangeArtifactEvidence extends ChangeArtifactEvidenceInput {
  readonly version: "v2";
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
  readonly contractVersion: "v2";
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
  readonly contractVersion: "v2";
  readonly title: string;
  readonly content: string;
  readonly body: readonly EvidenceBoundClaim[];
  readonly evidence: ChangeArtifactEvidence;
  readonly findings: readonly PullRequestFinding[];
}

export function createChangeArtifactEvidence(input: ChangeArtifactEvidenceInput): ChangeArtifactEvidence {
  const candidateRevision = required(input.candidateRevision, "candidateRevision");
  const baselineRevision = input.baselineRevision === undefined ? undefined : required(input.baselineRevision, "baselineRevision");
  if (baselineRevision === candidateRevision) throw new Error("Baseline and candidate revisions must differ.");
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.diffHash)) {
    throw new Error("Change artifact diffHash must be a sha256 content identity.");
  }
  const linkedWork = uniqueBy(input.linkedWork.map((work) => ({
    id: portable(required(work.id, "linkedWork.id"), "linkedWork.id"),
    ...(work.url ? { url: required(work.url, "linkedWork.url") } : {}),
  })), (work) => work.id);
  const verification = uniqueBy(input.verification.map((item) => {
    const revision = required(item.revision, "verification.revision");
    if (revision !== candidateRevision && revision !== baselineRevision) {
      throw new Error("Change artifact verification must match the candidate revision or declared baseline revision.");
    }
    return {
      id: portable(required(item.id, "verification.id"), "verification.id"),
      command: required(item.command, "verification.command"),
      status: item.status,
      revision,
    };
  }), (item) => item.id);
  const residualRisks = uniqueText(input.residualRisks);
  const value = {
    version: "v2" as const,
    candidateRevision,
    ...(baselineRevision === undefined ? {} : { baselineRevision }),
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
    contractVersion: "v2",
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
  if (artifact.contractVersion !== "v2") errors.push("Unsupported commit contract version.");
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
  readonly body: readonly EvidenceBoundClaim[];
  readonly findings?: readonly PullRequestFinding[];
}): PullRequestArtifact {
  validateEvidenceIdentity(input.evidence);
  const title = required(input.title, "pull request title");
  const body = validateClaims(input.body, input.evidence);
  if (body.length === 0) throw new Error("Pull request body must be non-empty.");
  const findings = (input.findings ?? []).map((finding) => ({
    ...validateClaim(finding, input.evidence),
    severity: finding.severity,
    status: finding.status,
  }));
  const artifact: PullRequestArtifact = {
    kind: "pull-request",
    contractVersion: "v2",
    title,
    content: renderPullRequestContent(body, findings, input.evidence),
    body,
    evidence: input.evidence,
    findings,
  };
  const validation = validatePullRequestArtifact(artifact);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  return artifact;
}

export function validatePullRequestArtifact(artifact: PullRequestArtifact): ChangeArtifactValidation {
  const errors: string[] = [];
  if (artifact.contractVersion !== "v2") errors.push("Unsupported pull request contract version.");
  if (!artifact.title.trim()) errors.push("Pull request title is required.");
  if (artifact.body.length === 0) errors.push("Pull request body must be non-empty.");
  validateArtifactEvidence(
    artifact.evidence,
    artifact.evidence.identity,
    [...artifact.body, ...artifact.findings],
    errors,
    "Pull request",
  );
  if (artifact.content !== renderPullRequestContent(artifact.body, artifact.findings, artifact.evidence)) {
    errors.push("Pull request content does not match its body, findings, and evidence.");
  }
  return { valid: errors.length === 0, errors };
}

function renderPullRequestContent(
  body: readonly EvidenceBoundClaim[],
  findings: readonly PullRequestFinding[],
  evidence: ChangeArtifactEvidence,
): string {
  const unresolved = findings.filter((finding) => finding.status === "open");
  const verification = evidence.verification.map((item) => {
    const revisionLabel = evidence.baselineRevision === undefined ? "" :
      ` (${item.revision === evidence.candidateRevision ? "candidate" : "baseline"} \`${item.revision}\`)`;
    return `\`${item.command}\`${revisionLabel} — ${item.status}`;
  });
  if (!evidence.verification.some((item) => item.revision === evidence.candidateRevision)) {
    verification.push(evidence.baselineRevision === undefined ? "Not run." : `Candidate \`${evidence.candidateRevision}\`: Not run.`);
  }
  const blocks = [
    ...(unresolved.length > 0
      ? ["## Findings\n\n" + unresolved.map((finding) => `- **${finding.severity}:** ${finding.text}`).join("\n")]
      : []),
    ...body.map((claim) => claim.text),
    renderEvidenceList("Verification", verification),
    ...(evidence.residualRisks.length > 0 ? [renderEvidenceList("Residual risk", evidence.residualRisks)] : []),
    ...(evidence.linkedWork.length > 0
      ? ["Related: " + evidence.linkedWork.map((work) => (work.url ? `[${work.id}](${work.url})` : work.id)).join(", ")]
      : []),
  ];
  return blocks.join("\n\n");
}

function renderEvidenceList(label: string, values: readonly string[]): string {
  return values.length === 1
    ? `${label}: ${values[0]}`
    : `## ${label}\n\n${values.map((value) => `- ${value}`).join("\n")}`;
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
  if (sha256ContentIdentity(stableStringify(value)) !== evidence.identity
    || createChangeArtifactEvidence(evidence).identity !== evidence.identity) {
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
