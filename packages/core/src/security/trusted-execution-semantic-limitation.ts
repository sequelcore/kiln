import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TrustedExecutionHarness } from "./trusted-execution-authorization-store.js";

export interface TrustedExecutionSemanticLimitation {
  readonly id: string;
  readonly harness: TrustedExecutionHarness;
  readonly message: string;
  readonly sourceUrl: string;
  readonly upstreamRevision: string;
  readonly sourceDigest: `sha256:${string}`;
  readonly observedAt: string;
  readonly reviewAfter: string;
}

/**
 * The 90-day review date is deliberate: the source was checked on 2026-08-13
 * and must be re-evidenced before 2026-11-13, even if an operator accepted it.
 */
export const OPENCODE_NO_FILESYSTEM_SANDBOX: TrustedExecutionSemanticLimitation = {
  id: "opencode.no-filesystem-sandbox",
  harness: "opencode",
  message: "OpenCode has no agent filesystem sandbox; its permission prompts are not security isolation.",
  sourceUrl: "https://github.com/anomalyco/opencode/blob/e4b548fa768a59cea7e5c8279e327d990cd36c27/SECURITY.md",
  upstreamRevision: "e4b548fa768a59cea7e5c8279e327d990cd36c27",
  sourceDigest: "sha256:25d6b5b174c7b6728da5df12d1befbc714394da55950ebfd9b1922ea953ce417",
  observedAt: "2026-08-13T00:00:00.000Z",
  reviewAfter: "2026-11-13T00:00:00.000Z",
};

export const TRUSTED_EXECUTION_SEMANTIC_LIMITATIONS = [OPENCODE_NO_FILESYSTEM_SANDBOX] as const;

export interface TrustedExecutionLimitationAcceptance {
  readonly limitationId: string;
  readonly harness: TrustedExecutionHarness;
  readonly sourceUrl: string;
  readonly upstreamRevision: string;
  readonly sourceDigest: `sha256:${string}`;
  readonly acceptedBy: string;
  readonly acceptedAt: string;
  readonly reviewAfter: string;
  readonly revocable: true;
}

type Receipt =
  | { readonly kind: "accept"; readonly acceptance: TrustedExecutionLimitationAcceptance }
  | { readonly kind: "revoke"; readonly limitationId: string; readonly harness: TrustedExecutionHarness; readonly revokedAt: string; readonly revokedBy: string };

