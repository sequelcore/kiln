import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { resolveGlobalConfigPath } from "./global-config.js";
import { stripJsonComments } from "./json-comments.js";
import type { NativeMcpHarness } from "./native-mcp-projection.js";
import { backupNativeProjectionFile } from "./native-projection-backup.js";
import {
  createNativeProjectionSnapshot,
  detectNativeProjectionDrift,
  readNativeProjectionInstallState,
  removeNativeProjectionTargetState,
  stripManagedFields,
  upsertNativeProjectionTargetState,
  writeNativeProjectionInstallState,
  type NativeProjectionInstallState,
} from "./native-projection-state.js";
import { withGlobalNativeProjectionLock } from "./global-native-projection-lock.js";

export const GLOBAL_CONTROL_PLANE_MCP_ID = "kiln-control-plane";
const ALL_HARNESSES = ["codex", "claude", "opencode"] as const;

export type GlobalControlPlaneMcpProjectionStatus =
  | "current"
  | "missing"
  | "incompatible"
  | "drifted"
  | "blocked-malformed"
  | "uninstalled";

export interface GlobalControlPlaneMcpProjectionTargetResult {
  readonly harness: NativeMcpHarness;
  readonly path: string;
  readonly status: GlobalControlPlaneMcpProjectionStatus;
  readonly changed: boolean;
  readonly reason?: string;
}

export interface GlobalControlPlaneMcpProjectionResult {
  readonly operation: "install" | "status" | "uninstall";
  readonly targets: readonly GlobalControlPlaneMcpProjectionTargetResult[];
}

export interface GlobalControlPlaneMcpProjectionPaths {
  readonly codex: string;
  readonly claude: string;
  readonly opencode: string;
  readonly installStateDir: string;
}

/** Exact running CLI identity persisted into native MCP configuration. */
export interface GlobalControlPlaneMcpLaunchDescriptor {
  readonly executable: string;
  readonly entrypoint: string;
}

export interface SyncGlobalControlPlaneMcpProjectionsInput {
  readonly operation: "install" | "status" | "uninstall";
  readonly harnesses?: readonly NativeMcpHarness[];
  readonly userHome?: string;
  readonly installStateDir?: string;
  readonly projectPath?: string;
  readonly force?: boolean;
  readonly now?: string;
  readonly lifecycleLockTimeoutMs?: number;
  readonly lifecycleLockRetryMs?: number;
  readonly launch?: GlobalControlPlaneMcpLaunchDescriptor;
}

export function resolveGlobalControlPlaneMcpProjectionPaths(userHome?: string): GlobalControlPlaneMcpProjectionPaths {
  const home = userHome ?? homedir();
  return {
    codex: join(home, ".codex", "config.toml"),
    // Claude Code documents user-scoped MCP state in ~/.claude.json, distinct
    // from the project-scoped .mcp.json contract.
    claude: join(home, ".claude.json"),
    opencode: join(home, ".config", "opencode", "opencode.json"),
    installStateDir: userHome
      ? join(home, ".kiln", "runtime", "native-projections")
      : join(dirname(resolveGlobalConfigPath()), "runtime", "native-projections"),
  };
}

export async function syncGlobalControlPlaneMcpProjections(
  input: SyncGlobalControlPlaneMcpProjectionsInput,
): Promise<GlobalControlPlaneMcpProjectionResult> {
  const paths = resolveGlobalControlPlaneMcpProjectionPaths(input.userHome);
  const installStateDir = input.installStateDir ?? paths.installStateDir;
  return withGlobalProjectionLifecycleLock(installStateDir, input, () => syncGlobalControlPlaneMcpProjectionsLocked(input, paths, installStateDir));
}

