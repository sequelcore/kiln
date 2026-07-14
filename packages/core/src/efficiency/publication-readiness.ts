import { createHash } from "node:crypto";
import { isAbsolute, win32 } from "node:path";

export type VerifiedEfficiencyClaimKind = "none" | "token-efficiency" | "cost-efficiency" | "verified-quality";
export type VerifiedEfficiencyPublicationStatus = "blocked" | "internal-evidence-only" | "public-ready";
export type VerifiedEfficiencyPublicationArtifactKind = "fixture" | "limitations" | "methodology" | "report";

export interface VerifiedEfficiencyPublicationArtifact {
  readonly kind: VerifiedEfficiencyPublicationArtifactKind;
  readonly path: string;
  readonly mediaType: string;
  readonly sha256: string;
}

export interface VerifiedEfficiencyPublicationManifest {
  readonly schemaVersion: "verified-efficiency-publication-manifest-v1";
  readonly claim: {
    readonly kind: VerifiedEfficiencyClaimKind;
    readonly statement: string;
  };
  readonly identity: {
    readonly kilnVersion: string;
    readonly kilnCommit: string;
    readonly harness: string;
    readonly harnessVersion: string;
    readonly providerOrRoutePolicy: string;
    readonly modelOrPolicy: string;
    readonly reasoningEffort: string;
    readonly sdkOrApiVersion: string;
    readonly authorityProfileHash: string;
    readonly toolCatalogHash: string;
    readonly configurationHash: string;
    readonly environment: Readonly<Record<string, string>>;
  };
  readonly design: {
    readonly pairedIdenticalTasks: boolean;
    readonly k: number;
    readonly datasetVersion: string;
    readonly fixtureSetHash: string;
    readonly seeds: readonly string[];
    readonly confidence: {
      readonly method: string;
      readonly level: number;
      readonly lowerBound: number;
    };
    readonly failedCaseIds: readonly string[];
    readonly omittedCaseIds: readonly string[];
    readonly hardInvariantFailures: readonly string[];
  };
  readonly evidence: {
    readonly measuredEstimatedCachedAvoidedDistinct: boolean;
    readonly qualityNonInferior: boolean;
    readonly verificationNonInferior: boolean;
    readonly economics: "metered-comparable" | "subscription-non-comparable" | "unknown";
  };
  readonly exactCommands: readonly string[];
  readonly limitations: readonly string[];
  readonly vendorDependencies: readonly string[];
  readonly artifacts: readonly VerifiedEfficiencyPublicationArtifact[];
}

export interface VerifiedEfficiencyPublicationObservation {
  readonly providerTotalTokens: number;
  readonly measuredTokens: number;
  readonly estimatedTokens: number;
  readonly cachedTokens: number;
  readonly cacheWrittenTokens: number;
  readonly unknownTokens: number;
  readonly avoidedTokens: number;
  readonly qualityScore: number;
  readonly verificationPassed: boolean;
  readonly costUsd: number | "unknown";
  readonly hardInvariantFailures: readonly string[];
}

export interface VerifiedEfficiencyPublicationPair {
  readonly taskId: string;
  readonly seed: string;
  readonly taskDefinitionHash: string;
  readonly baselineInputHash: string;
  readonly candidateInputHash: string;
  readonly baselineExecutionEnvelopeHash: string;
  readonly candidateExecutionEnvelopeHash: string;
  readonly baseline: VerifiedEfficiencyPublicationObservation;
  readonly candidate: VerifiedEfficiencyPublicationObservation;
}

export interface VerifiedEfficiencyPublicationReport {
  readonly schemaVersion: "verified-efficiency-publication-report-v1";
  readonly claimKind: VerifiedEfficiencyClaimKind;
  readonly claim: string;
  readonly identity: VerifiedEfficiencyPublicationManifest["identity"];
  readonly datasetVersion: string;
  readonly configurationHash: string;
  readonly methodologySha256: string;
  readonly fixtureSha256: string;
  readonly limitationsSha256: string;
  readonly benchmarkBaselinesSha256: string;
  readonly confidence: VerifiedEfficiencyPublicationManifest["design"]["confidence"];
  readonly economics: VerifiedEfficiencyPublicationManifest["evidence"]["economics"];
  readonly pairs: readonly VerifiedEfficiencyPublicationPair[];
  readonly failedCaseIds: readonly string[];
  readonly omittedCaseIds: readonly string[];
  readonly hardInvariantFailures: readonly string[];
  readonly limitations: readonly string[];
  readonly vendorDependencies: readonly string[];
}

