import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type {
  ExternalEvidenceArtifact,
  ExternalEvidenceReport,
  ToolResourceDescriptor,
  ToolResourceProvider,
  ToolResourceReadOptions,
  ToolResourceReadResult,
  ToolResourceTemplateDescriptor,
} from "@kilnai/core";

const EXTERNAL_ENGAGEMENT_RESOURCE_ROOT = "kiln://external-engagement";
const JSON_MIME_TYPE = "application/json";
const MARKDOWN_MIME_TYPE = "text/markdown";
const TEXT_MIME_TYPE = "text/plain";

type ExternalEngagementArtifactKind =
  | "evidence-report"
  | "candidate-report"
  | "review-report"
  | "decision-report"
  | "feature-intake"
  | "artifact";

interface ExternalEngagementArtifactMetadata {
  readonly fileName: string;
  readonly resourceUri: string;
  readonly mimeType: string;
  readonly kind: ExternalEngagementArtifactKind;
  readonly evidenceArtifactCount?: number;
  readonly signalCount?: number;
  readonly candidateCount?: number;
  readonly reviewItemCount?: number;
  readonly decisionCount?: number;
  readonly proposalCount?: number;
}

interface ExternalEngagementArtifactSummary {
  readonly artifactCount: number;
  readonly evidenceReportCount: number;
  readonly candidateReportCount: number;
  readonly reviewReportCount: number;
  readonly decisionReportCount: number;
  readonly featureIntakeCount: number;
  readonly evidenceArtifactCount: number;
  readonly signalCount: number;
  readonly candidateCount: number;
  readonly reviewItemCount: number;
  readonly decisionCount: number;
  readonly proposalCount: number;
  readonly kinds: readonly ExternalEngagementArtifactKind[];
}

export class ExternalEngagementResourceProvider implements ToolResourceProvider {
  private readonly artifactRootPath: string;

  constructor(artifactRoot: string) {
    this.artifactRootPath = artifactRoot;
  }

  listResources(): readonly ToolResourceDescriptor[] {
    const artifacts = this.listArtifactMetadata();
    const summary = summarizeArtifacts(artifacts);
    return [
      {
        uri: `${EXTERNAL_ENGAGEMENT_RESOURCE_ROOT}/artifacts`,
        name: "external_engagement_artifacts",
        title: "External Engagement Artifacts",
        description: "Read-only index of governed external engagement evidence, candidate, review, decision, and intake artifacts in this workspace.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true, ...summary },
      },
      ...artifacts.map((artifact) => ({
        uri: artifact.resourceUri,
        name: `external_engagement_${resourceNameToken(artifact.fileName)}`,
        title: externalEngagementArtifactTitle(artifact),
        description: "Read one governed external engagement artifact from the workspace resource plane.",
        mimeType: artifact.mimeType,
        annotations: { readOnlyHint: true, ...artifactResourceAnnotations(artifact) },
      })),
    ];
  }

