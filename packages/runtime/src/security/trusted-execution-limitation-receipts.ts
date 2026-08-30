import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  createTrustedExecutionLimitationAcceptance,
  createTrustedExecutionLimitationRevocation,
  resolveTrustedExecutionLimitationAcceptance,
  type TrustedExecutionLimitationAcceptance,
  type TrustedExecutionLimitationReceipt,
  type TrustedExecutionSemanticLimitation,
} from "@kilnai/core/security";
import { resolveRuntimeKilnHome } from "../kiln-home.js";

export interface AcceptTrustedExecutionSemanticLimitationInput {
  readonly projectPath: string;
  readonly descriptor: TrustedExecutionSemanticLimitation;
  readonly acceptedBy: string;
  readonly acceptedAt: string;
  readonly reviewAfter: string;
  readonly baseDir?: string;
}

export interface RevokeTrustedExecutionSemanticLimitationInput {
  readonly projectPath: string;
  readonly descriptor: TrustedExecutionSemanticLimitation;
  readonly revokedBy: string;
  readonly revokedAt: string;
  readonly baseDir?: string;
}

export function acceptTrustedExecutionSemanticLimitation(
  input: AcceptTrustedExecutionSemanticLimitationInput,
): TrustedExecutionLimitationAcceptance {
  const acceptance = createTrustedExecutionLimitationAcceptance(input);
  appendReceipt(input.projectPath, { kind: "accept", acceptance }, input.baseDir);
  return acceptance;
}

export function revokeTrustedExecutionSemanticLimitation(
  input: RevokeTrustedExecutionSemanticLimitationInput,
): boolean {
  const current = readTrustedExecutionSemanticLimitationAcceptance(
    input.projectPath,
    input.descriptor,
    input.revokedAt,
    input.baseDir,
  );
  if (!current) return false;
  const revocation = createTrustedExecutionLimitationRevocation(input);
  appendReceipt(input.projectPath, revocation, input.baseDir);
  return true;
}

export function readTrustedExecutionSemanticLimitationAcceptance(
  projectPath: string,
  descriptor: TrustedExecutionSemanticLimitation,
  now = new Date().toISOString(),
  baseDir?: string,
): TrustedExecutionLimitationAcceptance | undefined {
  return resolveTrustedExecutionLimitationAcceptance(readReceipts(projectPath, baseDir), descriptor, now);
}

function receiptsPath(projectPath: string, baseDir?: string): string {
  const projectIdentity = createHash("sha256").update(projectPath).digest("hex");
  const receiptDirectory = baseDir ?? join(resolveRuntimeKilnHome(), "trust", "semantic-limitations");
  return join(receiptDirectory, `${projectIdentity}.jsonl`);
}

function readReceipts(projectPath: string, baseDir?: string): readonly unknown[] {
  const path = receiptsPath(projectPath, baseDir);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const candidate: unknown = JSON.parse(line);
        return [candidate];
      } catch {
        return [];
      }
    });
}

function appendReceipt(projectPath: string, receipt: TrustedExecutionLimitationReceipt, baseDir?: string): void {
  const path = receiptsPath(projectPath, baseDir);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flush: true });
}