export type VerifiedEfficiencyCommittedArtifactReader = (path: string, commit: string) => string | undefined;

export interface VerifiedEfficiencyPublicationReadiness {
  readonly schemaVersion: "verified-efficiency-publication-readiness-v1";
  readonly status: VerifiedEfficiencyPublicationStatus;
  readonly publicClaimAllowed: boolean;
  readonly claim: VerifiedEfficiencyPublicationManifest["claim"];
  readonly identity?: VerifiedEfficiencyPublicationManifest["identity"];
  readonly benchmarkBaselinesSha256: string;
  readonly issues: readonly string[];
  readonly manifestHash: string;
  readonly verifiedArtifacts: readonly VerifiedEfficiencyPublicationArtifact[];
}

export function evaluateVerifiedEfficiencyPublicationReadiness(
  value: unknown,
  readArtifact: (path: string) => string | undefined,
  readCommittedArtifact?: VerifiedEfficiencyCommittedArtifactReader,
): VerifiedEfficiencyPublicationReadiness {
  const issues: string[] = [];
  const manifest = parsePublicationManifest(value, issues);
  if (!manifest) {
    return {
      schemaVersion: "verified-efficiency-publication-readiness-v1",
      status: "blocked",
      publicClaimAllowed: false,
      claim: { kind: "none", statement: "Invalid publication manifest." },
      benchmarkBaselinesSha256: "sha256:unknown",
      issues,
      manifestHash: hashJson(value),
      verifiedArtifacts: [],
    };
  }
  if (manifest.schemaVersion !== "verified-efficiency-publication-manifest-v1") {
    issues.push("unsupported publication manifest version");
  }
  requireText(manifest.claim.statement, "claim statement", issues);
  validateIdentity(manifest.identity, issues);
  validateDesign(manifest, issues);
  validateDisclosure(manifest, issues);
  const verifiedArtifacts = validateArtifacts(
    manifest,
    readArtifact,
    readCommittedArtifact,
    issues,
  );
  const report = validateReport(manifest, readArtifact, issues);
  if (manifest.claim.kind !== "none") {
    validatePublicClaim(manifest, report, issues);
  }
  const status: VerifiedEfficiencyPublicationStatus = issues.length > 0
    ? "blocked"
    : manifest.claim.kind === "none"
      ? "internal-evidence-only"
      : "public-ready";
  return {
    schemaVersion: "verified-efficiency-publication-readiness-v1",
    status,
    publicClaimAllowed: status === "public-ready",
    claim: manifest.claim,
    identity: manifest.identity,
    benchmarkBaselinesSha256: report?.benchmarkBaselinesSha256 ?? "sha256:unknown",
    issues,
    manifestHash: hashJson(manifest),
    verifiedArtifacts,
  };
}

export function hashVerifiedEfficiencyBenchmarkBaselines(baselines: unknown): string {
  return hashJson(baselines);
}

function parsePublicationManifest(
  value: unknown,
  issues: string[],
): VerifiedEfficiencyPublicationManifest | undefined {
  if (!isRecord(value)
    || !isRecord(value.claim)
    || typeof value.claim.statement !== "string"
    || !isClaimKind(value.claim.kind)
    || !isRecord(value.identity)
    || !isRecord(value.design)
    || typeof value.design.pairedIdenticalTasks !== "boolean"
    || typeof value.design.k !== "number"
    || typeof value.design.datasetVersion !== "string"
    || typeof value.design.fixtureSetHash !== "string"
    || !isStringArray(value.design.seeds)
    || !isRecord(value.design.confidence)
    || typeof value.design.confidence.method !== "string"
    || typeof value.design.confidence.level !== "number"
    || typeof value.design.confidence.lowerBound !== "number"
    || !isStringArray(value.design.failedCaseIds)
    || !isStringArray(value.design.omittedCaseIds)
    || !isStringArray(value.design.hardInvariantFailures)
    || !isRecord(value.evidence)
    || typeof value.evidence.measuredEstimatedCachedAvoidedDistinct !== "boolean"
    || typeof value.evidence.qualityNonInferior !== "boolean"
    || typeof value.evidence.verificationNonInferior !== "boolean"
    || !isEconomics(value.evidence.economics)
    || !isStringArray(value.exactCommands)
    || !isStringArray(value.limitations)
    || !isStringArray(value.vendorDependencies)
    || !Array.isArray(value.artifacts)
    || value.artifacts.some((artifact) => !isRecord(artifact)
      || !isArtifactKind(artifact.kind)
      || typeof artifact.path !== "string"
      || typeof artifact.mediaType !== "string"
      || typeof artifact.sha256 !== "string")) {
    issues.push("publication manifest shape is invalid");
    return undefined;
  }
  return value as unknown as VerifiedEfficiencyPublicationManifest;
}

