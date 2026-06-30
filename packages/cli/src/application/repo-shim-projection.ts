import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { loadAgentDefinitions, type KilnAgentDefinition } from "./agent-loader.js";
import {
  findInstructionProfile,
  loadInstructionProfiles,
  type KilnInstructionDoctrineDefinition,
  type KilnInstructionProfileDefinition,
} from "./instruction-profile-loader.js";
import { loadKilnConfig } from "../config/config-merger.js";
import type { KilnYaml } from "../kiln-yaml.js";
import {
  collectProjectContextEvidence,
  readProjectContextMarkdown,
  type ProjectContextEvidence,
} from "./project-context.js";
import {
  buildWorkflowSnapshotExport,
  type WorkflowSnapshotExport,
} from "./workflow-snapshot-export.js";

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
  readonly status: "written" | "blocked" | "unchanged";
  readonly errors: readonly string[];
}

export interface RepoShimProjectionResult {
  readonly written: boolean;
  readonly targets: readonly RepoShimProjectionTargetResult[];
  readonly workflowSnapshot?: WorkflowSnapshotExport;
  readonly workflowSnapshotProjection?: WorkflowSnapshotProjectionResult;
  readonly workflowSnapshotManifest?: WorkflowSnapshotManifestResult;
  readonly errors: readonly string[];
}

export interface WorkflowSnapshotProjectionResult {
  readonly path: string;
  readonly written: boolean;
  readonly status: "written" | "unchanged";
  readonly errors: readonly string[];
}

export interface WorkflowSnapshotManifestResult {
  readonly path: string;
  readonly written: boolean;
  readonly status: "written" | "unchanged";
  readonly errors: readonly string[];
}

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
}

interface ProjectionMetadata {
  readonly target: string;
  readonly contentHash: string;
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
  let workflowSnapshot: WorkflowSnapshotExport | undefined;
  let workflowSnapshotProjection: WorkflowSnapshotProjectionResult | undefined;
  let workflowSnapshotManifest: WorkflowSnapshotManifestResult | undefined;

  try {
    const agents = await loadAgentDefinitions(projectPath);
    const instructionProfiles = loadInstructionProfiles(projectPath);
    const kilnYaml = await loadKilnConfig(projectPath);
    const repoContext = collectProjectContextEvidence(projectPath);
    const adoptedProjectContext = readProjectContextMarkdown(projectPath);
    const sourceProfiles = kilnYaml?.activeInstructionProfiles ?? [];
    const projectRootId = hashText(repoContext.projectName.toLowerCase()).slice(0, 16);

    for (const target of TARGETS) {
      results.push(writeRepoShimTarget({
          projectPath,
        target,
        agents,
        instructionProfiles,
        kilnYaml,
        repoContext,
        adoptedProjectContext,
        sourceProfiles,
        projectRootId,
        force: options.force ?? false,
      }));
    }
    workflowSnapshot = buildWorkflowSnapshotExport({
      generatedAt: new Date().toISOString(),
      generatedFiles: workflowSnapshotGeneratedFiles(),
      projectContext: repoContext,
      instructionProfiles,
      kilnConfig: kilnYaml,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      written: false,
      targets: [],
      errors: [message],
    };
  }

  const errors = results.flatMap((result) => [...result.errors]);
  if (errors.length === 0 && workflowSnapshot) {
    workflowSnapshotProjection = writeWorkflowSnapshotProjection(projectPath, workflowSnapshot);
    workflowSnapshotManifest = writeWorkflowSnapshotManifest(projectPath, workflowSnapshot);
  }
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
  };
}

