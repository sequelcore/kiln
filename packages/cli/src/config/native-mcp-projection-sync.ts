import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { McpConfigurationResolution, ResolvedMcpServer } from "@kilnai/core";
import { stripJsonComments } from "./json-comments.js";
import { backupNativeProjectionFile } from "./native-projection-backup.js";
import {
  createNativeProjectionSnapshot,
  detectNativeProjectionDrift,
  readNativeProjectionInstallState,
  removeNativeProjectionTargetState,
  stripManagedFields,
  upsertNativeProjectionTargetState,
  writeNativeProjectionInstallState,
} from "./native-projection-state.js";
import { projectMcpServer, type NativeMcpHarness } from "./native-mcp-projection.js";

export type NativeMcpProjectionTargetStatus =
  | "current"
  | "partial"
  | "incompatible"
  | "drifted"
  | "blocked-malformed"
  | "uninstalled";

export interface NativeMcpProjectionTargetResult {
  readonly harness: NativeMcpHarness;
  readonly path: string;
  readonly status: NativeMcpProjectionTargetStatus;
  readonly reason?: string;
  readonly servers?: readonly {
    readonly id: string;
    readonly status: "compatible" | "disabled" | "incompatible";
    readonly reason?: string;
  }[];
}

export interface NativeMcpProjectionResult {
  readonly targets: readonly NativeMcpProjectionTargetResult[];
}

export interface NativeMcpProjectionOptions {
  readonly harnesses?: readonly NativeMcpHarness[];
  readonly force?: boolean;
  readonly now?: string;
  readonly includeKilnControlPlane?: boolean;
}

export function assertNativeMcpProjectionCurrent(
  resolution: McpConfigurationResolution,
  projectPath: string,
  harness: NativeMcpHarness,
): void {
  const enabled = Object.values(resolution.servers).filter((server) => server.enabled && server.admission?.state === "admitted");
  if (enabled.length === 0) return;
  for (const server of enabled) {
    const compatibility = projectMcpServer(harness, server);
    if (compatibility.status !== "compatible") {
      throw new Error(`Canonical MCP server '${server.id}' is incompatible with ${harness}: ${compatibility.reason}`);
    }
  }
  const kilnDir = join(projectPath, ".kiln");
  const state = readNativeProjectionInstallState(kilnDir);
  const targetId = `mcp:${harness}`;
  const target = state.targets[targetId];
  if (!target) throw new Error(`${harness} MCP projection is not installed; run 'kiln mcp-config --client ${harness}'.`);
  const rootKey = rootKeyFor(harness);
  const missing = enabled.filter((server) => !target.managedFields.includes(pointer(rootKey, server.id)));
  if (missing.length > 0) throw new Error(`${harness} MCP projection is missing canonical servers: ${missing.map((server) => server.id).join(", ")}.`);
  let current: Record<string, unknown>;
  try {
    current = readNativeDocument(harness, target.filePath);
  } catch (error) {
    throw new Error(`${harness} MCP projection is unreadable and was not trusted: ${safeError(error)}`);
  }
  const drift = detectNativeProjectionDrift({ targetId, state, currentDocument: current });
  if (drift) throw new Error(`${harness} MCP projection drifted: ${drift.driftedFields.join(", ")}. Run repair after review.`);
}

const ALL_HARNESSES = ["codex", "claude", "opencode"] as const;