function validateIdentity(
  value: unknown,
  issues: string[],
  labelPrefix = "",
): value is VerifiedEfficiencyPublicationManifest["identity"] {
  if (!isRecord(value)) {
    issues.push(`${labelPrefix}execution identity must be an object`);
    return false;
  }
  const identity = value;
  for (const [label, value] of Object.entries({
    "Kiln version": identity.kilnVersion,
    "Kiln commit": identity.kilnCommit,
    harness: identity.harness,
    "harness version": identity.harnessVersion,
    "provider or route policy": identity.providerOrRoutePolicy,
    "model or policy": identity.modelOrPolicy,
    "reasoning effort": identity.reasoningEffort,
    "SDK or API version": identity.sdkOrApiVersion,
  })) requireText(value, `${labelPrefix}${label}`, issues);
  if (typeof identity.kilnCommit !== "string" || !/^[a-f0-9]{40}$/u.test(identity.kilnCommit)) {
    issues.push(`${labelPrefix}Kiln commit must be an exact 40-character Git commit`);
  }
  for (const [label, value] of Object.entries({
    "authority profile hash": identity.authorityProfileHash,
    "tool catalog hash": identity.toolCatalogHash,
    "configuration hash": identity.configurationHash,
  })) requireHash(value, `${labelPrefix}${label}`, issues);
  if (!isRecord(identity.environment)
    || Object.keys(identity.environment).length === 0
    || Object.entries(identity.environment).some(([key, value]) => key.trim() === ""
      || typeof value !== "string" || value.trim() === "")) {
    issues.push(`${labelPrefix}environment and tool versions must be explicit`);
  }
  return true;
}

function validateDesign(manifest: VerifiedEfficiencyPublicationManifest, issues: string[]): void {
  const design = manifest.design;
  requireText(design.datasetVersion, "dataset version", issues);
  requireHash(design.fixtureSetHash, "fixture set hash", issues);
  requireText(design.confidence.method, "confidence method", issues);
  if (!Number.isFinite(design.confidence.level) || design.confidence.level <= 0 || design.confidence.level >= 1) {
    issues.push("confidence level must be between zero and one");
  }
  if (!Number.isFinite(design.confidence.lowerBound)) issues.push("confidence lower bound must be finite");
  if (!Number.isInteger(design.k) || design.k < 1) issues.push("k must be a positive integer");
  if (new Set(design.seeds).size !== design.seeds.length || design.seeds.some((seed) => seed.trim() === "")) {
    issues.push("seeds must be explicit and unique");
  }
  for (const [label, values] of [
    ["failed case", design.failedCaseIds],
    ["omitted case", design.omittedCaseIds],
    ["hard invariant failure", design.hardInvariantFailures],
  ] as const) {
    if (new Set(values).size !== values.length || values.some((value) => value.trim() === "")) {
      issues.push(`${label} identities must be explicit and unique`);
    }
  }
}

function validateDisclosure(manifest: VerifiedEfficiencyPublicationManifest, issues: string[]): void {
  if (manifest.exactCommands.length === 0 || manifest.exactCommands.some((command) => command.trim() === "")) {
    issues.push("exact reproduction commands are required");
  }
  if (manifest.limitations.length === 0 || manifest.limitations.some((limitation) => limitation.trim() === "")) {
    issues.push("limitations are required");
  }
  if (manifest.vendorDependencies.length === 0 || manifest.vendorDependencies.some((dependency) => dependency.trim() === "")) {
    issues.push("vendor and provider dependencies must be disclosed");
  }
}