  listTemplates(): readonly ToolResourceTemplateDescriptor[] {
    return [
      {
        uriTemplate: `${EXTERNAL_ENGAGEMENT_RESOURCE_ROOT}/artifacts/{fileName}`,
        name: "external_engagement_artifact",
        title: "External Engagement Artifact",
        description: "Read one workspace external engagement artifact by file name.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
      {
        uriTemplate: `${EXTERNAL_ENGAGEMENT_RESOURCE_ROOT}/evidence/{artifactId}`,
        name: "external_engagement_evidence_artifact",
        title: "External Engagement Evidence Artifact",
        description: "Read one source evidence artifact by provider artifact id from workspace external engagement reports.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
    ];
  }

  async read(uri: string, _options?: ToolResourceReadOptions): Promise<ToolResourceReadResult | undefined> {
    const parsed = parseExternalEngagementResourceUri(uri);
    if (!parsed) {
      return undefined;
    }
    if (parsed.kind === "artifact-index") {
      const artifacts = this.listArtifactMetadata();
      const summary = summarizeArtifacts(artifacts);
      return jsonResource(uri, {
        artifactRoot: this.artifactRoot(),
        summary,
        artifacts,
        evidenceTemplate: `${EXTERNAL_ENGAGEMENT_RESOURCE_ROOT}/evidence/{artifactId}`,
      }, projectResourceReadSummary(summary));
    }
    if (parsed.kind === "artifact-file") {
      const fileName = sanitizeArtifactFileName(parsed.fileName);
      const path = join(this.artifactRoot(), fileName);
      if (!existsSync(path)) {
        return undefined;
      }
      return {
        contents: [{
          uri,
          mimeType: mimeTypeForFile(fileName),
          text: readFileSync(path, "utf-8"),
          _meta: {
            fileName,
            artifactKind: this.readArtifactMetadata(fileName).kind,
          },
        }],
      };
    }
    const artifact = this.findEvidenceArtifact(parsed.artifactId);
    if (!artifact) {
      return undefined;
    }
    return jsonResource(uri, {
      artifact,
      sourceReportResourceUri: artifact.reportResourceUri,
    });
  }

  private artifactRoot(): string {
    return this.artifactRootPath;
  }

  private listArtifactFiles(): readonly string[] {
    const root = this.artifactRoot();
    if (!existsSync(root)) {
      return [];
    }
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter(isSupportedArtifactFile)
      .sort();
  }

  private listArtifactMetadata(): readonly ExternalEngagementArtifactMetadata[] {
    return this.listArtifactFiles().map((fileName) => this.readArtifactMetadata(fileName));
  }

  private readArtifactMetadata(fileName: string): ExternalEngagementArtifactMetadata {
    const path = join(this.artifactRoot(), fileName);
    return buildArtifactMetadata(fileName, path);
  }

  private findEvidenceArtifact(artifactId: string): (ExternalEvidenceArtifact & { readonly reportResourceUri: string }) | undefined {
    for (const fileName of this.listArtifactFiles()) {
      if (this.readArtifactMetadata(fileName).kind !== "evidence-report") {
        continue;
      }
      const report = parseEvidenceReportFile(join(this.artifactRoot(), fileName));
      const artifact = report?.artifacts.find((candidate) => candidate.artifactId === artifactId);
      if (artifact) {
        return {
          ...artifact,
          reportResourceUri: artifactResourceUri(fileName),
        };
      }
    }
    return undefined;
  }
}

function parseExternalEngagementResourceUri(uri: string):
  | { readonly kind: "artifact-index" }
  | { readonly kind: "artifact-file"; readonly fileName: string }
  | { readonly kind: "evidence-artifact"; readonly artifactId: string }
  | undefined {
  if (uri === `${EXTERNAL_ENGAGEMENT_RESOURCE_ROOT}/artifacts`) {
    return { kind: "artifact-index" };
  }
  const artifactPrefix = `${EXTERNAL_ENGAGEMENT_RESOURCE_ROOT}/artifacts/`;
  if (uri.startsWith(artifactPrefix)) {
    return {
      kind: "artifact-file",
      fileName: decodeURIComponent(uri.slice(artifactPrefix.length)),
    };
  }
  const evidencePrefix = `${EXTERNAL_ENGAGEMENT_RESOURCE_ROOT}/evidence/`;
  if (uri.startsWith(evidencePrefix)) {
    const artifactId = decodeURIComponent(uri.slice(evidencePrefix.length)).trim();
    if (!artifactId) {
      return undefined;
    }
    return { kind: "evidence-artifact", artifactId };
  }
  return undefined;
}

function sanitizeArtifactFileName(fileName: string): string {
  const safeName = basename(fileName);
  if (safeName !== fileName || !isSupportedArtifactFile(safeName)) {
    throw new Error(`Unsupported external engagement artifact file: ${fileName}`);
  }
  return safeName;
}

function artifactResourceUri(fileName: string): string {
  return `${EXTERNAL_ENGAGEMENT_RESOURCE_ROOT}/artifacts/${encodeURIComponent(fileName)}`;
}

function isSupportedArtifactFile(fileName: string): boolean {
  const extension = extname(fileName).toLowerCase();
  return extension === ".json" || extension === ".md" || extension === ".txt";
}

function mimeTypeForFile(fileName: string): string {
  const extension = extname(fileName).toLowerCase();
  if (extension === ".json") {
    return JSON_MIME_TYPE;
  }
  if (extension === ".md") {
    return MARKDOWN_MIME_TYPE;
  }
  return TEXT_MIME_TYPE;
}

function buildArtifactMetadata(fileName: string, path: string): ExternalEngagementArtifactMetadata {
  const base = {
    fileName,
    resourceUri: artifactResourceUri(fileName),
    mimeType: mimeTypeForFile(fileName),
  };
  const contentMetadata = readContentMetadata(path, fileName);
  return {
    ...base,
    ...contentMetadata,
  };
}

function readContentMetadata(
  path: string,
  fileName: string,
): Omit<ExternalEngagementArtifactMetadata, "fileName" | "resourceUri" | "mimeType"> {
  const extension = extname(fileName).toLowerCase();
  if (extension === ".md") {
    return { kind: "review-report" };
  }
  if (extension !== ".json") {
    return { kind: "artifact" };
  }
  try {
    const payload = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    return classifyJsonArtifact(payload, fileName);
  } catch {
    return { kind: classifyArtifactFileName(fileName) };
  }
}

function classifyJsonArtifact(
  payload: Record<string, unknown>,
  fileName: string,
): Omit<ExternalEngagementArtifactMetadata, "fileName" | "resourceUri" | "mimeType"> {
  if (payload.source === "x" && Array.isArray(payload.artifacts) && Array.isArray(payload.signals)) {
    return {
      kind: "evidence-report",
      evidenceArtifactCount: payload.artifacts.length,
      signalCount: payload.signals.length,
    };
  }
  if (typeof payload.sourceReportId === "string" && Array.isArray(payload.candidates)) {
    return {
      kind: "candidate-report",
      candidateCount: payload.candidates.length,
    };
  }
  if (typeof payload.sourceCandidateReportId === "string" && Array.isArray(payload.items) && typeof payload.markdown === "string") {
    return {
      kind: "review-report",
      reviewItemCount: payload.items.length,
    };
  }
  if (typeof payload.sourceCandidateReportId === "string" && Array.isArray(payload.decisions)) {
    return {
      kind: "decision-report",
      decisionCount: payload.decisions.length,
    };
  }
  if (typeof payload.sourceDecisionReportId === "string" && Array.isArray(payload.proposals)) {
    return {
      kind: "feature-intake",
      proposalCount: payload.proposals.length,
    };
  }
  return { kind: classifyArtifactFileName(fileName) };
}

function summarizeArtifacts(
  artifacts: readonly ExternalEngagementArtifactMetadata[],
): ExternalEngagementArtifactSummary {
  return {
    artifactCount: artifacts.length,
    evidenceReportCount: countKind(artifacts, "evidence-report"),
    candidateReportCount: countKind(artifacts, "candidate-report"),
    reviewReportCount: countKind(artifacts, "review-report"),
    decisionReportCount: countKind(artifacts, "decision-report"),
    featureIntakeCount: countKind(artifacts, "feature-intake"),
    evidenceArtifactCount: sumMetadata(artifacts, "evidenceArtifactCount"),
    signalCount: sumMetadata(artifacts, "signalCount"),
    candidateCount: sumMetadata(artifacts, "candidateCount"),
    reviewItemCount: sumMetadata(artifacts, "reviewItemCount"),
    decisionCount: sumMetadata(artifacts, "decisionCount"),
    proposalCount: sumMetadata(artifacts, "proposalCount"),
    kinds: [...new Set(artifacts.map((artifact) => artifact.kind))].sort(),
  };
}

function artifactResourceAnnotations(
  artifact: ExternalEngagementArtifactMetadata,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({
      artifactKind: artifact.kind,
      evidenceArtifactCount: artifact.evidenceArtifactCount,
      signalCount: artifact.signalCount,
      candidateCount: artifact.candidateCount,
      reviewItemCount: artifact.reviewItemCount,
      decisionCount: artifact.decisionCount,
      proposalCount: artifact.proposalCount,
    }).filter((entry) => entry[1] !== undefined),
  );
}

function countKind(
  artifacts: readonly ExternalEngagementArtifactMetadata[],
  kind: ExternalEngagementArtifactKind,
): number {
  return artifacts.filter((artifact) => artifact.kind === kind).length;
}

function sumMetadata(
  artifacts: readonly ExternalEngagementArtifactMetadata[],
  key: keyof Pick<
    ExternalEngagementArtifactMetadata,
    "candidateCount" | "decisionCount" | "evidenceArtifactCount" | "proposalCount" | "reviewItemCount" | "signalCount"
  >,
): number {
  return artifacts.reduce((total, artifact) => total + (artifact[key] ?? 0), 0);
}

function classifyArtifactFileName(fileName: string): ExternalEngagementArtifactKind {
  const lower = fileName.toLowerCase();
  if (lower.includes("candidate")) {
    return "candidate-report";
  }
  if (lower.includes("review")) {
    return "review-report";
  }
  if (lower.includes("decision")) {
    return "decision-report";
  }
  if (lower.includes("intake")) {
    return "feature-intake";
  }
  if (lower.includes("report") || lower.includes("search")) {
    return "evidence-report";
  }
  return "artifact";
}

function parseEvidenceReportFile(path: string): ExternalEvidenceReport | undefined {
  try {
    const payload = JSON.parse(readFileSync(path, "utf-8")) as Partial<ExternalEvidenceReport>;
    if (
      typeof payload.reportId !== "string"
      || payload.source !== "x"
      || !Array.isArray(payload.artifacts)
    ) {
      return undefined;
    }
    return payload as ExternalEvidenceReport;
  } catch {
    return undefined;
  }
}

function projectResourceReadSummary(
  summary: ExternalEngagementArtifactSummary,
): ToolResourceReadResult["summary"] {
  return {
    kind: "external-engagement",
    totalCount: summary.artifactCount,
    counts: {
      artifact: summary.artifactCount,
      evidenceReport: summary.evidenceReportCount,
      candidateReport: summary.candidateReportCount,
      reviewReport: summary.reviewReportCount,
      decisionReport: summary.decisionReportCount,
      featureIntake: summary.featureIntakeCount,
      evidenceArtifact: summary.evidenceArtifactCount,
      signal: summary.signalCount,
      candidate: summary.candidateCount,
      reviewItem: summary.reviewItemCount,
      decision: summary.decisionCount,
      proposal: summary.proposalCount,
    },
    facets: {
      artifactKinds: [...summary.kinds],
    },
  };
}

function jsonResource(
  uri: string,
  payload: unknown,
  summary?: ToolResourceReadResult["summary"],
): ToolResourceReadResult {
  return {
    ...(summary ? { summary } : {}),
    contents: [{
      uri,
      mimeType: JSON_MIME_TYPE,
      text: JSON.stringify(payload, null, 2),
    }],
  };
}

function resourceNameToken(fileName: string): string {
  return fileName.toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
}

function externalEngagementArtifactTitle(artifact: ExternalEngagementArtifactMetadata): string {
  return `External Engagement ${artifact.kind.replaceAll("-", " ")}: ${artifact.fileName}`;
}
