import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";

import type { ProjectionOutcome } from "../config/native-projection-policy.js";
import { loadKilnConfig } from "../config/config-merger.js";
import type { ResolvedKilnConfig } from "../kiln-yaml.js";
import {
  assertPrivateStateDirectoryTargetSync,
  assertPrivateStateFileTargetSync,
  ensurePrivateStateDirectorySync,
} from "./private-project-state-filesystem.js";
import {
  collectProjectContextEvidence,
  type ProjectContextEvidence,
} from "./project-context.js";
import { loadInstructionProfiles, type KilnInstructionProfileDefinition } from "./instruction-profile-loader.js";
import { resolveProjectRoot } from "./project-root-resolver.js";
import {
  resolveProjectStateBinding,
  type ProjectStateBinding,
  type ProjectStateRootOptions,
} from "./project-state-root.js";
import {
  buildWorkflowSnapshotExport,
  type WorkflowSnapshotExport,
  type WorkflowSnapshotManifest,
} from "./workflow-snapshot-export.js";

const WORKFLOW_SNAPSHOT_MARKDOWN_FILE = "private:projections/workflow-snapshot.md";
const WORKFLOW_SNAPSHOT_TARGET_ID = "workflow-snapshot";
const WORKFLOW_SNAPSHOT_MANIFEST_TARGET_ID = "workflow-snapshot-manifest";
// The private projection is a content-addressed cache, not an event log. A
// stable timestamp keeps identical canonical inputs byte-identical across
// invocations and makes generatedAt part of the verifiable manifest contract.
const WORKFLOW_SNAPSHOT_GENERATED_AT = "1970-01-01T00:00:00.000Z";

export interface WorkflowSnapshotWriteResult {
  readonly path: string;
  readonly written: boolean;
  readonly status: "planned" | "written" | "failed" | "unchanged";
  readonly errors: readonly string[];
}

export interface WorkflowSnapshotProjectionResult {
  readonly written: boolean;
  readonly workflowSnapshot?: WorkflowSnapshotExport;
  readonly workflowSnapshotProjection?: WorkflowSnapshotWriteResult;
  readonly workflowSnapshotManifest?: WorkflowSnapshotWriteResult;
  readonly errors: readonly string[];
  readonly outcomes: readonly ProjectionOutcome[];
}

export interface WorkflowSnapshotProjectionOptions extends ProjectStateRootOptions {
  readonly projectStateBinding?: ProjectStateBinding;
  readonly dryRun?: boolean;
}

export type WorkflowSnapshotProjectionReadOptions = Pick<
  WorkflowSnapshotProjectionOptions,
  "kilnHome" | "platform" | "projectStateBinding"
>;

export interface WorkflowSnapshotManifestStatus {
  readonly path: string;
  readonly status: "missing" | "current" | "stale" | "drifted";
  readonly expectedHash?: string;
  readonly currentHash?: string;
  readonly details?: string;
}

interface WorkflowSnapshotProjectionContext {
  readonly projectPath: string;
  readonly projectStateBinding: ProjectStateBinding;
  readonly instructionProfiles: readonly KilnInstructionProfileDefinition[];
  readonly kilnYaml: ResolvedKilnConfig | null;
  readonly repoContext: ProjectContextEvidence;
}

/**
 * Materialize the private workflow snapshot and its manifest. Repository
 * instruction files are deliberately not read or written here; they are an
 * independent project-owned surface inspected by project-instruction-status.
 */
