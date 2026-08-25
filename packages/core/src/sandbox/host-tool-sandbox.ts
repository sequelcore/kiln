import { createHash } from "node:crypto";
import type { FsPolicy, NetPolicy } from "./index.js";
import { SandboxPolicy } from "./policies.js";

type Digest = `sha256:${string}`;

export interface BoundHostToolSandboxAdmission {
  readonly schemaRevision: 1;
  readonly sandboxId: Digest;
  readonly leaseId: string;
  readonly configurationRevisionId: Digest;
  readonly permissionPolicyDigest: Digest;
  readonly policyDigest: Digest;
  readonly fsPolicy: FsPolicy;
  readonly netPolicy: NetPolicy;
  readonly allowedPathCount: number;
  readonly deniedPathCount: number;
  readonly allowedDomainCount: number;
}

export interface BoundHostToolSandbox {
  readonly policy: SandboxPolicy;
  readonly admission: BoundHostToolSandboxAdmission;
}

const boundSandboxes = new WeakMap<object, BoundHostToolSandboxAdmission>();

/** Creates the process-local capability that proves one exact host sandbox policy. */
export function createBoundHostToolSandbox(input: {
  readonly policy: SandboxPolicy;
  readonly leaseId: string;
  readonly configurationRevisionId: Digest;
  readonly permissionPolicyDigest: Digest;
}): BoundHostToolSandbox {
  if (!(input.policy instanceof SandboxPolicy)) throw new TypeError("A SandboxPolicy is required for host binding.");
  const leaseId = required(input.leaseId, "leaseId");
  const configurationRevisionId = digest(input.configurationRevisionId, "configurationRevisionId");
  const permissionPolicyDigest = digest(input.permissionPolicyDigest, "permissionPolicyDigest");
  const config = input.policy.config;
  const policyDigest = hash({
    projectPath: input.policy.projectPath,
    config,
  });
  const body = {
    schemaRevision: 1 as const,
    leaseId,
    configurationRevisionId,
    permissionPolicyDigest,
    policyDigest,
    fsPolicy: config.fsPolicy,
    netPolicy: config.netPolicy,
    allowedPathCount: config.allowedPaths.length,
    deniedPathCount: config.deniedPaths.length,
    allowedDomainCount: config.allowedDomains.length,
  };
  const admission = Object.freeze({ sandboxId: hash(body), ...body });
  const sandbox = Object.freeze({ policy: input.policy, admission });
  boundSandboxes.set(sandbox, admission);
  return sandbox;
}

/** Rejects plain objects and any capability whose exact policy evidence changed. */
export function assertBoundHostToolSandbox(value: unknown): BoundHostToolSandbox {
  if (value === null || typeof value !== "object") throw new TypeError("A bound host tool sandbox is required.");
  const admission = boundSandboxes.get(value);
  if (!admission) throw new TypeError("A bound host tool sandbox is required.");
  const sandbox = value as BoundHostToolSandbox;
  if (sandbox.admission !== admission || !(sandbox.policy instanceof SandboxPolicy)) {
    throw new TypeError("Bound host tool sandbox evidence does not match its process-local capability.");
  }
  const currentPolicyDigest = hash({
    projectPath: sandbox.policy.projectPath,
    config: sandbox.policy.config,
  });
  if (currentPolicyDigest !== admission.policyDigest) {
    throw new TypeError("Bound host tool sandbox policy changed after admission.");
  }
  return sandbox;
}

function hash(value: unknown): Digest {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function digest(value: string, label: string): Digest {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) throw new TypeError(`${label} must be a SHA-256 digest.`);
  return value as Digest;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${label} must be non-empty.`);
  return normalized;
}
