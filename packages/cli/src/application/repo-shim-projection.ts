import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import {
  findInstructionProfile,
  loadInstructionProfiles,
  type KilnInstructionDoctrineDefinition,
  type KilnInstructionProfileDefinition,
} from "./instruction-profile-loader.js";
import { loadKilnConfig } from "../config/config-merger.js";
import type { ResolvedKilnConfig } from "../kiln-yaml.js";
import {
  collectProjectContextEvidence,
  readProjectContextAdoption,
  type ProjectContextAdoption,
  type ProjectContextEvidence,
} from "./project-context.js";
import {
  buildWorkflowSnapshotExport,
  type WorkflowSnapshotExport,
} from "./workflow-snapshot-export.js";
import type { ProjectionOutcome } from "../config/native-projection-policy.js";

const GENERATOR_VERSION = "repo-shims-v1";
const SIGNATURE = "kiln:repo-shim:v1";

export type RepoShimKind = "agents" | "claude";

interface RepoShimTarget {
  readonly kind: RepoShimKind;
  readonly filename: string;
  readonly audience: string;
}

export interface RepoShimProjectionTargetResult {
  readonly kind: RepoShimKind;
  readonly path: string;
  readonly written: boolean;
  readonly status: "planned" | "written" | "blocked" | "failed" | "unchanged";
  readonly errors: readonly string[];
}

export interface RepoShimProjectionResult {
  readonly written: boolean;
  readonly targets: readonly RepoShimProjectionTargetResult[];
  readonly workflowSnapshot?: WorkflowSnapshotExport;
  readonly workflowSnapshotProjection?: WorkflowSnapshotProjectionResult;
  readonly workflowSnapshotManifest?: WorkflowSnapshotManifestResult;
  readonly errors: readonly string[];
  readonly outcomes: readonly ProjectionOutcome[];
}

export interface WorkflowSnapshotWriteResult {
  readonly path: string;
  readonly written: boolean;
  readonly status: "planned" | "written" | "failed" | "unchanged";
  readonly errors: readonly string[];
}

export type WorkflowSnapshotProjectionResult = WorkflowSnapshotWriteResult;
export type WorkflowSnapshotManifestResult = WorkflowSnapshotWriteResult;

export interface WorkflowSnapshotManifestStatus {
  readonly path: string;
  readonly status: "missing" | "current" | "stale" | "drifted";
  readonly expectedHash?: string;
  readonly currentHash?: string;
  readonly details?: string;
}

export interface RepoShimProjectionStatus {
  readonly target: RepoShimKind;
  readonly path: string;
  readonly status: "missing" | "current" | "stale" | "drifted" | "unmanaged";
}

export interface RepoShimProjectionOptions {
  readonly force?: boolean;
  readonly dryRun?: boolean;
}

interface ProjectionMetadata {
  readonly target: string;
  readonly contentHash: string;
}

interface SignedProjection {
  readonly metadata: ProjectionMetadata;
  readonly body: string;
}

interface RepoShimProjectionContext {
  readonly projectPath: string;
  readonly instructionProfiles: readonly KilnInstructionProfileDefinition[];
  readonly kilnYaml: ResolvedKilnConfig | null;
  readonly repoContext: ProjectContextEvidence;
  readonly adoptedProjectContext: ProjectContextAdoption | null;
  readonly sourceProfiles: readonly string[];
  readonly projectRootId: string;
}

const TARGETS: readonly RepoShimTarget[] = [
  {
    kind: "agents",
    filename: "AGENTS.md",
    audience: "Codex CLI and OpenCode",
  },
  {
    kind: "claude",
    filename: "CLAUDE.md",
    audience: "Claude Code",
  },
];
const WORKFLOW_SNAPSHOT_MARKDOWN_FILE = ".kiln/projections/workflow-snapshot.md";