export async function readRepoShimProjectionStatuses(projectPath: string): Promise<readonly RepoShimProjectionStatus[]> {
  const agents = await loadAgentDefinitions(projectPath);
  const instructionProfiles = loadInstructionProfiles(projectPath);
  const kilnYaml = await loadKilnConfig(projectPath);
  const repoContext = collectProjectContextEvidence(projectPath);
  const adoptedProjectContext = readProjectContextMarkdown(projectPath);
  const sourceProfiles = kilnYaml?.activeInstructionProfiles ?? [];
  const projectRootId = hashText(repoContext.projectName.toLowerCase()).slice(0, 16);

  return TARGETS.map((target) => {
    const path = join(projectPath, target.filename);
    const expected = renderSignedProjection({
      body: renderRepoShimBody({
        projectPath,
        target,
        agents,
        instructionProfiles,
        kilnYaml,
        repoContext,
        adoptedProjectContext,
      }),
      target,
      sourceProfiles,
      projectRootId,
      projectName: repoContext.projectName,
    });

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

function writeRepoShimTarget(input: {
  readonly projectPath: string;
  readonly target: RepoShimTarget;
  readonly agents: readonly KilnAgentDefinition[];
  readonly instructionProfiles: readonly KilnInstructionProfileDefinition[];
  readonly kilnYaml: KilnYaml | null;
  readonly repoContext: ProjectContextEvidence;
  readonly adoptedProjectContext: string | null;
  readonly sourceProfiles: readonly string[];
  readonly projectRootId: string;
  readonly force: boolean;
}): RepoShimProjectionTargetResult {
  const targetPath = join(input.projectPath, input.target.filename);
  const body = renderRepoShimBody(input);
  const content = renderSignedProjection({
    body,
    target: input.target,
    sourceProfiles: input.sourceProfiles,
    projectRootId: input.projectRootId,
    projectName: input.repoContext.projectName,
  });
  const existing = existsSync(targetPath) ? readFileSync(targetPath, "utf-8") : null;
  const existingState = existing ? classifyExistingProjection(existing, input.target.kind) : "missing";

  if (existingState === "unmanaged" && !input.force) {
    return {
      kind: input.target.kind,
      path: targetPath,
      written: false,
      status: "blocked",
      errors: [`${input.target.filename}: unmanaged guidance file exists; adopt or back up before generating repo shims`],
    };
  }

  if (existingState === "drifted" && !input.force) {
    return {
      kind: input.target.kind,
      path: targetPath,
      written: false,
      status: "blocked",
      errors: [`${input.target.filename}: managed repo shim drift detected; rerun with --force after reviewing changes`],
    };
  }

  if (existing === content) {
    return {
      kind: input.target.kind,
      path: targetPath,
      written: false,
      status: "unchanged",
      errors: [],
    };
  }

  if (existing && input.force) {
    backupExistingShim(input.projectPath, input.target.filename, existing);
  }

  writeFileSync(targetPath, content, "utf-8");
  return {
    kind: input.target.kind,
    path: targetPath,
    written: true,
    status: "written",
    errors: [],
  };
}

function renderRepoShimBody(input: {
  readonly projectPath: string;
  readonly target: RepoShimTarget;
  readonly agents: readonly KilnAgentDefinition[];
  readonly instructionProfiles: readonly KilnInstructionProfileDefinition[];
  readonly kilnYaml: KilnYaml | null;
  readonly repoContext: ProjectContextEvidence;
  readonly adoptedProjectContext: string | null;
}): string {
  const { projectPath, target, agents, instructionProfiles, kilnYaml, repoContext, adoptedProjectContext } = input;
  const domain = kilnYaml?.domain ?? "default";
  const provider = kilnYaml?.provider ?? "provider default";
  const model = kilnYaml?.model?.default ?? "provider default";
  const maxDepth = String(kilnYaml?.maxDepth ?? 3);
  const parallelWorkers = String(kilnYaml?.parallelWorkers ?? 1);
  const rows = [...agents]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(formatAgentRow);

  const lines: string[] = [
    target.kind === "claude" ? "# Claude Project Guidance" : "# Agents",
    "",
    `> Generated by kiln sync --repo-shims for ${target.audience}. Do not edit manually.`,
    "",
    "## Project",
    "",
    `- Name: ${repoContext.projectName}`,
    `- Domain: ${domain}`,
    `- Default provider: ${provider}`,
    `- Default model: ${model}`,
    `- Max depth: ${maxDepth}`,
    `- Parallel workers: ${parallelWorkers}`,
    "",
  ];

  if (!adoptedProjectContext && (repoContext.packageManager || repoContext.scripts.length > 0 || repoContext.workspacePackages.length > 0)) {
    lines.push("## Repository Evidence", "");
    if (repoContext.packageManager) {
      lines.push(`- Package manager: ${repoContext.packageManager}`);
    }
    for (const [name, command] of repoContext.scripts) {
      lines.push(`- Script \`${name}\`: \`${command}\``);
    }
    for (const workspacePackage of repoContext.workspacePackages) {
      lines.push(`- Workspace package: \`${workspacePackage}\``);
    }
    lines.push("");
  }

  if (!adoptedProjectContext && repoContext.docs.length > 0) {
    lines.push(
      "## Canonical Project References",
      "",
      ...repoContext.docs.map((doc) => `- ${doc}`),
      "",
    );
  }

  if (adoptedProjectContext) {
    lines.push(
      "## Adopted Project Context",
      "",
      "Canonical source: `.kiln/project-context.md`.",
      "",
      stripFrontmatter(adoptedProjectContext).trim(),
      "",
    );
  }

  if (kilnYaml?.activeInstructionProfiles && kilnYaml.activeInstructionProfiles.length > 0) {
    const profileLines = kilnYaml.activeInstructionProfiles.map((profileId) => {
      const profile = findInstructionProfile(instructionProfiles, profileId);
      return profile
        ? `- ${profile.name} (${profile.scope}): ${formatProfilePath(profile, projectPath)}${formatDoctrineSummary(profile.doctrine)}`
        : `- ${profileId} (missing; create the canonical Kiln instruction profile before relying on this shim)`;
    });
    lines.push(
      "## Active Instruction Profiles",
      "",
      "Read these canonical Kiln instruction profiles before work. They are the source of durable operator/team doctrine; this file is only a projection.",
      "",
      ...profileLines,
      "",
    );
  }

  if (kilnYaml?.workGovernance) {
    lines.push(
      "## Work Governance",
      "",
      "Follow the resolved Kiln work-governance policy before choosing direct execution.",
      ...[
        kilnYaml.workGovernance.defaultPosture ? `- Default posture: ${kilnYaml.workGovernance.defaultPosture}` : undefined,
        kilnYaml.workGovernance.directExecution
          ? `- Direct execution: ${formatDirectExecution(kilnYaml.workGovernance.directExecution)}`
          : undefined,
        kilnYaml.workGovernance.requireDelegationFor && kilnYaml.workGovernance.requireDelegationFor.length > 0
          ? `- Orchestrate/delegate for: ${kilnYaml.workGovernance.requireDelegationFor.join(", ")}`
          : undefined,
        kilnYaml.workGovernance.requiredEvidence && kilnYaml.workGovernance.requiredEvidence.length > 0
          ? `- Evidence before done: ${kilnYaml.workGovernance.requiredEvidence.join(", ")}`
          : undefined,
      ].filter((line): line is string => line !== undefined),
      "- Projection is not authority: if required delegation, review, approval, or tool capability is unavailable in this harness, do not simulate it or create project memory workarounds.",
      "- Record missing harness/tool/route capability as a `capability` pause requirement, continue locally only when the required evidence gates can still be satisfied, or ask the operator for explicit authorization.",
      "",
    );
  }

  lines.push(
    "## Agents",
    "",
    "| Name | Display | Role | Tools | Provider Route | Skills | Instruction Profiles |",
    "|------|---------|------|-------|----------------|--------|----------------------|",
    ...rows,
    "",
  );

  if (rows.length === 0) {
    lines.push("No agent profiles defined. Create `.kiln/agents/<name>.md` or `~/.kiln/agents/<name>.md` to add one.", "");
  }

  lines.push(
    "## Usage",
    "",
    "Use canonical Kiln profiles, instruction profiles, and skills as the source of truth.",
    "Do not add durable workflow doctrine directly to this generated file.",
    "Update Kiln config and rerun `kiln sync --repo-shims` instead.",
    "",
  );

  return lines.join("\n");
}

function formatDirectExecution(
  config: NonNullable<KilnYaml["workGovernance"]>["directExecution"],
): string {
  if (!config) {
    return "configured";
  }
  const parts = [
    config.maxFiles !== undefined ? `maxFiles=${config.maxFiles}` : undefined,
    config.maxRisk ? `maxRisk=${config.maxRisk}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(", ") : "configured";
}

function formatAgentRow(agent: KilnAgentDefinition): string {
  const tools = agent.tools && agent.tools.length > 0 ? agent.tools.join(", ") : "-";
  const skills = agent.skills && agent.skills.length > 0 ? agent.skills.join(", ") : "-";
  const taskAffinity = agent.taskAffinity && agent.taskAffinity.length > 0 ? `; tasks: ${agent.taskAffinity.join(", ")}` : "";
  const displayName = agent.displayName ?? "-";
  const instructionProfiles = agent.instructionProfiles && agent.instructionProfiles.length > 0
    ? agent.instructionProfiles.join(", ")
    : "-";
  return `| ${agent.name} (${agent.scope}) | ${displayName} | ${agent.role}${taskAffinity} | ${tools} | ${formatAgentProviderRoute(agent)} | ${skills} | ${instructionProfiles} |`;
}

function formatAgentProviderRoute(agent: KilnAgentDefinition): string {
  if (!agent.providerRoute) {
    return "-";
  }
  return agent.providerRoute.model
    ? `${agent.providerRoute.providerId}/${agent.providerRoute.model}`
    : agent.providerRoute.providerId;
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

function stripFrontmatter(content: string): string {
  const normalized = content.replace(/^\uFEFF/, "");
  const match = /^---\s*\r?\n[\s\S]*?\r?\n---\s*([\s\S]*)$/u.exec(normalized);
  return match?.[1] ?? normalized;
}

function classifyExistingProjection(content: string, expectedTarget: RepoShimKind): "managed" | "drifted" | "unmanaged" {
  const metadata = readProjectionMetadata(content);
  if (!metadata || metadata.target !== expectedTarget) {
    return "unmanaged";
  }

  const body = content.slice(content.indexOf("-->") + 3).replace(/^\r?\n/, "");
  return metadata.contentHash === `sha256:${hashText(body)}` ? "managed" : "drifted";
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

function backupExistingShim(projectPath: string, filename: string, content: string): void {
  const backupDir = join(projectPath, ".kiln", "backups", "repo-shims");
  mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(join(backupDir, `${filename}.${timestamp}.bak`), content, "utf-8");
}

function writeWorkflowSnapshotManifest(
  projectPath: string,
  workflowSnapshot: WorkflowSnapshotExport,
): WorkflowSnapshotManifestResult {
  const manifestPath = workflowSnapshotManifestPath(projectPath);
  const existing = existsSync(manifestPath) ? readFileSync(manifestPath, "utf-8") : null;
  const existingHash = existing ? readManifestHash(existing) : null;

  if (existingHash === workflowSnapshot.manifest.hash) {
    return {
      path: manifestPath,
      written: false,
      status: "unchanged",
      errors: [],
    };
  }

  mkdirSync(join(projectPath, ".kiln", "projections"), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(workflowSnapshot.manifest, null, 2)}\n`, "utf-8");
  return {
    path: manifestPath,
    written: true,
    status: "written",
    errors: [],
  };
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
  const instructionProfiles = loadInstructionProfiles(projectPath);
  const kilnYaml = await loadKilnConfig(projectPath);
  return buildWorkflowSnapshotExport({
    generatedAt: new Date().toISOString(),
    generatedFiles: workflowSnapshotGeneratedFiles(),
    projectContext: collectProjectContextEvidence(projectPath),
    instructionProfiles,
    kilnConfig: kilnYaml,
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
): WorkflowSnapshotProjectionResult {
  const snapshotPath = workflowSnapshotMarkdownPath(projectPath);
  const content = renderWorkflowSnapshotMarkdown(workflowSnapshot);
  const existing = existsSync(snapshotPath) ? readFileSync(snapshotPath, "utf-8") : null;

  if (existing === content) {
    return {
      path: snapshotPath,
      written: false,
      status: "unchanged",
      errors: [],
    };
  }

  mkdirSync(join(projectPath, ".kiln", "projections"), { recursive: true });
  writeFileSync(snapshotPath, content, "utf-8");
  return {
    path: snapshotPath,
    written: true,
    status: "written",
    errors: [],
  };
}

function workflowSnapshotMarkdownPath(projectPath: string): string {
  return join(projectPath, WORKFLOW_SNAPSHOT_MARKDOWN_FILE);
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
  const lines = [
    "# Kiln Workflow Snapshot",
    "",
    "> Generated by kiln sync --repo-shims from canonical Kiln workflow evidence. Do not edit manually.",
    "",
    "## Manifest",
    "",
    `- Hash: ${workflowSnapshot.manifest.hash}`,
    `- Sources: ${workflowSnapshot.manifest.sourceIds.join(", ")}`,
    `- Generated files: ${workflowSnapshot.manifest.generatedFiles.join(", ")}`,
    "",
    "## Specification",
    "",
    `- Project: ${workflowSnapshot.specification.projectName}`,
    `- Package manager: ${workflowSnapshot.specification.packageManager ?? "unknown"}`,
    `- Workspaces: ${formatSnapshotList(workflowSnapshot.specification.workspacePackages)}`,
    `- Canonical docs: ${formatSnapshotList(workflowSnapshot.specification.canonicalDocs)}`,
    "",
    "## Plan",
    "",
    `- Default posture: ${workflowSnapshot.plan.defaultPosture ?? "unspecified"}`,
    `- Orchestration triggers: ${formatSnapshotList(workflowSnapshot.plan.orchestrationTriggers)}`,
    `- Evidence before done: ${formatSnapshotList(workflowSnapshot.plan.evidenceBeforeDone)}`,
    "",
    "## Authority",
    "",
    `- Default posture: ${workflowSnapshot.authorityPosture.defaultPosture ?? "unspecified"}`,
    `- Direct execution: ${formatDirectExecutionSnapshot(workflowSnapshot.authorityPosture.directExecution)}`,
    "",
    "## Model Policy",
    "",
    `- Default provider: ${workflowSnapshot.modelPolicyGuidance.defaultProvider ?? "provider default"}`,
    `- Default model: ${workflowSnapshot.modelPolicyGuidance.defaultModel ?? "provider default"}`,
    `- Max depth: ${workflowSnapshot.modelPolicyGuidance.maxDepth ?? "unspecified"}`,
    `- Parallel workers: ${workflowSnapshot.modelPolicyGuidance.parallelWorkers ?? "unspecified"}`,
    "",
    "## Work Item Profiles",
    "",
    "| Profile | Risk | Evidence | Gates |",
    "|---------|------|----------|-------|",
    ...workflowSnapshot.workItems.map((profile) =>
      `| ${profile.id} | ${profile.minimumRisk} | ${formatSnapshotList(profile.requiredEvidence)} | ${formatSnapshotList(profile.verificationGates)} |`),
    "",
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
  return lines.join("\n");
}

function formatSnapshotList(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function formatDirectExecutionSnapshot(
  directExecution: WorkflowSnapshotExport["authorityPosture"]["directExecution"],
): string {
  if (!directExecution) {
    return "unspecified";
  }
  const parts = [
    directExecution.maxFiles !== undefined ? `maxFiles=${directExecution.maxFiles}` : undefined,
    directExecution.maxRisk ? `maxRisk=${directExecution.maxRisk}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(", ") : "configured";
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
  ].filter((facet): facet is string => facet !== undefined);

  return facets.length > 0 ? ` - doctrine: ${facets.join(", ")}` : "";
}
