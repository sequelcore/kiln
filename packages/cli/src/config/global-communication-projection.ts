import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ResolvedCommunicationIntent } from "@kilnai/core";
import { backupNativeProjectionFile } from "./native-projection-backup.js";
import { stripJsonComments } from "./json-comments.js";
import { resolveNativeCommunication } from "./native-communication-capabilities.js";
import { resolveNativeHarnessDir } from "./native-harness-home.js";
import {
  createNativeProjectionSnapshot,
  detectNativeProjectionDrift,
  readNativeProjectionInstallState,
  removeNativeProjectionTargetState,
  resolveGlobalNativeProjectionStateDir,
  stripManagedFields,
  upsertNativeProjectionTargetState,
  writeNativeProjectionInstallState,
} from "./native-projection-state.js";
import type { ProjectionOutcome } from "./native-projection-policy.js";

export const CLAUDE_GLOBAL_OUTPUT_STYLE_TARGET_ID = "claude-global-output-style";
const MANAGED_FIELD = "outputStyle";

export interface GlobalCommunicationProjectionOptions {
  readonly intent: ResolvedCommunicationIntent;
  readonly userHome?: string;
  readonly force?: boolean;
  readonly dryRun?: boolean;
}

export interface GlobalCommunicationProjectionResult {
  readonly outcome: ProjectionOutcome;
  readonly errors: readonly string[];
}

export interface GlobalCommunicationProjectionSnapshot {
  readonly targetId: typeof CLAUDE_GLOBAL_OUTPUT_STYLE_TARGET_ID;
  readonly path: string;
  readonly status: "current" | "missing" | "stale" | "drifted" | "unmanaged";
  readonly details?: string;
}

export function readGlobalCommunicationProjectionSnapshot(
  options: Pick<GlobalCommunicationProjectionOptions, "intent" | "userHome">,
): GlobalCommunicationProjectionSnapshot | undefined {
  const target = targetPath(options.userHome);
  const state = readNativeProjectionInstallState(resolveGlobalNativeProjectionStateDir(options.userHome));
  const owned = state.targets[CLAUDE_GLOBAL_OUTPUT_STYLE_TARGET_ID];
  const existing = readSettings(target);
  const desired = desiredOutputStyle(options.intent);

  if (!owned) {
    if (desired === undefined) return undefined;
    return {
      targetId: CLAUDE_GLOBAL_OUTPUT_STYLE_TARGET_ID,
      path: target,
      status: existing.outputStyle === undefined ? "missing" : "unmanaged",
      ...(existing.outputStyle === undefined ? {} : { details: "Claude outputStyle is not owned by Kiln" }),
    };
  }

  const drift = detectNativeProjectionDrift({
    targetId: CLAUDE_GLOBAL_OUTPUT_STYLE_TARGET_ID,
    state,
    currentDocument: existing,
  });
  if (drift) {
    return {
      targetId: CLAUDE_GLOBAL_OUTPUT_STYLE_TARGET_ID,
      path: target,
      status: "drifted",
      details: `managed field drift: ${drift.driftedFields.join(", ")}`,
    };
  }

  return existing.outputStyle === desired
    ? { targetId: CLAUDE_GLOBAL_OUTPUT_STYLE_TARGET_ID, path: target, status: "current" }
    : { targetId: CLAUDE_GLOBAL_OUTPUT_STYLE_TARGET_ID, path: target, status: "stale" };
}

export function syncGlobalCommunicationProjection(
  options: GlobalCommunicationProjectionOptions,
): GlobalCommunicationProjectionResult {
  const target = targetPath(options.userHome);
  const stateDir = resolveGlobalNativeProjectionStateDir(options.userHome);
  const originalContent = existsSync(target) ? readFileSync(target, "utf8") : undefined;
  let state = readNativeProjectionInstallState(stateDir);
  const existing = readSettings(target);
  const owned = state.targets[CLAUDE_GLOBAL_OUTPUT_STYLE_TARGET_ID];
  const desired = desiredOutputStyle(options.intent);
  const drift = detectNativeProjectionDrift({
    targetId: CLAUDE_GLOBAL_OUTPUT_STYLE_TARGET_ID,
    state,
    currentDocument: existing,
  });

  if (drift && !options.force) {
    const reason = `managed field drift detected: ${drift.driftedFields.join(", ")}`;
    return result(target, "blocked", reason);
  }
  if (!owned && existing.outputStyle !== undefined && existing.outputStyle !== desired && !options.force) {
    return result(target, "blocked", "unmanaged Claude outputStyle conflicts with canonical Kiln communication intent");
  }

  const base = owned
    ? stripManagedFields({ currentDocument: existing, managedFields: owned.managedFields })
    : { ...existing };
  const document = desired === undefined ? base : { ...base, outputStyle: desired };
  const alreadyCurrent = existing.outputStyle === desired
    && (desired === undefined ? owned === undefined : owned !== undefined);
  if (alreadyCurrent && !drift) return result(target, "unchanged");
  if (options.dryRun) return result(target, "planned");

  if (originalContent !== undefined) {
    backupNativeProjectionFile({
      kilnDir: stateDir,
      targetId: CLAUDE_GLOBAL_OUTPUT_STYLE_TARGET_ID,
      filePath: target,
    });
  }
  try {
    writeJsonAtomically(target, document);
    if (desired === undefined) {
      state = removeNativeProjectionTargetState(state, CLAUDE_GLOBAL_OUTPUT_STYLE_TARGET_ID);
    } else {
      state = upsertNativeProjectionTargetState(state, createNativeProjectionSnapshot({
        targetId: CLAUDE_GLOBAL_OUTPUT_STYLE_TARGET_ID,
        filePath: target,
        document,
        managedFields: [MANAGED_FIELD],
        communicationResolution: resolveClaudeCommunication(options.intent),
      }));
    }
    writeNativeProjectionInstallState(stateDir, state);
  } catch (error) {
    restoreFile(target, originalContent);
    throw error;
  }
  return result(target, desired === undefined ? "removed" : "written");
}

function desiredOutputStyle(intent: ResolvedCommunicationIntent): string | undefined {
  const resolution = resolveClaudeCommunication(intent);
  return resolution.responseDetail.mechanism === "native"
    ? resolution.responseDetail.nativeValue
    : undefined;
}

function resolveClaudeCommunication(intent: ResolvedCommunicationIntent) {
  return resolveNativeCommunication({
    intent,
    harness: "claude",
    model: "provider-default",
    surface: "standalone-harness",
    projection: "global-settings",
  });
}

function targetPath(userHome: string | undefined): string {
  return join(resolveNativeHarnessDir("claude", userHome), "settings.json");
}

function readSettings(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(stripJsonComments(readFileSync(path, "utf8"))) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Claude settings root must be an object: ${path}`);
  }
  return parsed as Record<string, unknown>;
}

let writeSequence = 0;

function writeJsonAtomically(path: string, document: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${++writeSequence}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function restoreFile(path: string, content: string | undefined): void {
  if (content === undefined) {
    rmSync(path, { force: true });
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function result(
  path: string,
  status: ProjectionOutcome["status"],
  reason?: string,
): GlobalCommunicationProjectionResult {
  return {
    outcome: {
      targetId: CLAUDE_GLOBAL_OUTPUT_STYLE_TARGET_ID,
      path,
      status,
      ...(reason ? { reason } : {}),
    },
    errors: reason ? [`${CLAUDE_GLOBAL_OUTPUT_STYLE_TARGET_ID}: ${reason}`] : [],
  };
}