function validateArtifacts(
  manifest: VerifiedEfficiencyPublicationManifest,
  readArtifact: (path: string) => string | undefined,
  readCommittedArtifact: VerifiedEfficiencyCommittedArtifactReader | undefined,
  issues: string[],
): readonly VerifiedEfficiencyPublicationArtifact[] {
  const artifacts = manifest.artifacts;
  const required: readonly VerifiedEfficiencyPublicationArtifactKind[] = ["fixture", "limitations", "methodology", "report"];
  const kinds = new Set<VerifiedEfficiencyPublicationArtifactKind>();
  const paths = new Set<string>();
  const verified: VerifiedEfficiencyPublicationArtifact[] = [];
  for (const artifact of artifacts) {
    if (kinds.has(artifact.kind)) issues.push(`duplicate publication artifact kind ${artifact.kind}`);
    if (paths.has(artifact.path)) issues.push(`duplicate publication artifact path ${artifact.path}`);
    kinds.add(artifact.kind);
    paths.add(artifact.path);
    if (!isCommittedRelativePath(artifact.path)) issues.push(`publication artifact path is not committed-relative: ${artifact.path}`);
    requireText(artifact.mediaType, `${artifact.kind} media type`, issues);
    requireHash(artifact.sha256, `${artifact.kind} digest`, issues);
    const content = readArtifact(artifact.path);
    if (content === undefined) {
      issues.push(`missing publication artifact ${artifact.path}`);
      continue;
    }
    if (sha256(content) !== artifact.sha256) {
      issues.push(`publication artifact digest mismatch for ${artifact.path}`);
      continue;
    }
    if (manifest.claim.kind !== "none") {
      const committedContent = readCommittedArtifact?.(artifact.path, manifest.identity.kilnCommit);
      if (committedContent === undefined) {
        issues.push(`publication artifact is not readable from declared commit: ${artifact.path}`);
        continue;
      }
      if (sha256(committedContent) !== artifact.sha256) {
        issues.push(`publication artifact does not match declared commit: ${artifact.path}`);
        continue;
      }
    }
    verified.push(artifact);
  }
  for (const kind of required) if (!kinds.has(kind)) issues.push(`missing publication artifact kind ${kind}`);
  return verified;
}

