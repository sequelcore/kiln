import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { McpDiscoverySnapshot } from "@kilnai/core";

export interface McpRuntimeServerState {
  readonly testedAt: string;
  readonly health: "healthy" | "degraded" | "unavailable";
  readonly discovery: "current" | "changed" | "failed";
  readonly tools: number;
  readonly resources: number;
  readonly prompts: number;
  readonly admitted: number;
  readonly catalogHash?: string;
  readonly lastFailure?: string;
  readonly capabilities?: readonly { readonly selector: string; readonly kind: "tool" | "resource" | "prompt"; readonly name: string; readonly admitted: boolean }[];
}

export interface McpRuntimeState {
  readonly version: 1;
  readonly servers: Readonly<Record<string, McpRuntimeServerState>>;
}

export function readMcpRuntimeState(projectPath: string): McpRuntimeState {
  const path = statePath(projectPath);
  if (!existsSync(path)) return { version: 1, servers: {} };
  try {
    const value = JSON.parse(readFileSync(path, "utf-8")) as McpRuntimeState;
    return value.version === 1 && value.servers && typeof value.servers === "object" ? value : { version: 1, servers: {} };
  } catch {
    return { version: 1, servers: {} };
  }
}

export function recordMcpDiscovery(projectPath: string, snapshot: McpDiscoverySnapshot, testedAt = new Date().toISOString()): McpRuntimeServerState {
  const state = readMcpRuntimeState(projectPath);
  const catalogHash = createHash("sha256").update(JSON.stringify({
    serverIdentity: snapshot.serverIdentity,
    tools: snapshot.tools.map((item) => item.selector).sort(),
    resources: snapshot.resources.map((item) => item.selector).sort(),
    prompts: snapshot.prompts.map((item) => item.selector).sort(),
  })).digest("hex");
  const previous = state.servers[snapshot.serverId];
  const entry: McpRuntimeServerState = {
    testedAt,
    health: "healthy",
    discovery: previous?.catalogHash && previous.catalogHash !== catalogHash ? "changed" : "current",
    tools: snapshot.tools.length,
    resources: snapshot.resources.length,
    prompts: snapshot.prompts.length,
    admitted: snapshot.tools.length + snapshot.resources.length + snapshot.prompts.length,
    catalogHash,
    capabilities: snapshot.catalog ?? [
      ...snapshot.tools.map((item) => ({ selector: item.selector, kind: "tool" as const, name: item.descriptor.name, admitted: true })),
      ...snapshot.resources.map((item) => ({ selector: item.selector, kind: "resource" as const, name: item.descriptor.uri, admitted: true })),
      ...snapshot.prompts.map((item) => ({ selector: item.selector, kind: "prompt" as const, name: item.descriptor.name, admitted: true })),
    ],
  };
  writeState(projectPath, { version: 1, servers: { ...state.servers, [snapshot.serverId]: entry } });
  return entry;
}

export function recordMcpFailure(projectPath: string, serverId: string, error: unknown, testedAt = new Date().toISOString()): void {
  const state = readMcpRuntimeState(projectPath);
  const previous = state.servers[serverId];
  const entry: McpRuntimeServerState = {
    testedAt,
    health: "unavailable",
    discovery: "failed",
    tools: previous?.tools ?? 0,
    resources: previous?.resources ?? 0,
    prompts: previous?.prompts ?? 0,
    admitted: previous?.admitted ?? 0,
    ...(previous?.catalogHash ? { catalogHash: previous.catalogHash } : {}),
    ...(previous?.capabilities ? { capabilities: previous.capabilities } : {}),
    lastFailure: redactFailure(error),
  };
  writeState(projectPath, { version: 1, servers: { ...state.servers, [serverId]: entry } });
}

function writeState(projectPath: string, state: McpRuntimeState): void {
  const path = statePath(projectPath);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  renameSync(temp, path);
}

function statePath(projectPath: string): string {
  return join(projectPath, ".kiln", "mcp-state.json");
}

function redactFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/[^\s]+/giu, "[redacted-url]").replace(/[\r\n]+/g, " ").slice(0, 240);
}