export async function writeRepoShimProjections(
  projectPath: string,
  options: RepoShimProjectionOptions = {},
): Promise<RepoShimProjectionResult> {
  const results: RepoShimProjectionTargetResult[] = [];
  let context: RepoShimProjectionContext;
  let workflowSnapshot: WorkflowSnapshotExport;
  let workflowSnapshotProjection: WorkflowSnapshotProjectionResult | undefined;
  let workflowSnapshotManifest: WorkflowSnapshotManifestResult | undefined;

  try {
    context = await loadRepoShimProjectionContext(projectPath);
    workflowSnapshot = buildWorkflowSnapshot(context, new Date().toISOString());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      written: false,
      targets: [],
      errors: [message],
      outcomes: [{ targetId: "repo-shims", path: projectPath, status: "failed", reason: message }],
    };
  }

  for (const target of TARGETS) {
    try {
      results.push(writeRepoShimTarget({
        ...context,
        target,
        force: options.force ?? false,
        dryRun: options.dryRun ?? false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push(repoShimTargetResult(target, join(projectPath, target.filename), "failed", [message]));
    }
  }

  const shimErrors = results.flatMap((result) => [...result.errors]);
  if (shimErrors.length === 0) {
    workflowSnapshotProjection = captureWorkflowSnapshotWrite(
      workflowSnapshotMarkdownPath(projectPath),
      () => writeWorkflowSnapshotProjection(projectPath, workflowSnapshot, options.dryRun ?? false),
    );
    workflowSnapshotManifest = captureWorkflowSnapshotWrite(
      workflowSnapshotManifestPath(projectPath),
      () => writeWorkflowSnapshotManifest(projectPath, workflowSnapshot, options.dryRun ?? false),
    );
  }
  const errors = [
    ...shimErrors,
    ...(workflowSnapshotProjection?.errors ?? []),
    ...(workflowSnapshotManifest?.errors ?? []),
  ];
  const outcomes: ProjectionOutcome[] = [
    ...results.map((result) => ({
      targetId: `repo-shim:${result.kind}`,
      path: result.path,
      status: result.status,
      ...(result.errors[0] ? { reason: result.errors[0] } : {}),
    })),
    ...(workflowSnapshotProjection ? [{
      targetId: "workflow-snapshot",
      path: workflowSnapshotProjection.path,
      status: workflowSnapshotProjection.status,
      ...(workflowSnapshotProjection.errors[0] ? { reason: workflowSnapshotProjection.errors[0] } : {}),
    } satisfies ProjectionOutcome] : [{
      targetId: "workflow-snapshot",
      path: workflowSnapshotMarkdownPath(projectPath),
      status: "skipped",
      reason: `repo shim projection did not complete: ${shimErrors[0]}`,
    } satisfies ProjectionOutcome]),
    ...(workflowSnapshotManifest ? [{
      targetId: "workflow-snapshot-manifest",
      path: workflowSnapshotManifest.path,
      status: workflowSnapshotManifest.status,
      ...(workflowSnapshotManifest.errors[0] ? { reason: workflowSnapshotManifest.errors[0] } : {}),
    } satisfies ProjectionOutcome] : [{
      targetId: "workflow-snapshot-manifest",
      path: workflowSnapshotManifestPath(projectPath),
      status: "skipped",
      reason: `repo shim projection did not complete: ${shimErrors[0]}`,
    } satisfies ProjectionOutcome]),
  ];
  return {
    written: errors.length === 0 && (
      results.some((result) => result.written)
        || (workflowSnapshotProjection?.written ?? false)
        || (workflowSnapshotManifest?.written ?? false)
    ),
    targets: results,
    workflowSnapshot,
    workflowSnapshotProjection,
    workflowSnapshotManifest,
    errors,
    outcomes,
  };
}

export async function readRepoShimProjectionStatuses(projectPath: string): Promise<readonly RepoShimProjectionStatus[]> {
  const context = await loadRepoShimProjectionContext(projectPath);

  return TARGETS.map((target) => {
    const path = join(projectPath, target.filename);
    const expected = renderSignedRepoShimProjection({ ...context, target });

    if (!existsSync(path)) {
      return { target: target.kind, path, status: "missing" };
    }

    const existing = readFileSync(path, "utf-8");
    const existingState = classifyExistingProjection(existing, target.kind);
    if (existingState === "unmanaged" || existingState === "drifted") {
      return { target: target.kind, path, status: existingState };
    }

    return {
      target: target.kind,
      path,
      status: existing === expected ? "current" : "stale",
    };
  });
}

export async function readWorkflowSnapshotManifestStatus(projectPath: string): Promise<WorkflowSnapshotManifestStatus> {
  const manifestPath = workflowSnapshotManifestPath(projectPath);
  if (!existsSync(manifestPath)) {
    return { path: manifestPath, status: "missing" };
  }

  const content = readFileSync(manifestPath, "utf-8");
  const currentHash = readManifestHash(content);
  if (!currentHash) {
    return {
      path: manifestPath,
      status: "drifted",
      details: "workflow snapshot manifest is not valid JSON",
    };
  }

  const expected = await buildCurrentWorkflowSnapshot(projectPath);
  const expectedHash = expected.manifest.hash;
  if (currentHash !== expectedHash) {
    return {
      path: manifestPath,
      status: "stale",
      expectedHash,
      currentHash,
      details: `workflow snapshot manifest hash is stale: expected ${expectedHash}, found ${currentHash}`,
    };
  }

  return {
    path: manifestPath,
    status: "current",
    expectedHash,
    currentHash,
  };
}

async function loadRepoShimProjectionContext(projectPath: string): Promise<RepoShimProjectionContext> {
  const instructionProfiles = loadInstructionProfiles(projectPath);
  const kilnYaml = await loadKilnConfig(projectPath);
  const repoContext = collectProjectContextEvidence(projectPath);
  return {
    projectPath,
    instructionProfiles,
    kilnYaml,
    repoContext,
    adoptedProjectContext: readProjectContextAdoption(projectPath),
    sourceProfiles: kilnYaml?.activeInstructionProfiles ?? [],
    projectRootId: repoRootIdentity(repoContext),
  };
}

function repoRootIdentity(repoContext: ProjectContextEvidence): string {
  return hashText(repoContext.projectName.toLowerCase()).slice(0, 16);
}

function writeRepoShimTarget(input: {
  readonly projectPath: string;
  readonly target: RepoShimTarget;
  readonly instructionProfiles: readonly KilnInstructionProfileDefinition[];
  readonly kilnYaml: ResolvedKilnConfig | null;
  readonly repoContext: ProjectContextEvidence;
  readonly adoptedProjectContext: ProjectContextAdoption | null;
  readonly sourceProfiles: readonly string[];
  readonly projectRootId: string;
  readonly force: boolean;
  readonly dryRun: boolean;
}): RepoShimProjectionTargetResult {
  const targetPath = join(input.projectPath, input.target.filename);
  const content = renderSignedRepoShimProjection(input);
  const existing = existsSync(targetPath) ? readFileSync(targetPath, "utf-8") : null;
  const existingState = existing ? classifyExistingProjection(existing, input.target.kind) : "missing";

  if (existingState === "unmanaged" && !input.force) {
    return repoShimTargetResult(input.target, targetPath, "blocked", [
      `${input.target.filename}: unmanaged guidance file exists; adopt or back up before generating repo shims`,
    ]);
  }

  if (existingState === "drifted" && !input.force) {
    return repoShimTargetResult(input.target, targetPath, "blocked", [
      `${input.target.filename}: managed repo shim drift detected; rerun with --force after reviewing changes`,
    ]);
  }

  if (existing === content) {
    return repoShimTargetResult(input.target, targetPath, "unchanged");
  }

  if (input.dryRun) {
    return repoShimTargetResult(input.target, targetPath, "planned");
  }

  if (existing && input.force) {
    backupExistingShim(input.projectPath, input.target.filename, existing);
  }

  writeFileSync(targetPath, content, "utf-8");
  return repoShimTargetResult(input.target, targetPath, "written");
}

function renderSignedRepoShimProjection(input: RepoShimProjectionContext & { readonly target: RepoShimTarget }): string {
  const body = renderRepoShimBody(input);
  return renderSignedProjection({
    body,
    target: input.target,
    sourceProfiles: input.sourceProfiles,
    projectRootId: input.projectRootId,
    projectName: input.repoContext.projectName,
  });
}

function repoShimTargetResult(
  target: RepoShimTarget,
  path: string,
  status: RepoShimProjectionTargetResult["status"],
  errors: readonly string[] = [],
): RepoShimProjectionTargetResult {
  return {
    kind: target.kind,
    path,
    written: status === "written",
    status,
    errors,
  };
}

function renderRepoShimBody(input: {
  readonly projectPath: string;
  readonly target: RepoShimTarget;
  readonly instructionProfiles: readonly KilnInstructionProfileDefinition[];
  readonly kilnYaml: ResolvedKilnConfig | null;
  readonly repoContext: ProjectContextEvidence;
  readonly adoptedProjectContext: ProjectContextAdoption | null;
}): string {
  return [
    ...renderRepoShimHeader(input.target),
    ...renderProjectSection(input.repoContext, input.kilnYaml),
    ...renderRepositoryEvidenceSections(input.repoContext),
    ...renderAdoptedProjectContextSection(input.adoptedProjectContext),
    ...renderActiveInstructionProfilesSection(input),
    ...renderWorkGovernanceSection(input.kilnYaml),
    ...renderUsageSection(),
  ].join("\n");
}

function renderRepoShimHeader(target: RepoShimTarget): readonly string[] {
  return [
    target.kind === "claude" ? "# Claude Project Guidance" : "# Agents",
    "",
    `> Generated by kiln sync --repo-shims for ${target.audience}. Do not edit manually.`,
    "",
  ];
}

function renderProjectSection(repoContext: ProjectContextEvidence, kilnYaml: ResolvedKilnConfig | null): readonly string[] {
  return [
    "## Project",
    "",
    `- Name: ${repoContext.projectName}`,
    `- Domain: ${kilnYaml?.domain ?? "default"}`,
    `- Default provider: ${kilnYaml?.provider ?? "provider default"}`,
    `- Default model: ${kilnYaml?.model?.default ?? "provider default"}`,
    `- Max depth: ${String(kilnYaml?.maxDepth ?? 3)}`,
    `- Parallel workers: ${String(kilnYaml?.parallelWorkers ?? 1)}`,
    "",
  ];
}

function renderRepositoryEvidenceSections(
  repoContext: ProjectContextEvidence,
): readonly string[] {
  return [
    ...renderRepositoryEvidenceSection(repoContext),
    ...renderCanonicalProjectReferencesSection(repoContext),
  ];
}

function renderRepositoryEvidenceSection(repoContext: ProjectContextEvidence): readonly string[] {
  if (!repoContext.packageManager && repoContext.scripts.length === 0 && repoContext.workspacePackages.length === 0) {
    return [];
  }
  return [
    "## Repository Evidence",
    "",
    ...(repoContext.packageManager ? [`- Package manager: ${repoContext.packageManager}`] : []),
    ...repoContext.scripts.map(([name, command]) => `- Script \`${name}\`: \`${command}\``),
    ...repoContext.workspacePackages.map((workspacePackage) => `- Workspace package: \`${workspacePackage}\``),
    "",
  ];
}

function renderCanonicalProjectReferencesSection(repoContext: ProjectContextEvidence): readonly string[] {
  if (repoContext.docs.length === 0) {
    return [];
  }
  return [
    "## Canonical Project References",
    "",
    ...repoContext.docs.map((doc) => `- ${doc}`),
    "",
  ];
}

function renderAdoptedProjectContextSection(adoptedProjectContext: ProjectContextAdoption | null): readonly string[] {
  if (!adoptedProjectContext?.reviewNotes) {
    return [];
  }
  return [
    "## Adopted Project Context",
    "",
    "Canonical source: `.kiln/project-context.md`.",
    "",
    adoptedProjectContext.reviewNotes,
    "",
  ];
}

function renderActiveInstructionProfilesSection(input: {
  readonly projectPath: string;
  readonly instructionProfiles: readonly KilnInstructionProfileDefinition[];
  readonly kilnYaml: ResolvedKilnConfig | null;
}): readonly string[] {
  const activeProfiles = input.kilnYaml?.activeInstructionProfiles ?? [];
  if (activeProfiles.length === 0) {
    return [];
  }
  return [
    "## Active Instruction Profiles",
    "",
    "Read these canonical Kiln instruction profiles before work. They are the source of durable operator/team doctrine; this file is only a projection.",
    "",
    ...activeProfiles.map((profileId) => renderInstructionProfileLine(
      profileId,
      input.instructionProfiles,
      input.projectPath,
    )),
    "",
  ];
}

function renderInstructionProfileLine(
  profileId: string,
  instructionProfiles: readonly KilnInstructionProfileDefinition[],
  projectPath: string,
): string {
  const profile = findInstructionProfile(instructionProfiles, profileId);
  return profile
    ? `- ${profile.name} (${profile.scope}): ${formatProfilePath(profile, projectPath)}${formatDoctrineSummary(profile.doctrine)}`
    : `- ${profileId} (missing; create the canonical Kiln instruction profile before relying on this shim)`;
}

function renderWorkGovernanceSection(kilnYaml: ResolvedKilnConfig | null): readonly string[] {
  const workGovernance = kilnYaml?.workGovernance;
  if (!workGovernance) {
    return [];
  }
  return [
    "## Work Governance",
    "",
    "Direct execution is the baseline. Follow resolved Kiln work-governance evidence when a configured trigger requires coordination.",
    ...[
      workGovernance.defaultPosture ? `- Default posture: ${workGovernance.defaultPosture}` : undefined,
      workGovernance.requireDelegationFor && workGovernance.requireDelegationFor.length > 0
        ? `- Orchestrate/delegate for: ${workGovernance.requireDelegationFor.join(", ")}`
        : undefined,
      workGovernance.requiredEvidence && workGovernance.requiredEvidence.length > 0
        ? `- Evidence before done: ${workGovernance.requiredEvidence.join(", ")}`
        : undefined,
    ].filter((line): line is string => line !== undefined),
    "- Projection is not authority: if required delegation, review, approval, or tool capability is unavailable in this harness, do not simulate it or create project memory workarounds.",
    "- Record missing harness/tool/route capability as a `capability` pause requirement, continue locally only when the required evidence gates can still be satisfied, or ask the operator for explicit authorization.",
    "",
  ];
}

function renderUsageSection(): readonly string[] {
  return [
    "## Usage",
    "",
    "Use canonical Kiln profiles, instruction profiles, and skills as the source of truth.",
    "Do not add durable workflow doctrine directly to this generated file.",
    "Update Kiln config and rerun `kiln sync --repo-shims` instead.",
    "",
  ];
}

function formatProfilePath(profile: KilnInstructionProfileDefinition, projectPath: string): string {
  const normalizedPath = profile.filePath.replace(/\\/g, "/");
  const globalMarker = "/.kiln/instructions/";
  const globalIndex = normalizedPath.indexOf(globalMarker);
  if (profile.scope === "global" && globalIndex >= 0) {
    return `~/.kiln/instructions/${normalizedPath.slice(globalIndex + globalMarker.length)}`;
  }

  const relativePath = relative(projectPath, profile.filePath).replace(/\\/g, "/");
  if (!relativePath.startsWith("..") && !relativePath.startsWith("/") && !/^[A-Za-z]:/.test(relativePath)) {
    return relativePath;
  }

  return normalizedPath;
}

function renderSignedProjection(input: {
  readonly body: string;
  readonly target: RepoShimTarget;
  readonly sourceProfiles: readonly string[];
  readonly projectRootId: string;
  readonly projectName: string;
}): string {
  const contentHash = hashText(input.body);
  return [
    "<!--",
    SIGNATURE,
    `target: ${input.target.kind}`,
    `projectName: ${input.projectName}`,
    `projectRootId: sha256:${input.projectRootId}`,
    `sourceProfiles: ${input.sourceProfiles.length > 0 ? input.sourceProfiles.join(",") : "-"}`,
    `generator: ${GENERATOR_VERSION}`,
    `contentHash: sha256:${contentHash}`,
    "-->",
    input.body,
  ].join("\n");
}

function classifyExistingProjection(content: string, expectedTarget: RepoShimKind): "managed" | "drifted" | "unmanaged" {
  const signedProjection = readSignedProjection(content);
  if (!signedProjection || signedProjection.metadata.target !== expectedTarget) {
    return "unmanaged";
  }

  return signedProjection.metadata.contentHash === `sha256:${hashText(signedProjection.body)}`
    ? "managed"
    : "drifted";
}

function readSignedProjection(content: string): SignedProjection | null {
  const metadata = readProjectionMetadata(content);
  if (!metadata) {
    return null;
  }
  return {
    metadata,
    body: projectionBody(content),
  };
}

function readProjectionMetadata(content: string): ProjectionMetadata | null {
  const end = content.indexOf("-->");
  if (!content.startsWith("<!--") || end === -1) {
    return null;
  }

  const lines = content.slice(4, end).split(/\r?\n/).map((line) => line.trim());
  if (!lines.includes(SIGNATURE)) {
    return null;
  }

  const values = new Map<string, string>();
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator > 0) {
      values.set(line.slice(0, separator), line.slice(separator + 1).trim());
    }
  }

  const target = values.get("target");
  const contentHash = values.get("contentHash");
  if (!target || !contentHash) {
    return null;
  }
  return { target, contentHash };
}