async function syncGlobalControlPlaneMcpProjectionsLocked(
  input: SyncGlobalControlPlaneMcpProjectionsInput,
  paths: GlobalControlPlaneMcpProjectionPaths,
  installStateDir: string,
): Promise<GlobalControlPlaneMcpProjectionResult> {
  const launch = input.operation === "uninstall" ? undefined : resolveLaunchDescriptor(input.launch);
  let state = readNativeProjectionInstallState(installStateDir);
  const targets: GlobalControlPlaneMcpProjectionTargetResult[] = [];

  for (const harness of input.harnesses ?? ALL_HARNESSES) {
    const path = paths[harness];
    const targetId = targetIdFor(harness);
    const installed = state.targets[targetId];
    if (installed && resolve(installed.filePath) !== resolve(path)) {
      targets.push(result(harness, path, "incompatible", false,
        `Global install state targets a different native configuration: ${installed.filePath}`));
      continue;
    }
    const expectedField = managedFieldFor(harness);
    if (installed && (installed.projectionKind === "file"
      || installed.managedFields.length !== 1
      || installed.managedFields[0] !== expectedField)) {
      targets.push(result(harness, path, "incompatible", false,
        "Global install state claims fields outside the single control-plane MCP identity."));
      continue;
    }

    let current: Record<string, unknown>;
    try {
      current = readDocument(harness, path);
    } catch (error) {
      targets.push(result(harness, path, "blocked-malformed", false,
        `Native configuration is unreadable and was not modified: ${safeError(error)}`));
      continue;
    }

    const drift = detectNativeProjectionDrift({ targetId, state, currentDocument: current });
    if (input.operation === "status") {
      targets.push(statusResult(harness, path, installed !== undefined, current, drift, launch!));
      continue;
    }

    if (input.operation === "uninstall") {
      if (!installed) {
        targets.push(result(harness, path, "uninstalled", false));
        continue;
      }
      if (drift && !input.force) {
        targets.push(result(harness, path, "drifted", false,
          `Managed global MCP field drifted: ${drift.driftedFields.join(", ")}`));
        continue;
      }
      const stripped = stripManagedFields({ currentDocument: current, managedFields: installed.managedFields });
      const nextState = removeNativeProjectionTargetState(state, targetId);
      commitDocumentAndState({ harness, path, targetId, document: stripped, previousContent: readContent(path), installStateDir, nextState, timestamp: input.now });
      state = nextState;
      targets.push(result(harness, path, "uninstalled", true));
      continue;
    }

    if (drift && !input.force) {
      targets.push(result(harness, path, "drifted", false,
        `Managed global MCP field drifted: ${drift.driftedFields.join(", ")}`));
      continue;
    }
    const field = expectedField;
    if (!installed && hasManagedIdentity(current, harness)) {
      targets.push(result(harness, path, "incompatible", false,
        `Native configuration already contains unmanaged '${GLOBAL_CONTROL_PLANE_MCP_ID}'; refusing to overwrite it.`));
      continue;
    }
    const base = installed
      ? stripManagedFields({ currentDocument: current, managedFields: installed.managedFields })
      : current;
    const projected = addServer(base, harness, launch!);
    const changed = !documentsEqual(projected, current);
    const snapshot = createNativeProjectionSnapshot({
      targetId,
      filePath: path,
      document: projected,
      managedFields: [field],
      ...(input.now || installed ? { updatedAt: input.now ?? installed!.updatedAt } : {}),
    });
    const nextState = upsertNativeProjectionTargetState(state, snapshot);
    if (changed || !installed || !documentsEqual(state.targets[targetId], nextState.targets[targetId])) {
      commitDocumentAndState({ harness, path, targetId, document: projected, previousContent: readContent(path), installStateDir, nextState, timestamp: input.now });
    }
    state = nextState;
    targets.push(result(harness, path, "current", changed));
  }

  return { operation: input.operation, targets };
}

async function withGlobalProjectionLifecycleLock<T>(
  installStateDir: string,
  input: Pick<SyncGlobalControlPlaneMcpProjectionsInput, "lifecycleLockTimeoutMs" | "lifecycleLockRetryMs">,
  action: () => Promise<T>,
): Promise<T> {
  return withGlobalNativeProjectionLock(installStateDir, () => action(), {
    ...(input.lifecycleLockTimeoutMs === undefined ? {} : { timeoutMs: input.lifecycleLockTimeoutMs }),
    ...(input.lifecycleLockRetryMs === undefined ? {} : { retryMs: input.lifecycleLockRetryMs }),
  });
}

function statusResult(
  harness: NativeMcpHarness,
  path: string,
  installed: boolean,
  current: Record<string, unknown>,
  drift: ReturnType<typeof detectNativeProjectionDrift>,
  launch: GlobalControlPlaneMcpLaunchDescriptor,
): GlobalControlPlaneMcpProjectionTargetResult {
  if (!installed) {
    return hasManagedIdentity(current, harness)
      ? result(harness, path, "incompatible", false, `Native configuration contains an unmanaged '${GLOBAL_CONTROL_PLANE_MCP_ID}'.`)
      : result(harness, path, "missing", false);
  }
  if (drift) return result(harness, path, "drifted", false, `Managed global MCP field drifted: ${drift.driftedFields.join(", ")}`);
  return documentsEqual(getServer(current, harness), expectedServer(harness, launch))
    ? result(harness, path, "current", false)
    : result(harness, path, "drifted", false, "Managed global MCP field is stale.");
}

function expectedServer(
  harness: NativeMcpHarness,
  launch: GlobalControlPlaneMcpLaunchDescriptor,
): Record<string, unknown> {
  const args = [launch.entrypoint, "native-harness", "control-plane-mcp", "--harness", harness];
  if (harness === "codex") return { command: launch.executable, args, enabled: true };
  if (harness === "claude") return { type: "stdio", command: launch.executable, args };
  return { type: "local", command: [launch.executable, ...args], enabled: true };
}