export async function syncWorkflowSnapshotProjection(
  projectPath: string,
  options: WorkflowSnapshotProjectionOptions = {},
): Promise<WorkflowSnapshotProjectionResult> {
  let context: WorkflowSnapshotProjectionContext;
  let workflowSnapshot: WorkflowSnapshotExport;

  try {
    context = await loadWorkflowSnapshotProjectionContext(projectPath, options);
    workflowSnapshot = buildWorkflowSnapshot(context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return projectionFailure(projectPath, options, message);
  }

  const projectionPath = workflowSnapshotMarkdownPath(context.projectStateBinding);
  const manifestPath = workflowSnapshotManifestPath(context.projectStateBinding);
  const workflowSnapshotProjection = captureWorkflowSnapshotWrite(
    projectionPath,
    () => writeWorkflowSnapshotProjection(
      context.projectStateBinding,
      workflowSnapshot,
      options.dryRun ?? false,
    ),
  );
  const workflowSnapshotManifest = captureWorkflowSnapshotWrite(
    manifestPath,
    () => writeWorkflowSnapshotManifest(
      context.projectStateBinding,
      workflowSnapshot,
      options.dryRun ?? false,
    ),
  );
  const errors = [
    ...workflowSnapshotProjection.errors,
    ...workflowSnapshotManifest.errors,
  ];

  return {
    written: errors.length === 0 && (
      workflowSnapshotProjection.written || workflowSnapshotManifest.written
    ),
    workflowSnapshot,
    workflowSnapshotProjection,
    workflowSnapshotManifest,
    errors,
    outcomes: [
      toProjectionOutcome(
        WORKFLOW_SNAPSHOT_TARGET_ID,
        workflowSnapshotProjection,
      ),
      toProjectionOutcome(
        WORKFLOW_SNAPSHOT_MANIFEST_TARGET_ID,
        workflowSnapshotManifest,
      ),
    ],
  };
}

export async function readWorkflowSnapshotManifestStatus(
  projectPath: string,
  options: WorkflowSnapshotProjectionReadOptions = {},
): Promise<WorkflowSnapshotManifestStatus> {
  const binding = projectBinding(projectPath, options);
  assertWorkflowSnapshotRepositoryRootSync(binding);
  const manifestPath = workflowSnapshotManifestPath(binding);
  const content = readPrivateStateFileIfPresent(binding, manifestPath);
  if (content === null) {
    return { path: manifestPath, status: "missing" };
  }

  const currentManifest = readWorkflowSnapshotManifest(content);
  const currentHash = currentManifest ? readWorkflowSnapshotManifestHash(currentManifest) : null;
  if (!currentManifest || !currentHash) {
    return {
      path: manifestPath,
      status: "drifted",
      details: "workflow snapshot manifest is not valid JSON",
    };
  }

  const expected = await buildCurrentWorkflowSnapshot(projectPath, binding);
  const snapshotPath = workflowSnapshotMarkdownPath(binding);
  const currentSnapshot = readPrivateStateFileIfPresent(binding, snapshotPath);
  if (currentSnapshot === null) {
    return {
      path: manifestPath,
      status: "missing",
      expectedHash: expected.manifest.hash,
      currentHash,
      details: "workflow snapshot markdown is missing",
    };
  }

  const expectedSnapshot = renderWorkflowSnapshotMarkdown(expected);
  if (currentSnapshot !== expectedSnapshot) {
    const currentSnapshotHash = readWorkflowSnapshotContentHash(currentSnapshot);
    const details = currentSnapshotHash === null
      ? "workflow snapshot markdown content hash is invalid"
      : `workflow snapshot markdown is stale: expected ${hashText(renderWorkflowSnapshotBody(expected))}, found ${currentSnapshotHash}`;
    return {
      path: manifestPath,
      status: currentSnapshotHash === null ? "drifted" : "stale",
      expectedHash: expected.manifest.hash,
      currentHash,
      details,
    };
  }

  const expectedHash = expected.manifest.hash;
  if (!workflowSnapshotManifestsEqual(currentManifest, expected.manifest)) {
    return {
      path: manifestPath,
      status: "stale",
      expectedHash,
      currentHash,
      details: currentHash === expectedHash
        ? "workflow snapshot manifest metadata is stale"
        : `workflow snapshot manifest hash is stale: expected ${expectedHash}, found ${currentHash}`,
    };
  }

  return {
    path: manifestPath,
    status: "current",
    expectedHash,
    currentHash,
  };
}

async function loadWorkflowSnapshotProjectionContext(
  projectPath: string,
  options: WorkflowSnapshotProjectionReadOptions,
): Promise<WorkflowSnapshotProjectionContext> {
  const projectStateBinding = projectBinding(projectPath, options);
  assertWorkflowSnapshotRepositoryRootSync(projectStateBinding);
  const rootPath = projectStateBinding.canonicalRoot;
  const instructionProfiles = loadInstructionProfiles(rootPath, undefined, { projectStateBinding });
  const kilnYaml = await loadKilnConfig(rootPath, { projectStateBinding });
  const repoContext = collectProjectContextEvidence(rootPath);
  return {
    projectPath: rootPath,
    projectStateBinding,
    instructionProfiles,
    kilnYaml,
    repoContext,
  };
}

async function buildCurrentWorkflowSnapshot(
  projectPath: string,
  binding: ProjectStateBinding,
): Promise<WorkflowSnapshotExport> {
  const context = await loadWorkflowSnapshotProjectionContext(projectPath, { projectStateBinding: binding });
  return buildWorkflowSnapshot(context);
}

function buildWorkflowSnapshot(
  context: Pick<WorkflowSnapshotProjectionContext, "repoContext" | "instructionProfiles" | "kilnYaml">,
): WorkflowSnapshotExport {
  return buildWorkflowSnapshotExport({
    generatedAt: WORKFLOW_SNAPSHOT_GENERATED_AT,
    generatedFiles: workflowSnapshotGeneratedFiles(),
    projectContext: context.repoContext,
    instructionProfiles: context.instructionProfiles,
    kilnConfig: context.kilnYaml,
  });
}

function workflowSnapshotGeneratedFiles(): readonly string[] {
  return [WORKFLOW_SNAPSHOT_MARKDOWN_FILE];
}

function writeWorkflowSnapshotProjection(
  binding: ProjectStateBinding,
  workflowSnapshot: WorkflowSnapshotExport,
  dryRun: boolean,
): WorkflowSnapshotWriteResult {
  const snapshotPath = workflowSnapshotMarkdownPath(binding);
  const content = renderWorkflowSnapshotMarkdown(workflowSnapshot);
  const existing = readPrivateStateFileIfPresent(binding, snapshotPath);

  if (existing === content) {
    return workflowSnapshotResult(snapshotPath, false);
  }

  if (dryRun) return workflowSnapshotResult(snapshotPath, false, true);

  ensureWorkflowProjectionDir(binding);
  assertPrivateStateFileTargetSync(binding.projectStateRoot, snapshotPath);
  writeFileSync(snapshotPath, content, "utf-8");
  return workflowSnapshotResult(snapshotPath, true);
}

function writeWorkflowSnapshotManifest(
  binding: ProjectStateBinding,
  workflowSnapshot: WorkflowSnapshotExport,
  dryRun: boolean,
): WorkflowSnapshotWriteResult {
  const manifestPath = workflowSnapshotManifestPath(binding);
  const existing = readPrivateStateFileIfPresent(binding, manifestPath);
  const existingManifest = existing ? readWorkflowSnapshotManifest(existing) : null;

  if (existingManifest && workflowSnapshotManifestsEqual(existingManifest, workflowSnapshot.manifest)) {
    return workflowSnapshotResult(manifestPath, false);
  }

  if (dryRun) return workflowSnapshotResult(manifestPath, false, true);

  ensureWorkflowProjectionDir(binding);
  assertPrivateStateFileTargetSync(binding.projectStateRoot, manifestPath);
  writeFileSync(manifestPath, `${JSON.stringify(workflowSnapshot.manifest, null, 2)}\n`, "utf-8");
  return workflowSnapshotResult(manifestPath, true);
}

function workflowSnapshotMarkdownPath(binding: ProjectStateBinding): string {
  return join(binding.projectionsPath, "workflow-snapshot.md");
}

function workflowSnapshotManifestPath(binding: ProjectStateBinding): string {
  return join(binding.projectionsPath, "workflow-snapshot-manifest.json");
}

/**
 * Read-only effect-time validation for a private projection file. The shared
 * write guard may create missing directories, so status/current decisions use
 * this non-mutating path first.
 */
function readPrivateStateFileIfPresent(
  binding: ProjectStateBinding,
  filePath: string,
): string | null {
  if (!assertPrivateStateDirectoryTargetSync(binding.projectStateRoot, dirname(filePath))) {
    return null;
  }
  try {
    const stat = lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error("Private project state file target is not a regular file.");
    }
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
  return readFileSync(filePath, "utf-8");
}

interface ParsedWorkflowSnapshotManifest {
  readonly [key: string]: unknown;
}

function readWorkflowSnapshotManifest(content: string): ParsedWorkflowSnapshotManifest | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as ParsedWorkflowSnapshotManifest;
  } catch {
    return null;
  }
}