function projectionBody(content: string): string {
  return content.slice(content.indexOf("-->") + 3).replace(/^\r?\n/, "");
}

function backupExistingShim(projectPath: string, filename: string, content: string): void {
  const backupDir = join(projectPath, ".kiln", "backups", "repo-shims");
  mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(join(backupDir, `${filename}.${timestamp}.bak`), content, "utf-8");
}

function writeWorkflowSnapshotManifest(
  projectPath: string,
  workflowSnapshot: WorkflowSnapshotExport,
  dryRun: boolean,
): WorkflowSnapshotManifestResult {
  const manifestPath = workflowSnapshotManifestPath(projectPath);
  const existing = existsSync(manifestPath) ? readFileSync(manifestPath, "utf-8") : null;
  const existingHash = existing ? readManifestHash(existing) : null;

  if (existingHash === workflowSnapshot.manifest.hash) {
    return workflowSnapshotResult(manifestPath, false);
  }

  if (dryRun) return workflowSnapshotResult(manifestPath, false, true);

  ensureWorkflowProjectionDir(projectPath);
  writeFileSync(manifestPath, `${JSON.stringify(workflowSnapshot.manifest, null, 2)}\n`, "utf-8");
  return workflowSnapshotResult(manifestPath, true);
}

function workflowSnapshotManifestPath(projectPath: string): string {
  return join(projectPath, ".kiln", "projections", "workflow-snapshot-manifest.json");
}