function requireDate(value: string, name: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${name} must be an ISO timestamp.`);
}

export function validateTrustedExecutionSemanticLimitation(value: TrustedExecutionSemanticLimitation): TrustedExecutionSemanticLimitation {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(value.id)) throw new Error("Limitation id must be stable and namespaced.");
  if (!value.message || !value.sourceUrl.startsWith("https://") || !/^[0-9a-f]{40}$/.test(value.upstreamRevision)
    || !/^sha256:[a-f0-9]{64}$/.test(value.sourceDigest)) throw new Error("Limitation evidence is malformed.");
  requireDate(value.observedAt, "observedAt"); requireDate(value.reviewAfter, "reviewAfter");
  if (Date.parse(value.reviewAfter) <= Date.parse(value.observedAt)) throw new Error("reviewAfter must follow observedAt.");
  return value;
}

export function validateTrustedExecutionLimitationAcceptance(
  descriptor: TrustedExecutionSemanticLimitation,
  value: TrustedExecutionLimitationAcceptance,
  now = new Date().toISOString(),
): TrustedExecutionLimitationAcceptance {
  validateTrustedExecutionSemanticLimitation(descriptor);
  if (value.limitationId !== descriptor.id || value.harness !== descriptor.harness || value.sourceUrl !== descriptor.sourceUrl
    || value.upstreamRevision !== descriptor.upstreamRevision || value.sourceDigest !== descriptor.sourceDigest
    || !value.acceptedBy || value.revocable !== true) throw new Error("Acceptance does not exactly bind the current limitation evidence.");
  requireDate(value.acceptedAt, "acceptedAt"); requireDate(value.reviewAfter, "reviewAfter"); requireDate(now, "now");
  if (Date.parse(value.acceptedAt) > Date.parse(now)) throw new Error("acceptedAt cannot be in the future.");
  if (Date.parse(value.reviewAfter) <= Date.parse(value.acceptedAt)) throw new Error("Acceptance reviewAfter must follow acceptedAt.");
  if (Date.parse(value.reviewAfter) > Date.parse(descriptor.reviewAfter)) throw new Error("Acceptance reviewAfter cannot outlive descriptor reviewAfter.");
  return value;
}

const DEFAULT_TRUST_DIR = join(homedir(), ".kiln", "trust", "semantic-limitations");
function receiptsPath(projectPath: string, baseDir?: string): string {
  const projectIdentity = createHash("sha256").update(projectPath).digest("hex");
  return join(baseDir ?? DEFAULT_TRUST_DIR, `${projectIdentity}.jsonl`);
}

function readReceipts(projectPath: string, baseDir?: string): readonly Receipt[] {
  const path = receiptsPath(projectPath, baseDir);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((line) => {
    try {
      const candidate = JSON.parse(line) as Receipt;
      return candidate && (candidate.kind === "accept" || candidate.kind === "revoke") ? [candidate] : [];
    } catch { return []; }
  });
}

function appendReceipt(projectPath: string, receipt: Receipt, baseDir?: string): void {
  const path = receiptsPath(projectPath, baseDir);
  mkdirSync(join(path, ".."), { recursive: true });
  // One append-only JSONL receipt avoids read/modify/write races and never records the project path in content.
  appendFileSync(path, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flush: true });
}

export function acceptTrustedExecutionSemanticLimitation(input: {
  readonly projectPath: string; readonly descriptor: TrustedExecutionSemanticLimitation; readonly acceptedBy: string; readonly acceptedAt: string; readonly reviewAfter: string; readonly baseDir?: string;
}): TrustedExecutionLimitationAcceptance {
  const acceptance = validateTrustedExecutionLimitationAcceptance(input.descriptor, {
    limitationId: input.descriptor.id, harness: input.descriptor.harness, sourceUrl: input.descriptor.sourceUrl,
    upstreamRevision: input.descriptor.upstreamRevision, sourceDigest: input.descriptor.sourceDigest,
    acceptedBy: input.acceptedBy, acceptedAt: input.acceptedAt, reviewAfter: input.reviewAfter, revocable: true,
  });
  appendReceipt(input.projectPath, { kind: "accept", acceptance }, input.baseDir);
  return acceptance;
}

export function revokeTrustedExecutionSemanticLimitation(input: {
  readonly projectPath: string; readonly descriptor: TrustedExecutionSemanticLimitation; readonly revokedBy: string; readonly revokedAt: string; readonly baseDir?: string;
}): boolean {
  const current = readTrustedExecutionSemanticLimitationAcceptance(input.projectPath, input.descriptor, input.revokedAt, input.baseDir);
  if (!current) return false;
  requireDate(input.revokedAt, "revokedAt");
  if (!input.revokedBy) throw new Error("revokedBy is required.");
  appendReceipt(input.projectPath, { kind: "revoke", limitationId: input.descriptor.id, harness: input.descriptor.harness, revokedAt: input.revokedAt, revokedBy: input.revokedBy }, input.baseDir);
  return true;
}

export function readTrustedExecutionSemanticLimitationAcceptance(
  projectPath: string, descriptor: TrustedExecutionSemanticLimitation, now = new Date().toISOString(), baseDir?: string,
): TrustedExecutionLimitationAcceptance | undefined {
  validateTrustedExecutionSemanticLimitation(descriptor); requireDate(now, "now");
  let latest: Receipt | undefined;
  for (const receipt of readReceipts(projectPath, baseDir)) {
    const harness = receipt.kind === "revoke" ? receipt.harness : receipt.acceptance.harness;
    const limitationId = receipt.kind === "revoke" ? receipt.limitationId : receipt.acceptance.limitationId;
    if (harness === descriptor.harness && limitationId === descriptor.id) latest = receipt;
  }
  if (!latest || latest.kind !== "accept") return undefined;
  try { validateTrustedExecutionLimitationAcceptance(descriptor, latest.acceptance, now); } catch { return undefined; }
  return Date.parse(now) <= Date.parse(latest.acceptance.reviewAfter) ? latest.acceptance : undefined;
}
