import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import os from "node:os";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

export type McpClient = "claude-code" | "codex" | "opencode" | "all";

export interface McpServerDef {
  readonly name: string;
  readonly command: string;
  readonly args: string[];
  readonly env?: Record<string, string>;
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

async function generateClaudeCodeMcp(
  serverDef: McpServerDef,
  projectPath: string,
): Promise<void> {
  const target = join(projectPath, ".mcp.json");
  let existing: Record<string, unknown> = {};
  if (existsSync(target)) {
    try {
      existing = JSON.parse(readFileSync(target, "utf-8"));
    } catch {
      existing = {};
    }
  }

  const mcpServers = (existing["mcpServers"] as Record<string, unknown> | undefined) ?? {};
  mcpServers[serverDef.name] = {
    command: serverDef.command,
    args: serverDef.args,
  };
  if (serverDef.env && Object.keys(serverDef.env).length > 0) {
    mcpServers[serverDef.name] = {
      ...(mcpServers[serverDef.name] as Record<string, unknown>),
      env: serverDef.env,
    };
  }

  const merged: Record<string, unknown> = { ...existing, mcpServers };
  ensureDir(target);
  writeFileSync(target, JSON.stringify(merged, null, 2) + "\n", "utf-8");
}

async function generateCodexMcp(serverDef: McpServerDef): Promise<void> {
  const target = join(os.homedir(), ".codex", "config.toml");
  let doc: Record<string, unknown> = {};
  if (existsSync(target)) {
    try {
      const raw = readFileSync(target, "utf-8");
      doc = parseToml(raw) as Record<string, unknown>;
    } catch {
      doc = {};
    }
  }

  const mcpServers = (doc["mcp_servers"] as Record<string, unknown> | undefined) ?? {};
  mcpServers[serverDef.name] = {
    command: serverDef.command,
    args: serverDef.args,
    enabled: true,
  };

  doc = { ...doc, mcp_servers: mcpServers };
  ensureDir(target);
  writeFileSync(target, stringifyToml(doc as Record<string, unknown>), "utf-8");
}

async function generateOpenCodeMcp(serverDef: McpServerDef): Promise<void> {
  const target = join(os.homedir(), ".config", "opencode", "opencode.json");
  let existing: Record<string, unknown> = {};
  if (existsSync(target)) {
    try {
      const raw = readFileSync(target, "utf-8");
      const stripped = stripJsonComments(raw);
      existing = JSON.parse(stripped);
    } catch {
      existing = {};
    }
  }

  const mcp = (existing["mcp"] as Record<string, unknown> | undefined) ?? {};
  const entry: Record<string, unknown> = {
    type: "local",
    command: [serverDef.command, ...serverDef.args],
    enabled: true,
  };
  if (serverDef.env && Object.keys(serverDef.env).length > 0) {
    entry["environment"] = serverDef.env;
  }
  mcp[serverDef.name] = entry;

  const merged: Record<string, unknown> = { ...existing, mcp };
  ensureDir(target);
  writeFileSync(target, JSON.stringify(merged, null, 2) + "\n", "utf-8");
}

export async function generateMcpConfig(
  client: McpClient,
  serverDef: McpServerDef,
  projectPath: string,
): Promise<void> {
  if (client === "all") {
    await Promise.all([
      generateClaudeCodeMcp(serverDef, projectPath),
      generateCodexMcp(serverDef),
      generateOpenCodeMcp(serverDef),
    ]);
    return;
  }
  if (client === "claude-code") {
    await generateClaudeCodeMcp(serverDef, projectPath);
    return;
  }
  if (client === "codex") {
    await generateCodexMcp(serverDef);
    return;
  }
  if (client === "opencode") {
    await generateOpenCodeMcp(serverDef);
    return;
  }
}

function stripJsonComments(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  for (const line of lines) {
    let inString = false;
    let commentIndex = -1;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"' && (i === 0 || line[i - 1]! !== '\\')) {
        inString = !inString;
      } else if (!inString && ch === "/" && i + 1 < line.length && line[i + 1] === "/") {
        commentIndex = i;
        break;
      }
    }
    if (commentIndex >= 0) {
      result.push(line.slice(0, commentIndex).trimEnd());
    } else {
      result.push(line);
    }
  }
  return result.join("\n");
}

export interface McpClientConfig {
  readonly client: "claude-code" | "cursor" | "generic";
  readonly transport: "stdio" | "sse";
  readonly port?: number;
  readonly mcpServerName: string;
  readonly appName: string;
}

export function generateConfig(config: McpClientConfig): string {
  const serverName = config.mcpServerName;
  const command = config.appName;
  const args = ["tools", "--mcp"];

  if (config.client === "claude-code" && config.transport === "stdio") {
    return JSON.stringify({
      mcpServers: {
        [serverName]: {
          command,
          args,
          env: {},
        },
      },
    }, null, 2);
  }

  if (config.client === "cursor" && config.transport === "stdio") {
    return JSON.stringify({
      mcpServers: {
        [serverName]: {
          command,
          args,
          transportType: "stdio",
        },
      },
    }, null, 2);
  }

  const port = config.port ?? 3001;
  if (config.transport === "sse") {
    return JSON.stringify({
      mcpServers: {
        [serverName]: {
          url: `http://localhost:${port}/sse`,
          transportType: "sse",
        },
      },
    }, null, 2);
  }

  return JSON.stringify({
    mcpServers: {
      [serverName]: {
        command,
        args,
        transportType: "stdio",
      },
    },
  }, null, 2);
}