function readManifestHash(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { hash?: unknown };
    return typeof parsed.hash === "string" ? parsed.hash : null;
  } catch {
    return null;
  }
}

async function buildCurrentWorkflowSnapshot(projectPath: string): Promise<WorkflowSnapshotExport> {
  const context = await loadRepoShimProjectionContext(projectPath);
  return buildWorkflowSnapshot(context, new Date().toISOString());
}

function buildWorkflowSnapshot(
  context: Pick<RepoShimProjectionContext, "repoContext" | "instructionProfiles" | "kilnYaml">,
  generatedAt: string,
): WorkflowSnapshotExport {
  return buildWorkflowSnapshotExport({
    generatedAt,
    generatedFiles: workflowSnapshotGeneratedFiles(),
    projectContext: context.repoContext,
    instructionProfiles: context.instructionProfiles,
    kilnConfig: context.kilnYaml,
  });
}

function workflowSnapshotGeneratedFiles(): readonly string[] {
  return [
    ...TARGETS.map((target) => target.filename),
    WORKFLOW_SNAPSHOT_MARKDOWN_FILE,
  ];
}

function writeWorkflowSnapshotProjection(
  projectPath: string,
  workflowSnapshot: WorkflowSnapshotExport,
  dryRun: boolean,
): WorkflowSnapshotProjectionResult {
  const snapshotPath = workflowSnapshotMarkdownPath(projectPath);
  const content = renderWorkflowSnapshotMarkdown(workflowSnapshot);
  const existing = existsSync(snapshotPath) ? readFileSync(snapshotPath, "utf-8") : null;

  if (existing === content) {
    return workflowSnapshotResult(snapshotPath, false);
  }

  if (dryRun) return workflowSnapshotResult(snapshotPath, false, true);

  ensureWorkflowProjectionDir(projectPath);
  writeFileSync(snapshotPath, content, "utf-8");
  return workflowSnapshotResult(snapshotPath, true);
}