function validateReport(
  manifest: VerifiedEfficiencyPublicationManifest,
  readArtifact: (path: string) => string | undefined,
  issues: string[],
): VerifiedEfficiencyPublicationReport | undefined {
  const reportArtifact = manifest.artifacts.find((artifact) => artifact.kind === "report");
  if (!reportArtifact) return undefined;
  const content = readArtifact(reportArtifact.path);
  if (content === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    issues.push("publication report must be machine-readable JSON");
    return undefined;
  }
  const report = parsePublicationReport(value, issues);
  if (!report) return undefined;
  const methodology = manifest.artifacts.find((artifact) => artifact.kind === "methodology");
  const fixture = manifest.artifacts.find((artifact) => artifact.kind === "fixture");
  const limitations = manifest.artifacts.find((artifact) => artifact.kind === "limitations");
  if (manifest.design.fixtureSetHash !== fixture?.sha256) issues.push("fixture set hash does not match fixture artifact");
  if (report.methodologySha256 !== methodology?.sha256) issues.push("report methodology digest does not match manifest");
  if (report.fixtureSha256 !== fixture?.sha256) issues.push("report fixture digest does not match manifest");
  if (report.limitationsSha256 !== limitations?.sha256) issues.push("report limitations digest does not match manifest");
  if (report.configurationHash !== manifest.identity.configurationHash) issues.push("report configuration hash does not match manifest");
  if (!structurallyEqual(report.identity, manifest.identity)) issues.push("report execution identity does not match manifest");
  if (report.datasetVersion !== manifest.design.datasetVersion) issues.push("report dataset version does not match manifest");
  if (report.claimKind !== manifest.claim.kind) issues.push("report claim kind does not match manifest");
  if (report.claim !== manifest.claim.statement) issues.push("report claim statement does not match manifest");
  if (!structurallyEqual(report.confidence, manifest.design.confidence)) issues.push("report confidence evidence does not match manifest");
  if (report.economics !== manifest.evidence.economics) issues.push("report economics do not match manifest");
  if (!sameStrings(report.failedCaseIds, manifest.design.failedCaseIds)) issues.push("report failed cases do not match manifest");
  if (!sameStrings(report.omittedCaseIds, manifest.design.omittedCaseIds)) issues.push("report omitted cases do not match manifest");
  if (!sameStrings(report.hardInvariantFailures, manifest.design.hardInvariantFailures)) {
    issues.push("report hard-invariant failures do not match manifest");
  }
  if (!sameStrings(report.limitations, manifest.limitations)) issues.push("report limitations do not match manifest");
  if (!sameStrings(report.vendorDependencies, manifest.vendorDependencies)) {
    issues.push("report vendor dependencies do not match manifest");
  }
  if (report.pairs.length !== manifest.design.k) issues.push("report pair count does not match k");
  if (new Set(report.pairs.map((pair) => pair.taskId)).size !== report.pairs.length) {
    issues.push("report task identities must be unique");
  }
  if (!sameStrings(report.pairs.map((pair) => pair.seed), manifest.design.seeds)) {
    issues.push("report pair seeds do not match manifest");
  }
  const fixtureContent = fixture ? readArtifact(fixture.path) : undefined;
  if (fixtureContent !== undefined) validateReportAgainstFixture(report, fixtureContent, issues);
  const derived = deriveReportEvidence(report);
  if (manifest.design.pairedIdenticalTasks !== derived.pairedIdenticalTasks) {
    issues.push("manifest paired-identical assertion does not match report input hashes");
  }
  if (manifest.evidence.measuredEstimatedCachedAvoidedDistinct !== derived.categoriesDistinct) {
    issues.push("manifest token-category assertion does not match report observations");
  }
  if (manifest.evidence.qualityNonInferior !== derived.qualityNonInferior) {
    issues.push("manifest quality assertion does not match report observations");
  }
  if (manifest.evidence.verificationNonInferior !== derived.verificationNonInferior) {
    issues.push("manifest verification assertion does not match report observations");
  }
  return report;
}

function validatePublicClaim(
  manifest: VerifiedEfficiencyPublicationManifest,
  report: VerifiedEfficiencyPublicationReport | undefined,
  issues: string[],
): void {
  if (manifest.design.k < 5) issues.push("public claims require k >= 5");
  if (manifest.design.seeds.length < manifest.design.k) issues.push("public claims require at least one declared seed per repetition");
  if (manifest.design.hardInvariantFailures.length > 0) issues.push("public claims require zero hard-invariant failures");
  if (!report) {
    issues.push("public claims require a valid content-verified report");
    return;
  }
  const derived = deriveReportEvidence(report);
  if (!derived.pairedIdenticalTasks) issues.push("public claims require paired identical tasks");
  if (!derived.categoriesDistinct) issues.push("public claims require distinct reconciled token evidence categories");
  if (!derived.qualityNonInferior) issues.push("public claims require non-inferior verified quality");
  if (!derived.verificationNonInferior) issues.push("public claims require non-inferior verification");
  if (derived.hardInvariantFailures.length > 0) issues.push("public claims require zero observation hard-invariant failures");
  if (manifest.design.confidence.lowerBound <= 0) issues.push("public claims require a positive declared confidence lower bound");
  const derivedLowerBound = manifest.claim.kind === "token-efficiency"
    ? derived.tokenImprovementLowerBound
    : manifest.claim.kind === "cost-efficiency"
      ? derived.costImprovementLowerBound
      : derived.qualityImprovementLowerBound;
  if (derivedLowerBound === "unknown" || manifest.design.confidence.lowerBound > derivedLowerBound + 1e-12) {
    issues.push("declared confidence lower bound is not supported by paired observations");
  }
  if (manifest.claim.kind === "token-efficiency" && derived.candidateTokens >= derived.baselineTokens) {
    issues.push("token-efficiency claims require lower candidate provider-total tokens");
  }
  if (manifest.claim.kind === "cost-efficiency" && manifest.evidence.economics !== "metered-comparable") {
    issues.push("cost-efficiency claims require comparable metered economics");
  }
  if (manifest.claim.kind === "cost-efficiency"
    && (derived.baselineCostUsd === "unknown" || derived.candidateCostUsd === "unknown"
      || derived.candidateCostUsd >= derived.baselineCostUsd)) {
    issues.push("cost-efficiency claims require lower content-verified candidate cost");
  }
  if (manifest.claim.kind === "verified-quality" && derived.candidateQuality <= derived.baselineQuality) {
    issues.push("verified-quality claims require higher content-verified candidate quality");
  }
}

