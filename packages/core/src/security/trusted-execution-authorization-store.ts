import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TrustedExecutionAuthorization, TrustedExecutionProfile } from "./trusted-execution-integrity.js";

const DEFAULT_TRUST_DIR = join(homedir(), ".kiln", "trust");
export type TrustedExecutionHarness = "codex" | "claude-code" | "opencode";
export interface TrustedExecutionAuthorizationRecord {
  readonly profile: TrustedExecutionProfile;
  readonly authorization: TrustedExecutionAuthorization;
}
function pathFor(harness: TrustedExecutionHarness, baseDir?: string): string {
  return join(baseDir ?? DEFAULT_TRUST_DIR, `${harness}.json`);
}
export function readTrustedExecutionAuthorization(
  harness: TrustedExecutionHarness,
  projectPath: string,
  baseDir?: string,
): TrustedExecutionAuthorizationRecord | undefined {
  const path = pathFor(harness, baseDir);
  if (!existsSync(path)) return undefined;
  const records = JSON.parse(readFileSync(path, "utf8")) as Record<string, TrustedExecutionAuthorizationRecord>;
  return records[projectPath];
}
export function writeTrustedExecutionAuthorization(
  harness: TrustedExecutionHarness,
  projectPath: string,
  record: TrustedExecutionAuthorizationRecord,
  baseDir?: string,
): void {
  const path = pathFor(harness, baseDir);
  const records = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, TrustedExecutionAuthorizationRecord>)
    : {};
  mkdirSync(join(path, ".."), { recursive: true });
  records[projectPath] = record;
  writeFileSync(path, JSON.stringify(records, null, 2) + "\n", "utf8");
}