function workflowSnapshotMarkdownPath(projectPath: string): string {
  return join(projectPath, WORKFLOW_SNAPSHOT_MARKDOWN_FILE);
}

function ensureWorkflowProjectionDir(projectPath: string): void {
  mkdirSync(join(projectPath, ".kiln", "projections"), { recursive: true });
}

function captureWorkflowSnapshotWrite(
  path: string,
  operation: () => WorkflowSnapshotWriteResult,
): WorkflowSnapshotWriteResult {
  try {
    return operation();
  } catch (error) {
    return workflowSnapshotResult(path, false, false, [error instanceof Error ? error.message : String(error)]);
  }
}

function workflowSnapshotResult(
  path: string,
  written: boolean,
  planned = false,
  errors: readonly string[] = [],
): WorkflowSnapshotWriteResult {
  return {
    path,
    written,
    status: errors.length > 0 ? "failed" : planned ? "planned" : written ? "written" : "unchanged",
    errors,
  };
}

function renderWorkflowSnapshotMarkdown(workflowSnapshot: WorkflowSnapshotExport): string {
  const body = renderWorkflowSnapshotBody(workflowSnapshot);
  return [
    "<!--",
    "kiln:workflow-snapshot:v1",
    `generator: ${workflowSnapshot.manifest.generator}`,
    `contentHash: sha256:${hashText(body)}`,
    "-->",
    body,
  ].join("\n");
}

