import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { loadAgentDefinitions } from "../application/agent-loader.js";
import type { KilnAgentDefinition } from "../application/agent-loader.js";

export interface NativeAgentProjectionResult {
  claude: boolean;
  codex: boolean;
  opencode: boolean;
  synced: number;
  errors: string[];
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

  if (agent.tools && agent.tools.length > 0) {
    frontmatter.tools = [...agent.tools];
  }

  if (agent.model) {
    frontmatter.model = agent.model;
  }

  if (agent.skills && agent.skills.length > 0) {
    frontmatter.skills = [...agent.skills];
  }

  const yamlFrontmatter = stringify(frontmatter).trimEnd();
  const body = agent.instructions ?? "";
  return `---\n${yamlFrontmatter}\n---\n${body}`;
}

export function agentToCodexToml(agent: KilnAgentDefinition): string {
  const instructions = agent.instructions ?? agent.role;
  const lines = [
    `name = "${escapeTomlString(agent.name)}"`,
    `description = "${escapeTomlString(agent.role)}"`,
    `developer_instructions = """${escapeTomlMultiline(instructions)}"""`,
  ];

  if (agent.model) {
    lines.push(`model = "${escapeTomlString(agent.model)}"`);
  }

  return `${lines.join("\n")}\n`;
}

export function agentToOpenCodeMd(agent: KilnAgentDefinition): string {
  const frontmatter: Record<string, string> = { description: agent.role };
  if (agent.model) {
    frontmatter.model = agent.model;
  }

  const yamlFrontmatter = stringify(frontmatter).trimEnd();
  const body = agent.instructions ?? "";
  return `---\n${yamlFrontmatter}\n---\n${body}`;
}

export async function syncNativeAgentProjections(projectPath: string): Promise<NativeAgentProjectionResult> {
  const errors: string[] = [];
  let synced = 0;

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

  const claudeDir = join(os.homedir(), ".claude", "agents");
  const codexDir = join(os.homedir(), ".codex", "agents");
  const opencodeDir = join(os.homedir(), ".config", "opencode", "agents");

  let claude = true;
  let codex = true;
  let opencode = true;

  try {
    mkdirSync(claudeDir, { recursive: true });
  } catch (error) {
    claude = false;
    errors.push(`Claude Code mkdir failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const agent of agents) {
    try {
      writeFileSync(join(claudeDir, `${agent.name}.md`), agentToClaudeMd(agent), "utf-8");
      synced += 1;
    } catch (error) {
      claude = false;
      errors.push(`Claude Code agent "${agent.name}" failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    mkdirSync(codexDir, { recursive: true });
  } catch (error) {
    codex = false;
    errors.push(`Codex mkdir failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const agent of agents) {
    try {
      writeFileSync(join(codexDir, `${agent.name}.toml`), agentToCodexToml(agent), "utf-8");
      synced += 1;
    } catch (error) {
      codex = false;
      errors.push(`Codex agent "${agent.name}" failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    mkdirSync(opencodeDir, { recursive: true });
  } catch (error) {
    opencode = false;
    errors.push(`OpenCode mkdir failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const agent of agents) {
    try {
      writeFileSync(join(opencodeDir, `${agent.name}.md`), agentToOpenCodeMd(agent), "utf-8");
      synced += 1;
    } catch (error) {
      opencode = false;
      errors.push(`OpenCode agent "${agent.name}" failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { claude, codex, opencode, synced, errors };
}
