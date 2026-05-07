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

const GENERATOR_VERSION = "repo-shims-v1";
const SIGNATURE = "kiln:repo-shim:v1";

type RepoShimKind = "agents" | "claude";

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
  readonly errors: readonly string[];
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

export async function writeRepoShimProjections(
  projectPath: string,
  options: RepoShimProjectionOptions = {},
): Promise<RepoShimProjectionResult> {
  const results: RepoShimProjectionTargetResult[] = [];

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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      written: false,
      targets: [],
      errors: [message],
    };
  }

  const errors = results.flatMap((result) => [...result.errors]);
  return {
    written: errors.length === 0 && results.some((result) => result.written),
    targets: results,
    errors,
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

  lines.push(
    "## Agents",
    "",
    "| Name | Display | Role | Tools | Model | Skills | Instruction Profiles |",
    "|------|---------|------|-------|-------|--------|----------------------|",
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

function formatAgentRow(agent: KilnAgentDefinition): string {
  const tools = agent.tools && agent.tools.length > 0 ? agent.tools.join(", ") : "-";
  const skills = agent.skills && agent.skills.length > 0 ? agent.skills.join(", ") : "-";
  const displayName = agent.displayName ?? "-";
  const instructionProfiles = agent.instructionProfiles && agent.instructionProfiles.length > 0
    ? agent.instructionProfiles.join(", ")
    : "-";
  return `| ${agent.name} (${agent.scope}) | ${displayName} | ${agent.role} | ${tools} | ${agent.model ?? "-"} | ${skills} | ${instructionProfiles} |`;
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