function renderWorkflowSnapshotBody(workflowSnapshot: WorkflowSnapshotExport): string {
  return [
    "# Kiln Workflow Snapshot",
    "",
    "> Generated by kiln sync --repo-shims from canonical Kiln workflow evidence. Do not edit manually.",
    "",
    ...renderWorkflowSnapshotManifestSection(workflowSnapshot),
    ...renderWorkflowSnapshotSpecificationSection(workflowSnapshot),
    ...renderWorkflowSnapshotPlanSection(workflowSnapshot),
    ...renderWorkflowSnapshotAuthoritySection(workflowSnapshot),
    ...renderWorkflowSnapshotModelPolicySection(workflowSnapshot),
    ...renderWorkflowSnapshotWorkItemsSection(workflowSnapshot),
    ...renderWorkflowSnapshotInstructionProfilesSection(workflowSnapshot),
  ].join("\n");
}

function renderWorkflowSnapshotManifestSection(workflowSnapshot: WorkflowSnapshotExport): readonly string[] {
  return [
    "## Manifest",
    "",
    `- Hash: ${workflowSnapshot.manifest.hash}`,
    `- Sources: ${workflowSnapshot.manifest.sourceIds.join(", ")}`,
    `- Generated files: ${workflowSnapshot.manifest.generatedFiles.join(", ")}`,
    "",
  ];
}