export async function syncNativeMcpProjections(
  resolution: McpConfigurationResolution,
  projectPath: string,
  options: NativeMcpProjectionOptions = {},
): Promise<NativeMcpProjectionResult> {
  const kilnDir = join(projectPath, ".kiln");
  if (options.includeKilnControlPlane) {
    const projectMarker = join(kilnDir, "kiln.yaml");
    if (!existsSync(projectMarker) || !statSync(projectMarker).isFile()) {
      throw new Error(`Cannot project the Kiln control-plane bridge: '${projectMarker}' does not exist.`);
    }
  }
  let installState = readNativeProjectionInstallState(kilnDir);
  let stateChanged = false;
  const targets: NativeMcpProjectionTargetResult[] = [];
  const rollbacks: Array<() => void> = [];

  try {
    for (const harness of options.harnesses ?? ALL_HARNESSES) {
    const target = targetFor(harness, projectPath);
    const targetId = `mcp:${harness}`;
    let current: Record<string, unknown>;
    try {
      current = readNativeDocument(harness, target);
    } catch (error) {
      targets.push({
        harness,
        path: target,
        status: "blocked-malformed",
        reason: `Native configuration is unreadable and was not modified: ${safeError(error)}`,
      });
      continue;
    }

    const previous = installState.targets[targetId];
    const drift = detectNativeProjectionDrift({ targetId, state: installState, currentDocument: current });
    if (drift && !options.force) {
      targets.push({
        harness,
        path: target,
        status: "drifted",
        reason: `Managed MCP fields drifted: ${drift.driftedFields.join(", ")}`,
      });
      continue;
    }

    const rootKey = rootKeyFor(harness);
    if (options.includeKilnControlPlane && resolution.servers["kiln-control-plane"]) {
      targets.push({
        harness,
        path: target,
        status: "incompatible",
        reason: "Canonical MCP server id 'kiln-control-plane' is reserved for the Kiln control-plane bridge.",
        servers: [{
          id: "kiln-control-plane",
          status: "incompatible",
          reason: "Rename the canonical MCP server; 'kiln-control-plane' is a reserved native control-plane identity.",
        }],
      });
      continue;
    }
    const base = previous
      ? stripManagedFields({ currentDocument: current, managedFields: previous.managedFields })
      : current;
    const patch: Record<string, unknown> = { [rootKey]: {} };
    const managedFields: string[] = [];
    const serverResults: NonNullable<NativeMcpProjectionTargetResult["servers"]>[number][] = [];
    const root = isRecord(base[rootKey]) ? base[rootKey] : {};

    const servers = [
      ...Object.values(resolution.servers),
      ...(options.includeKilnControlPlane ? [kilnControlPlaneServer(projectPath, harness)] : []),
    ];
    for (const server of servers) {
      const projection = projectMcpServer(harness, server);
      if (projection.status === "compatible" && server.id in root && !wasPreviouslyManaged(previous?.managedFields, rootKey, server.id)) {
        serverResults.push({
          id: server.id,
          status: "incompatible",
          reason: "An unmanaged native MCP server already uses this canonical identity.",
        });
        continue;
      }
      serverResults.push({
        id: server.id,
        status: projection.status,
        ...(projection.status === "compatible" ? {} : { reason: projection.reason }),
      });
      if (projection.status !== "compatible") continue;
      (patch[rootKey] as Record<string, unknown>)[server.id] = projection.entry;
      managedFields.push(pointer(rootKey, server.id));
    }

    const compatibleCount = serverResults.filter((server) => server.status === "compatible").length;
    const incompatibleCount = serverResults.filter((server) => server.status === "incompatible").length;
    if (compatibleCount === 0 && !previous) {
      targets.push({
        harness,
        path: target,
        status: incompatibleCount > 0 ? "incompatible" : "current",
        servers: serverResults,
      });
      continue;
    }

    const projected = mergeProjection(base, patch, managedFields);
    if (JSON.stringify(projected) !== JSON.stringify(current)) {
      const originalContent = existsSync(target) ? readFileSync(target, "utf8") : undefined;
      mkdirSync(dirname(target), { recursive: true });
      backupNativeProjectionFile({ kilnDir, targetId, filePath: target, timestamp: options.now });
      rollbacks.push(() => restoreNativeDocument(target, originalContent));
      writeNativeDocument(harness, target, projected);
    }
    if (managedFields.length > 0) {
      installState = upsertNativeProjectionTargetState(installState, createNativeProjectionSnapshot({
        targetId,
        filePath: target,
        document: projected,
        managedFields,
        ...(options.now ? { updatedAt: options.now } : {}),
      }));
    } else {
      installState = removeNativeProjectionTargetState(installState, targetId);
    }
    stateChanged = true;
    targets.push({
      harness,
      path: target,
      status: incompatibleCount > 0 ? "partial" : "current",
      servers: serverResults,
    });
    }

    if (stateChanged) writeNativeProjectionInstallState(kilnDir, installState);
    return { targets };
  } catch (error) {
    rollbackNativeDocuments(rollbacks, error);
  }
}

function kilnControlPlaneServer(projectPath: string, harness: NativeMcpHarness): ResolvedMcpServer {
  return {
    id: "kiln-control-plane",
    enabled: true,
    transport: "stdio",
    command: "kiln",
    args: ["native-harness", "control-plane-mcp", "--harness", harness, "--project-root", projectPath],
    admission: { state: "admitted" },
    source: "project",
    provenance: {},
    connection: { state: "not-tested" },
    projection: { state: "not-synchronized" },
  };
}

