import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { loadAgentDefinitions } from "../application/agent-loader.js";
import type { KilnAgentDefinition } from "../application/agent-loader.js";
import {
  createNativeProjectionFileSnapshot,
  detectNativeProjectionFileDrift,
  readNativeProjectionInstallState,
  upsertNativeProjectionTargetState,
  writeNativeProjectionInstallState,
  type NativeProjectionInstallState,
  type NativeProjectionTargetState,
} from "./native-projection-state.js";
import { backupNativeProjectionFile } from "./native-projection-backup.js";
import {
  isNativeProjectionHarnessDisabled,
  type NativeProjectionSyncOptions,
} from "./native-projection-policy.js";

export interface NativeAgentProjectionResult {
  claude: boolean;
  codex: boolean;
  opencode: boolean;
  synced: number;
  errors: string[];
}

export interface NativeAgentProjectionOptions extends NativeProjectionSyncOptions {}

interface NativeAgentProjectionTarget {
  readonly key: "claude" | "codex" | "opencode";
  readonly label: "Claude Code" | "Codex" | "OpenCode";
  readonly dir: string;
  readonly extension: "md" | "toml";
  readonly render: (agent: KilnAgentDefinition) => string;
}

interface NativeAgentFileSyncResult {
  readonly ok: boolean;
  readonly snapshot?: NativeProjectionTargetState;
  readonly error?: string;
}

function escapeTomlString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function escapeTomlMultiline(value: string): string {
  return value.replaceAll("\"\"\"", "\\\"\\\"\\\"");
}

export function agentToClaudeMd(agent: KilnAgentDefinition): string {
  const frontmatter: Record<string, unknown> = {
    name: agent.name,
    role: agent.role,
  };

  if (agent.displayName) {
    frontmatter.displayName = agent.displayName;
  }

  if (agent.nicknameCandidates && agent.nicknameCandidates.length > 0) {
    frontmatter.nicknameCandidates = [...agent.nicknameCandidates];
  }

  if (agent.description) {
    frontmatter.description = agent.description;
  }

  if (agent.goal) {
    frontmatter.goal = agent.goal;
  }

  if (agent.tools && agent.tools.length > 0) {
    frontmatter.tools = [...agent.tools];
  }

  if (agent.model) {
    frontmatter.model = agent.model;
  }

  if (agent.skills && agent.skills.length > 0) {
    frontmatter.skills = [...agent.skills];
  }

  if (agent.mode) {
    frontmatter.mode = agent.mode;
  }

  const yamlFrontmatter = stringify(frontmatter).trimEnd();
  const body = agent.instructions ?? "";
  return `---\n${yamlFrontmatter}\n---\n${body}`;
}

export function agentToCodexToml(agent: KilnAgentDefinition): string {
  const instructions = buildNativeAgentInstructions(agent);
  const lines = [
    `name = "${escapeTomlString(agent.name)}"`,
    `description = "${escapeTomlString(agent.description ?? agent.role)}"`,
    `developer_instructions = """${escapeTomlMultiline(instructions)}"""`,
  ];

  if (agent.model) {
    lines.push(`model = "${escapeTomlString(agent.model)}"`);
  }

  const nicknameCandidates = nativeNicknameCandidates(agent);
  if (nicknameCandidates.length > 0) {
    const renderedNicknames = nicknameCandidates
      .map((nickname) => `"${escapeTomlString(nickname)}"`)
      .join(", ");
    lines.push(`nickname_candidates = [${renderedNicknames}]`);
  }

  return `${lines.join("\n")}\n`;
}

export function agentToOpenCodeMd(agent: KilnAgentDefinition): string {
  const frontmatter: Record<string, unknown> = {
    name: agent.name,
    description: agent.description ?? agent.role,
  };
  if (agent.displayName) {
    frontmatter.displayName = agent.displayName;
  }
  if (agent.nicknameCandidates && agent.nicknameCandidates.length > 0) {
    frontmatter.nicknameCandidates = [...agent.nicknameCandidates];
  }
  if (agent.model) {
    frontmatter.model = agent.model;
  }
  if (agent.mode) {
    frontmatter.mode = agent.mode;
  }
  if (agent.skills && agent.skills.length > 0) {
    frontmatter.skills = [...agent.skills];
  }

  const yamlFrontmatter = stringify(frontmatter).trimEnd();
  const body = buildNativeAgentInstructions(agent);
  return `---\n${yamlFrontmatter}\n---\n${body}`;
}

