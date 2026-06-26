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
const EXTERNAL_ENGAGEMENT_WORKSPACE_DIR = ".kiln/external-engagement";
const JSON_MIME_TYPE = "application/json";
const MARKDOWN_MIME_TYPE = "text/markdown";
const TEXT_MIME_TYPE = "text/plain";

export class ExternalEngagementResourceProvider implements ToolResourceProvider {
  private readonly workspaceDir: string;

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
  }

  listResources(): readonly ToolResourceDescriptor[] {
    return [
      {
        uri: `${EXTERNAL_ENGAGEMENT_RESOURCE_ROOT}/artifacts`,
        name: "external_engagement_artifacts",
        title: "External Engagement Artifacts",
        description: "Read-only index of governed external engagement evidence, candidate, review, decision, and intake artifacts in this workspace.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
      ...this.listArtifactFiles().map((fileName) => ({
        uri: artifactResourceUri(fileName),
        name: `external_engagement_${resourceNameToken(fileName)}`,
        title: externalEngagementArtifactTitle(fileName),
        description: "Read one governed external engagement artifact from the workspace resource plane.",
        mimeType: mimeTypeForFile(fileName),
        annotations: { readOnlyHint: true },
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
      return jsonResource(uri, {
        artifactRoot: this.artifactRoot(),
        artifacts: this.listArtifactFiles().map((fileName) => ({
          fileName,
          resourceUri: artifactResourceUri(fileName),
          mimeType: mimeTypeForFile(fileName),
          kind: classifyArtifactFile(fileName),
        })),
        evidenceTemplate: `${EXTERNAL_ENGAGEMENT_RESOURCE_ROOT}/evidence/{artifactId}`,
      });
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
            artifactKind: classifyArtifactFile(fileName),
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
    return join(this.workspaceDir, EXTERNAL_ENGAGEMENT_WORKSPACE_DIR);
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

  private findEvidenceArtifact(artifactId: string): (ExternalEvidenceArtifact & { readonly reportResourceUri: string }) | undefined {
    for (const fileName of this.listArtifactFiles()) {
      if (classifyArtifactFile(fileName) !== "evidence-report") {
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

function classifyArtifactFile(fileName: string): string {
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

function jsonResource(uri: string, payload: unknown): ToolResourceReadResult {
  return {
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

function externalEngagementArtifactTitle(fileName: string): string {
  return `External Engagement ${classifyArtifactFile(fileName).replaceAll("-", " ")}: ${fileName}`;
}