export async function uninstallNativeMcpProjections(
  projectPath: string,
  options: Pick<NativeMcpProjectionOptions, "harnesses" | "force" | "now"> = {},
): Promise<NativeMcpProjectionResult> {
  const kilnDir = join(projectPath, ".kiln");
  let installState = readNativeProjectionInstallState(kilnDir);
  const targets: NativeMcpProjectionTargetResult[] = [];
  let stateChanged = false;
  const rollbacks: Array<() => void> = [];
  try {
    for (const harness of options.harnesses ?? ALL_HARNESSES) {
    const targetId = `mcp:${harness}`;
    const owned = installState.targets[targetId];
    if (!owned) continue;
    let current: Record<string, unknown>;
    try {
      current = readNativeDocument(harness, owned.filePath);
    } catch (error) {
      targets.push({
        harness,
        path: owned.filePath,
        status: "blocked-malformed",
        reason: `Native configuration is unreadable and was not modified: ${safeError(error)}`,
      });
      continue;
    }
    const drift = detectNativeProjectionDrift({ targetId, state: installState, currentDocument: current });
    if (drift && !options.force) {
      targets.push({
        harness,
        path: owned.filePath,
        status: "drifted",
        reason: `Managed MCP fields drifted: ${drift.driftedFields.join(", ")}`,
      });
      continue;
    }
    const stripped = stripManagedFields({ currentDocument: current, managedFields: owned.managedFields });
    const originalContent = existsSync(owned.filePath) ? readFileSync(owned.filePath, "utf8") : undefined;
    backupNativeProjectionFile({ kilnDir, targetId, filePath: owned.filePath, timestamp: options.now });
    rollbacks.push(() => restoreNativeDocument(owned.filePath, originalContent));
    writeNativeDocument(harness, owned.filePath, stripped);
    installState = removeNativeProjectionTargetState(installState, targetId);
    stateChanged = true;
    targets.push({ harness, path: owned.filePath, status: "uninstalled" });
    }
    if (stateChanged) writeNativeProjectionInstallState(kilnDir, installState);
    return { targets };
  } catch (error) {
    rollbackNativeDocuments(rollbacks, error);
  }
}

function targetFor(harness: NativeMcpHarness, projectPath: string): string {
  if (harness === "codex") return join(projectPath, ".codex", "config.toml");
  if (harness === "claude") return join(projectPath, ".mcp.json");
  return join(projectPath, "opencode.json");
}

function rootKeyFor(harness: NativeMcpHarness): "mcp_servers" | "mcpServers" | "mcp" {
  if (harness === "codex") return "mcp_servers";
  if (harness === "claude") return "mcpServers";
  return "mcp";
}

function readNativeDocument(harness: NativeMcpHarness, path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf-8");
  const parsed = harness === "codex" ? parseToml(raw) : JSON.parse(stripJsonComments(raw));
  if (!isRecord(parsed)) throw new Error("configuration root must be an object");
  return parsed;
}

function writeNativeDocument(harness: NativeMcpHarness, path: string, document: Record<string, unknown>): void {
  const content = harness === "codex"
    ? stringifyToml(document)
    : `${JSON.stringify(document, null, 2)}\n`;
  writeFileSync(path, content, "utf-8");
}

function restoreNativeDocument(path: string, content: string | undefined): void {
  if (content === undefined) {
    rmSync(path, { force: true });
    return;
  }
  writeFileSync(path, content, "utf8");
}

function rollbackNativeDocuments(rollbacks: readonly (() => void)[], originalError: unknown): never {
  const rollbackErrors: unknown[] = [];
  for (let index = rollbacks.length - 1; index >= 0; index -= 1) {
    try { rollbacks[index]!(); }
    catch (error) { rollbackErrors.push(error); }
  }
  if (rollbackErrors.length > 0) throw new AggregateError([originalError, ...rollbackErrors], "Native MCP projection failed and rollback was incomplete.");
  throw originalError;
}

function mergeProjection(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
  managedFields: readonly string[],
): Record<string, unknown> {
  const result = structuredClone(base);
  const rootKey = Object.keys(patch)[0]!;
  const root = isRecord(result[rootKey]) ? structuredClone(result[rootKey]) : {};
  const additions = patch[rootKey] as Record<string, unknown>;
  for (const field of managedFields) {
    const id = decodePointer(field.split("/")[2]!);
    root[id] = structuredClone(additions[id]);
  }
  if (Object.keys(root).length > 0) result[rootKey] = root;
  else delete result[rootKey];
  return result;
}

function pointer(rootKey: string, id: string): string {
  return `/${encodePointer(rootKey)}/${encodePointer(id)}`;
}

function encodePointer(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function decodePointer(value: string): string {
  return value.replace(/~1/g, "/").replace(/~0/g, "~");
}

function wasPreviouslyManaged(fields: readonly string[] | undefined, rootKey: string, id: string): boolean {
  return fields?.includes(pointer(rootKey, id)) === true;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/[\r\n]+/g, " ").slice(0, 240) : "unknown parse error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