function parsePublicationReport(
  value: unknown,
  issues: string[],
): VerifiedEfficiencyPublicationReport | undefined {
  if (!isRecord(value)) {
    issues.push("publication report must be a JSON object");
    return undefined;
  }
  const before = issues.length;
  if (value.schemaVersion !== "verified-efficiency-publication-report-v1") issues.push("unsupported publication report version");
  for (const [field, label] of [
    ["claim", "report claim"],
    ["datasetVersion", "report dataset version"],
  ] as const) if (typeof value[field] !== "string" || value[field].trim() === "") issues.push(`${label} is required`);
  for (const [field, label] of [
    ["configurationHash", "report configuration hash"],
    ["methodologySha256", "report methodology digest"],
    ["fixtureSha256", "report fixture digest"],
    ["limitationsSha256", "report limitations digest"],
    ["benchmarkBaselinesSha256", "report benchmark baselines digest"],
  ] as const) requireHash(value[field], label, issues);
  if (!isClaimKind(value.claimKind)) issues.push("report claim kind is invalid");
  if (!isEconomics(value.economics)) issues.push("report economics are invalid");
  validateIdentity(value.identity, issues, "report ");
  validateConfidence(value.confidence, "report", issues);
  for (const field of ["failedCaseIds", "omittedCaseIds", "hardInvariantFailures", "limitations", "vendorDependencies"] as const) {
    validateStringArray(value[field], `report ${field}`, issues);
  }
  if (!Array.isArray(value.pairs) || value.pairs.length === 0) {
    issues.push("publication report requires paired observations");
  } else {
    for (const [index, pair] of value.pairs.entries()) validateReportPair(pair, index, issues);
  }
  if (issues.length !== before) return undefined;
  return value as unknown as VerifiedEfficiencyPublicationReport;
}

function validateReportPair(value: unknown, index: number, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`report pair ${index + 1} must be an object`);
    return;
  }
  if (typeof value.taskId !== "string" || value.taskId.trim() === "") issues.push(`report pair ${index + 1} task id is required`);
  if (typeof value.seed !== "string" || value.seed.trim() === "") issues.push(`report pair ${index + 1} seed is required`);
  for (const [field, label] of [
    ["taskDefinitionHash", "task definition hash"],
    ["baselineInputHash", "baseline input hash"],
    ["candidateInputHash", "candidate input hash"],
    ["baselineExecutionEnvelopeHash", "baseline execution-envelope hash"],
    ["candidateExecutionEnvelopeHash", "candidate execution-envelope hash"],
  ] as const) requireHash(value[field], `report pair ${index + 1} ${label}`, issues);
  validateObservation(value.baseline, `report pair ${index + 1} baseline`, issues);
  validateObservation(value.candidate, `report pair ${index + 1} candidate`, issues);
}