function buildNativeAgentInstructions(agent: KilnAgentDefinition): string {
  return [
    agent.displayName ? `Display name: ${agent.displayName}` : undefined,
    `Goal: ${agent.goal}`,
    agent.backstory ? `Backstory: ${agent.backstory}` : undefined,
    agent.instructions,
  ].filter((line): line is string => Boolean(line)).join("\n\n");
}

function nativeNicknameCandidates(agent: KilnAgentDefinition): readonly string[] {
  const nicknames = new Set<string>();
  if (agent.displayName) {
    nicknames.add(agent.displayName);
  }
  for (const nickname of agent.nicknameCandidates ?? []) {
    nicknames.add(nickname);
  }
  return [...nicknames];
}

export async function syncNativeAgentProjections(
  projectPath: string,
  options: NativeAgentProjectionOptions = {},
): Promise<NativeAgentProjectionResult> {
  const errors: string[] = [];
  let synced = 0;
  const kilnDir = join(projectPath, ".kiln");
  let installState = readNativeProjectionInstallState(kilnDir);

  let agents: KilnAgentDefinition[];
  try {
    agents = await loadAgentDefinitions(projectPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      claude: false,
      codex: false,
      opencode: false,
      synced: 0,
      errors: [`Agent load failed: ${message}`],
    };
  }

  if (agents.length === 0) {
    return { claude: true, codex: true, opencode: true, synced: 0, errors: [] };
  }

  const targets: NativeAgentProjectionTarget[] = [
    {
      key: "claude",
      label: "Claude Code",
      dir: join(os.homedir(), ".claude", "agents"),
      extension: "md",
      render: agentToClaudeMd,
    },
    {
      key: "codex",
      label: "Codex",
      dir: join(os.homedir(), ".codex", "agents"),
      extension: "toml",
      render: agentToCodexToml,
    },
    {
      key: "opencode",
      label: "OpenCode",
      dir: join(os.homedir(), ".config", "opencode", "agents"),
      extension: "md",
      render: agentToOpenCodeMd,
    },
  ];

  let claude = true;
  let codex = true;
  let opencode = true;

  const setTargetFailed = (targetKey: NativeAgentProjectionTarget["key"]): void => {
    if (targetKey === "claude") {
      claude = false;
      return;
    }
    if (targetKey === "codex") {
      codex = false;
      return;
    }
    opencode = false;
  };

  for (const target of targets.filter((target) => !isNativeProjectionHarnessDisabled(options, target.key))) {
    try {
      mkdirSync(target.dir, { recursive: true });
    } catch (error) {
      setTargetFailed(target.key);
      errors.push(`${target.label} mkdir failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    for (const agent of agents) {
      const result = syncAgentFile(agent, target, kilnDir, installState, options);
      if (!result.ok) {
        setTargetFailed(target.key);
        errors.push(`${target.label} agent "${agent.name}" failed: ${result.error ?? "unknown error"}`);
        continue;
      }
      if (result.snapshot) {
        installState = upsertNativeProjectionTargetState(installState, result.snapshot);
      }
      synced += 1;
    }
  }

  writeNativeProjectionInstallState(kilnDir, installState);

  return { claude, codex, opencode, synced, errors };
}

function syncAgentFile(
  agent: KilnAgentDefinition,
  target: NativeAgentProjectionTarget,
  kilnDir: string,
  installState: NativeProjectionInstallState,
  options: NativeAgentProjectionOptions,
): NativeAgentFileSyncResult {
  const filePath = join(target.dir, `${agent.name}.${target.extension}`);
  const targetId = `${target.key}-agent:${agent.name}`;
  try {
    if (existsSync(filePath)) {
      const drift = detectNativeProjectionFileDrift({
        targetId,
        state: installState,
        currentContent: readFileSync(filePath, "utf-8"),
      });
      if (drift && !options.force) {
        return {
          ok: false,
          error: `managed file drift detected: ${drift.driftedFields.join(", ")}`,
        };
      }
    }

    const content = target.render(agent);
    backupNativeProjectionFile({ kilnDir, targetId, filePath });
    writeFileSync(filePath, content, "utf-8");
    return {
      ok: true,
      snapshot: createNativeProjectionFileSnapshot({
        targetId,
        filePath,
        content,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