function readWorkflowSnapshotManifestHash(value: ParsedWorkflowSnapshotManifest): string | null {
  return typeof value.hash === "string" ? value.hash : null;
}

function workflowSnapshotManifestsEqual(
  left: unknown,
  right: WorkflowSnapshotManifest,
): boolean {
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function readWorkflowSnapshotContentHash(content: string): string | null {
  const end = content.indexOf("-->");
  if (!content.startsWith("<!--") || end === -1) {
    return null;
  }
  const lines = content.slice(4, end).split(/\r?\n/u).map((line) => line.trim());
  if (!lines.includes("kiln:workflow-snapshot:v1")) {
    return null;
  }
  const contentHash = lines
    .map((line) => {
      const separator = line.indexOf(":");
      return separator > 0 && line.slice(0, separator) === "contentHash"
        ? line.slice(separator + 1).trim()
        : undefined;
    })
    .find((value): value is string => value !== undefined);
  if (!contentHash || !/^sha256:[a-f0-9]{64}$/u.test(contentHash)) {
    return null;
  }
  const body = content.slice(end + 3).replace(/^\r?\n/u, "");
  return contentHash === `sha256:${hashText(body)}` ? contentHash : null;
}

function projectBinding(
  projectPath: string,
  options: WorkflowSnapshotProjectionReadOptions = {},
): ProjectStateBinding {
  return options.projectStateBinding
    ?? resolveProjectStateBinding(resolveProjectRoot({ explicitPath: projectPath }).rootPath, options);
}

function assertWorkflowSnapshotRepositoryRootSync(binding: ProjectStateBinding): void {
  const canonicalRoot = binding.canonicalRoot;
  let rootStat;
  try {
    rootStat = lstatSync(canonicalRoot);
  } catch (error) {
    throw new Error(`Workflow snapshot repository root cannot be inspected: ${canonicalRoot}`, { cause: error });
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("Workflow snapshot repository root is not a canonical directory.");
  }
  let observedRoot: string;
  try {
    observedRoot = realpathSync(canonicalRoot);
  } catch (error) {
    throw new Error(`Workflow snapshot repository root cannot be canonicalized: ${canonicalRoot}`, { cause: error });
  }
  if (!sameRepositoryPath(observedRoot, canonicalRoot)) {
    throw new Error("Workflow snapshot repository root changed from its established canonical path.");
  }
}

function sameRepositoryPath(left: string, right: string): boolean {
  const normalizedLeft = resolvePath(left);
  const normalizedRight = resolvePath(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function resolvePath(path: string): string {
  return resolve(path);
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

function toProjectionOutcome(
  targetId: string,
  result: WorkflowSnapshotWriteResult,
): ProjectionOutcome {
  return {
    targetId,
    path: result.path,
    status: result.status,
    ...(result.errors[0] ? { reason: result.errors[0] } : {}),
  };
}

function projectionFailure(
  projectPath: string,
  options: WorkflowSnapshotProjectionOptions,
  message: string,
): WorkflowSnapshotProjectionResult {
  let binding: ProjectStateBinding | undefined;
  try {
    binding = projectBinding(projectPath, options);
  } catch {
    // The project root itself may be unavailable; the caller still receives a
    // truthful failure outcome without probing a guessed private path.
  }
  const projectionPath = binding ? workflowSnapshotMarkdownPath(binding) : projectPath;
  const manifestPath = binding ? workflowSnapshotManifestPath(binding) : projectPath;
  return {
    written: false,
    errors: [message],
    outcomes: [
      { targetId: WORKFLOW_SNAPSHOT_TARGET_ID, path: projectionPath, status: "failed", reason: message },
      { targetId: WORKFLOW_SNAPSHOT_MANIFEST_TARGET_ID, path: manifestPath, status: "failed", reason: message },
    ],
  };
}

function ensureWorkflowProjectionDir(binding: ProjectStateBinding): void {
  ensurePrivateStateDirectorySync(binding.projectStateRoot, binding.projectionsPath);
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
    "> Generated by kiln sync --workflow-snapshot from canonical Kiln workflow evidence. Do not edit manually.",
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

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && ((error as NodeJS.ErrnoException).code === "ENOENT"
      || (error as NodeJS.ErrnoException).code === "ENOTDIR");
}