function renderWorkflowSnapshotSpecificationSection(workflowSnapshot: WorkflowSnapshotExport): readonly string[] {
  return [
    "## Specification",
    "",
    `- Project: ${workflowSnapshot.specification.projectName}`,
    `- Package manager: ${workflowSnapshot.specification.packageManager ?? "unknown"}`,
    `- Workspaces: ${formatSnapshotList(workflowSnapshot.specification.workspacePackages)}`,
    `- Canonical docs: ${formatSnapshotList(workflowSnapshot.specification.canonicalDocs)}`,
    "",
  ];
}

function renderWorkflowSnapshotPlanSection(workflowSnapshot: WorkflowSnapshotExport): readonly string[] {
  return [
    "## Plan",
    "",
    `- Default posture: ${workflowSnapshot.plan.defaultPosture ?? "unspecified"}`,
    `- Orchestration triggers: ${formatSnapshotList(workflowSnapshot.plan.orchestrationTriggers)}`,
    `- Evidence before done: ${formatSnapshotList(workflowSnapshot.plan.evidenceBeforeDone)}`,
    "",
  ];
}

function renderWorkflowSnapshotAuthoritySection(workflowSnapshot: WorkflowSnapshotExport): readonly string[] {
  return [
    "## Authority",
    "",
    `- Default posture: ${workflowSnapshot.authorityPosture.defaultPosture ?? "unspecified"}`,
    "",
  ];
}