function validateObservation(value: unknown, label: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${label} must be an object`);
    return;
  }
  for (const field of [
    "providerTotalTokens",
    "measuredTokens",
    "estimatedTokens",
    "cachedTokens",
    "cacheWrittenTokens",
    "unknownTokens",
    "avoidedTokens",
  ] as const) if (!isNonNegativeInteger(value[field])) issues.push(`${label} ${field} must be a non-negative integer`);
  if (typeof value.qualityScore !== "number" || !Number.isFinite(value.qualityScore)
    || value.qualityScore < 0 || value.qualityScore > 1) issues.push(`${label} quality score must be between zero and one`);
  if (typeof value.verificationPassed !== "boolean") issues.push(`${label} verification status must be boolean`);
  if (value.costUsd !== "unknown" && (typeof value.costUsd !== "number" || !Number.isFinite(value.costUsd) || value.costUsd < 0)) {
    issues.push(`${label} cost must be non-negative or unknown`);
  }
  validateStringArray(value.hardInvariantFailures, `${label} hard invariant failures`, issues);
}

function validateReportAgainstFixture(
  report: VerifiedEfficiencyPublicationReport,
  fixtureContent: string,
  issues: string[],
): void {
  let fixture: unknown;
  try {
    fixture = JSON.parse(fixtureContent);
  } catch {
    issues.push("publication fixture must be machine-readable JSON");
    return;
  }
  if (!isRecord(fixture) || fixture.schemaVersion !== "verified-efficiency-reference-fixture-v1"
    || fixture.datasetVersion !== report.datasetVersion || !Array.isArray(fixture.pairs)) {
    issues.push("publication fixture schema or dataset does not match report");
    return;
  }
  const fixturePairs = fixture.pairs;
  if (fixture.benchmarkBaselinesSha256 !== report.benchmarkBaselinesSha256) {
    issues.push("fixture benchmark baselines digest does not match report");
  }
  for (const field of ["failedCaseIds", "omittedCaseIds", "hardInvariantFailures"] as const) {
    if (!Array.isArray(fixture[field]) || !sameStrings(fixture[field] as string[], report[field])) {
      issues.push(`fixture ${field} do not match report`);
    }
  }
  if (fixturePairs.length !== report.pairs.length) issues.push("fixture pair count does not match report");
  for (const [index, pair] of report.pairs.entries()) {
    const fixturePair = fixturePairs[index];
    if (!isRecord(fixturePair)
      || fixturePair.taskId !== pair.taskId
      || fixturePair.seed !== pair.seed
      || fixturePair.taskDefinitionHash !== pair.taskDefinitionHash
      || fixturePair.baselineInputHash !== pair.baselineInputHash
      || fixturePair.candidateInputHash !== pair.candidateInputHash
      || fixturePair.baselineExecutionEnvelopeHash !== pair.baselineExecutionEnvelopeHash
      || fixturePair.candidateExecutionEnvelopeHash !== pair.candidateExecutionEnvelopeHash
      || fixturePair.baselineTokens !== pair.baseline.providerTotalTokens
      || fixturePair.candidateTokens !== pair.candidate.providerTotalTokens
      || fixturePair.baselineVerified !== pair.baseline.verificationPassed
      || fixturePair.candidateVerified !== pair.candidate.verificationPassed) {
      issues.push(`fixture observation does not match report pair ${pair.taskId}`);
    }
  }
}

function deriveReportEvidence(report: VerifiedEfficiencyPublicationReport): {
  readonly pairedIdenticalTasks: boolean;
  readonly categoriesDistinct: boolean;
  readonly qualityNonInferior: boolean;
  readonly verificationNonInferior: boolean;
  readonly baselineTokens: number;
  readonly candidateTokens: number;
  readonly baselineQuality: number;
  readonly candidateQuality: number;
  readonly baselineCostUsd: number | "unknown";
  readonly candidateCostUsd: number | "unknown";
  readonly hardInvariantFailures: readonly string[];
  readonly tokenImprovementLowerBound: number;
  readonly qualityImprovementLowerBound: number;
  readonly costImprovementLowerBound: number | "unknown";
} {
  const observations = report.pairs.flatMap((pair) => [pair.baseline, pair.candidate]);
  const categoriesDistinct = observations.every((observation) =>
    observation.providerTotalTokens === observation.measuredTokens
      + observation.estimatedTokens
      + observation.cachedTokens
      + observation.cacheWrittenTokens
      + observation.unknownTokens)
    && report.pairs.every((pair) => pair.candidate.avoidedTokens
      === Math.max(0, pair.baseline.providerTotalTokens - pair.candidate.providerTotalTokens));
  const baselineQuality = average(report.pairs.map((pair) => pair.baseline.qualityScore));
  const candidateQuality = average(report.pairs.map((pair) => pair.candidate.qualityScore));
  const baselineVerification = report.pairs.filter((pair) => pair.baseline.verificationPassed).length;
  const candidateVerification = report.pairs.filter((pair) => pair.candidate.verificationPassed).length;
  return {
    pairedIdenticalTasks: report.pairs.every((pair) => pair.baselineInputHash === pair.candidateInputHash),
    categoriesDistinct,
    qualityNonInferior: candidateQuality >= baselineQuality,
    verificationNonInferior: candidateVerification >= baselineVerification,
    baselineTokens: report.pairs.reduce((total, pair) => total + pair.baseline.providerTotalTokens, 0),
    candidateTokens: report.pairs.reduce((total, pair) => total + pair.candidate.providerTotalTokens, 0),
    baselineQuality,
    candidateQuality,
    baselineCostUsd: sumKnownCosts(report.pairs.map((pair) => pair.baseline.costUsd)),
    candidateCostUsd: sumKnownCosts(report.pairs.map((pair) => pair.candidate.costUsd)),
    hardInvariantFailures: [...new Set([
      ...report.hardInvariantFailures,
      ...observations.flatMap((observation) => observation.hardInvariantFailures),
    ])],
    tokenImprovementLowerBound: minimum(report.pairs.map((pair) => pair.baseline.providerTotalTokens === 0
      ? 0
      : (pair.baseline.providerTotalTokens - pair.candidate.providerTotalTokens) / pair.baseline.providerTotalTokens)),
    qualityImprovementLowerBound: minimum(report.pairs.map((pair) => pair.candidate.qualityScore - pair.baseline.qualityScore)),
    costImprovementLowerBound: report.pairs.some((pair) => pair.baseline.costUsd === "unknown" || pair.candidate.costUsd === "unknown")
      ? "unknown"
      : minimum(report.pairs.map((pair) => {
          const baseline = pair.baseline.costUsd as number;
          const candidate = pair.candidate.costUsd as number;
          return baseline === 0 ? 0 : (baseline - candidate) / baseline;
        })),
  };
}

function validateConfidence(value: unknown, label: string, issues: string[]): void {
  if (!isRecord(value)
    || typeof value.method !== "string" || value.method.trim() === ""
    || typeof value.level !== "number" || !Number.isFinite(value.level) || value.level <= 0 || value.level >= 1
    || typeof value.lowerBound !== "number" || !Number.isFinite(value.lowerBound)) {
    issues.push(`${label} confidence evidence is invalid`);
  }
}

function validateStringArray(value: unknown, label: string, issues: string[]): void {
  if (!Array.isArray(value)
    || value.some((entry) => typeof entry !== "string" || entry.trim() === "")
    || new Set(value).size !== value.length) {
    issues.push(`${label} must contain unique non-empty strings`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isClaimKind(value: unknown): value is VerifiedEfficiencyClaimKind {
  return value === "none" || value === "token-efficiency" || value === "cost-efficiency" || value === "verified-quality";
}

function isArtifactKind(value: unknown): value is VerifiedEfficiencyPublicationArtifactKind {
  return value === "fixture" || value === "limitations" || value === "methodology" || value === "report";
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isEconomics(value: unknown): value is VerifiedEfficiencyPublicationManifest["evidence"]["economics"] {
  return value === "metered-comparable" || value === "subscription-non-comparable" || value === "unknown";
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function minimum(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.min(...values);
}

function sumKnownCosts(values: readonly (number | "unknown")[]): number | "unknown" {
  return values.some((value) => value === "unknown")
    ? "unknown"
    : (values as readonly number[]).reduce((total, value) => total + value, 0);
}

function isCommittedRelativePath(path: string): boolean {
  return path.trim() !== ""
    && !isAbsolute(path)
    && !win32.isAbsolute(path)
    && !path.startsWith("\\")
    && !path.split(/[\\/]/u).includes("..")
    && !path.replace(/\\/gu, "/").startsWith(".kiln/");
}

function requireText(value: unknown, label: string, issues: string[]): void {
  if (typeof value !== "string" || value.trim() === "") issues.push(`${label} is required`);
}

function requireHash(value: unknown, label: string, issues: string[]): void {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    issues.push(`${label} must be a SHA-256 digest`);
  }
}

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function hashJson(value: unknown): string {
  return sha256(stableJson(value));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