function addServer(
  document: Record<string, unknown>,
  harness: NativeMcpHarness,
  launch: GlobalControlPlaneMcpLaunchDescriptor,
): Record<string, unknown> {
  const rootKey = rootKeyFor(harness);
  const result = structuredClone(document);
  const root = isRecord(result[rootKey]) ? structuredClone(result[rootKey]) : {};
  root[GLOBAL_CONTROL_PLANE_MCP_ID] = expectedServer(harness, launch);
  result[rootKey] = root;
  return result;
}

function resolveLaunchDescriptor(
  provided?: GlobalControlPlaneMcpLaunchDescriptor,
): GlobalControlPlaneMcpLaunchDescriptor {
  const descriptor = provided ?? {
    executable: process.execPath,
    entrypoint: process.argv[1] ?? "",
  };
  return {
    executable: validateLaunchPath(descriptor.executable, "executable"),
    entrypoint: validateLaunchPath(descriptor.entrypoint, "entrypoint"),
  };
}

function validateLaunchPath(value: string, field: "executable" | "entrypoint"): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Global MCP launch ${field} must be non-empty.`);
  }
  if (value.length > 4_096) {
    throw new TypeError(`Global MCP launch ${field} must not exceed 4096 characters.`);
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`Global MCP launch ${field} must not contain control characters.`);
  }
  if (!isAbsolute(value)) {
    throw new TypeError(`Global MCP launch ${field} must be an absolute path.`);
  }
  return value;
}

function hasManagedIdentity(document: Record<string, unknown>, harness: NativeMcpHarness): boolean {
  return getServer(document, harness) !== undefined;
}

function getServer(document: Record<string, unknown>, harness: NativeMcpHarness): unknown {
  const root = document[rootKeyFor(harness)];
  return isRecord(root) ? root[GLOBAL_CONTROL_PLANE_MCP_ID] : undefined;
}

function readDocument(harness: NativeMcpHarness, path: string): Record<string, unknown> {
  const content = readContent(path);
  if (content === undefined) return {};
  const parsed = harness === "codex" ? parseToml(content) : JSON.parse(stripJsonComments(content));
  if (!isRecord(parsed)) throw new Error("configuration root must be an object");
  return parsed;
}

function commitDocumentAndState(input: {
  readonly harness: NativeMcpHarness;
  readonly path: string;
  readonly targetId: string;
  readonly document: Record<string, unknown>;
  readonly previousContent: string | undefined;
  readonly installStateDir: string;
  readonly nextState: NativeProjectionInstallState;
  readonly writeState?: boolean;
  readonly timestamp?: string;
}): void {
  backupNativeProjectionFile({
    kilnDir: input.installStateDir,
    targetId: input.targetId,
    filePath: input.path,
    timestamp: input.timestamp,
    retain: 3,
    mode: 0o600,
  });
  writeDocumentAtomically(input.harness, input.path, input.document);
  if (input.writeState === false) return;
  try {
    writeNativeProjectionInstallState(input.installStateDir, input.nextState);
  } catch (error) {
    restoreContent(input.path, input.previousContent);
    throw error;
  }
}

function writeDocumentAtomically(harness: NativeMcpHarness, path: string, document: Record<string, unknown>): void {
  const content = harness === "codex" ? stringifyToml(document) : `${JSON.stringify(document, null, 2)}\n`;
  writeContentAtomically(path, content);
}

let writeSequence = 0;
function writeContentAtomically(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${++writeSequence}.tmp`;
  const mode = existsSync(path) ? statSync(path).mode & 0o777 : 0o600;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function restoreContent(path: string, content: string | undefined): void {
  if (content === undefined) rmSync(path, { force: true });
  else writeContentAtomically(path, content);
}

function readContent(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

function rootKeyFor(harness: NativeMcpHarness): "mcp_servers" | "mcpServers" | "mcp" {
  if (harness === "codex") return "mcp_servers";
  if (harness === "claude") return "mcpServers";
  return "mcp";
}

function managedFieldFor(harness: NativeMcpHarness): string {
  return `/${rootKeyFor(harness)}/${GLOBAL_CONTROL_PLANE_MCP_ID}`;
}

function targetIdFor(harness: NativeMcpHarness): string {
  return `global-control-plane-mcp:${harness}`;
}

function result(
  harness: NativeMcpHarness,
  path: string,
  status: GlobalControlPlaneMcpProjectionStatus,
  changed: boolean,
  reason?: string,
): GlobalControlPlaneMcpProjectionTargetResult {
  return { harness, path, status, changed, ...(reason ? { reason } : {}) };
}

function documentsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/[\r\n]+/g, " ").slice(0, 240) : "unknown parse error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