function renderWorkflowSnapshotModelPolicySection(workflowSnapshot: WorkflowSnapshotExport): readonly string[] {
  return [
    "## Model Policy",
    "",
    `- Default provider: ${workflowSnapshot.modelPolicyGuidance.defaultProvider ?? "provider default"}`,
    `- Default model: ${workflowSnapshot.modelPolicyGuidance.defaultModel ?? "provider default"}`,
    `- Max depth: ${workflowSnapshot.modelPolicyGuidance.maxDepth ?? "unspecified"}`,
    `- Parallel workers: ${workflowSnapshot.modelPolicyGuidance.parallelWorkers ?? "unspecified"}`,
    "",
  ];
}

function renderWorkflowSnapshotWorkItemsSection(workflowSnapshot: WorkflowSnapshotExport): readonly string[] {
  return [
    "## Work Item Profiles",
    "",
    "| Profile | Risk | Evidence | Gates |",
    "|---------|------|----------|-------|",
    ...workflowSnapshot.workItems.map((profile) =>
      `| ${profile.id} | ${profile.minimumRisk} | ${formatSnapshotList(profile.requiredEvidence)} | ${formatSnapshotList(profile.verificationGates)} |`),
    "",
  ];
}

function renderWorkflowSnapshotInstructionProfilesSection(workflowSnapshot: WorkflowSnapshotExport): readonly string[] {
  return [
    "## Instruction Profiles",
    "",
    ...(
      workflowSnapshot.instructionProfiles.length > 0
        ? workflowSnapshot.instructionProfiles.map((profile) =>
          `- ${profile.id} (${profile.scope}): ${profile.sourcePath}${profile.doctrineFacets.length > 0 ? ` - ${profile.doctrineFacets.join(", ")}` : ""}`)
        : ["- none"]
    ),
    "",
  ];
}

function formatSnapshotList(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function formatDoctrineSummary(doctrine: KilnInstructionDoctrineDefinition | undefined): string {
  if (!doctrine) {
    return "";
  }

  const facets = [
    doctrine.principles && doctrine.principles.length > 0 ? "principles" : undefined,
    doctrine.workflow && doctrine.workflow.length > 0 ? "workflow" : undefined,
    doctrine.qualityGates && doctrine.qualityGates.length > 0 ? "quality gates" : undefined,
    doctrine.reviewPosture && doctrine.reviewPosture.length > 0 ? "review posture" : undefined,
    doctrine.delegation && doctrine.delegation.length > 0 ? "delegation" : undefined,
    doctrine.executionDiscipline && doctrine.executionDiscipline.length > 0
      ? "execution discipline"
      : undefined,
  ].filter((facet): facet is string => facet !== undefined);

  return facets.length > 0 ? ` - doctrine: ${facets.join(", ")}` : "";
}
