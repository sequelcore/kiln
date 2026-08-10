import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { describe, expect } from "vitest";
import {
  KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_ROUTE_ENV,
  KILN_LIVE_CODEX_TESTS_ENV,
  KILN_LIVE_CLAUDE_TESTS_ENV,
  KILN_LIVE_MANAGED_AGENT_TESTS_ENV,
  KILN_LIVE_OPENCODE_TESTS_ENV,
  KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_ROUTE_ENV,
  KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_TESTS_ENV,
  KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV,
  KILN_LIVE_OPENAI_DIRECT_TESTS_ENV,
} from "../../../../scripts/managed-agent-live-preflight.js";
import {
  defineManagedAgentInvocationRequest,
  defineManagedAgentWriteAuthority,
  defineManagedAgentWriteScope,
  type DeliberationIntent,
} from "@kilnai/core";
import type {
  ManagedAgentCapabilitySnapshotInput,
  ManagedAgentInvocationHandoffContract,
  ManagedAgentInvocationRequest,
  ManagedAgentWriteEvidence,
} from "@kilnai/core";

export {
  KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_ROUTE_ENV,
  KILN_LIVE_CODEX_TESTS_ENV,
  KILN_LIVE_CLAUDE_TESTS_ENV,
  KILN_LIVE_MANAGED_AGENT_TESTS_ENV,
  KILN_LIVE_OPENCODE_TESTS_ENV,
  KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_ROUTE_ENV,
  KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_TESTS_ENV,
  KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV,
  KILN_LIVE_OPENAI_DIRECT_TESTS_ENV,
} from "../../../../scripts/managed-agent-live-preflight.js";

export interface ManagedAgentLiveFixtureWorkspace {
  readonly workspaceRoot: string;
  readonly filePath: (relativePath: string) => string;
  readonly readFile: (relativePath: string) => Promise<string>;
  readonly writeFile: (relativePath: string, contents: string) => Promise<void>;
}

export interface ManagedAgentLiveFixtureWorkspaceOptions {
  readonly prefix: string;
  readonly files: Readonly<Record<string, string>>;
  readonly onWorkspaceCreated?: (workspace: ManagedAgentLiveFixtureWorkspace) => void | Promise<void>;
  readonly onWorkspaceCleanup?: (workspace: ManagedAgentLiveFixtureWorkspace) => void | Promise<void>;
}

export interface ManagedAgentLiveHarnessWriteRequestOptions {
  readonly invocationId: string;
  readonly workspaceRoot: string;
  readonly allowedPaths: readonly string[];
  readonly providerId?: string;
  readonly model?: string;
  readonly summary?: string;
  readonly prompt?: string;
}

export interface ManagedAgentLiveHarnessReadOnlyRequestOptions {
  readonly invocationId: string;
  readonly workspaceRoot: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly summary?: string;
  readonly prompt?: string;
  readonly handoff?: ManagedAgentInvocationHandoffContract;
  readonly deliberationIntent?: DeliberationIntent;
}

export interface ManagedAgentLiveFilesystemAndEvidenceExpectation {
  readonly workspace: ManagedAgentLiveFixtureWorkspace;
  readonly relativePath: string;
  readonly expectedContents: string;
  readonly evidence: readonly ManagedAgentWriteEvidence[];
  readonly expectedEvidenceKinds: readonly ManagedAgentWriteEvidence["kind"][];
  readonly forbiddenInlineText?: string;
}

export interface ManagedAgentLiveDurableEvidenceExpectation {
  readonly evidence: unknown;
  readonly forbiddenPaths: readonly string[];
}

type Environment = Readonly<Record<string, string | undefined>>;

const SENSITIVE_EVIDENCE_KEYS = new Set([
  "accesstoken",
  "refreshtoken",
  "apikey",
  "authorization",
  "bearertoken",
  "chatgptaccountid",
  "credentialid",
]);
const SENSITIVE_EVIDENCE_VALUE_PATTERNS = [
  /(?:access|refresh)[_-]?token\s*[:=]|api[_-]?key\s*[:=]|authorization\s*[:=]|bearer\s+[A-Za-z0-9._~+/-]+=*/iu,
  /\b(?:sk-(?:proj-|ant-)?|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{8,}\b/u,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
] as const;

export function isManagedAgentLiveTestsEnabled(env: Environment = process.env): boolean {
  return env[KILN_LIVE_MANAGED_AGENT_TESTS_ENV] === "1";
}

export function isManagedAgentProviderLiveTestsEnabled(
  providerFlagEnv: string,
  env: Environment = process.env,
): boolean {
  return isManagedAgentLiveTestsEnabled(env) && env[providerFlagEnv] === "1";
}

export function describeManagedAgentLive(name: string, factory: () => void): void {
  const describeLive = isManagedAgentLiveTestsEnabled() ? describe : describe.skip;
  describeLive(name, factory);
}

export function describeManagedAgentProviderLive(
  name: string,
  providerFlagEnv: string,
  factory: () => void,
): void {
  const describeLive = isManagedAgentProviderLiveTestsEnabled(providerFlagEnv) ? describe : describe.skip;
  describeLive(name, factory);
}

export async function withManagedAgentLiveFixtureWorkspace<T>(
  options: ManagedAgentLiveFixtureWorkspaceOptions,
  run: (workspace: ManagedAgentLiveFixtureWorkspace) => Promise<T>,
): Promise<T> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), requireRelativeSafeSegment(options.prefix)));
  const workspace = createWorkspace(workspaceRoot);

  try {
    for (const [relativePath, contents] of Object.entries(options.files)) {
      await workspace.writeFile(relativePath, contents);
    }
    await options.onWorkspaceCreated?.(workspace);
    return await run(workspace);
  } finally {
    try {
      await options.onWorkspaceCleanup?.(workspace);
    } finally {
      await removeWorkspaceWithRetry(workspaceRoot);
    }
  }
}

export function makeManagedAgentLiveHarnessWriteRequest(
  options: ManagedAgentLiveHarnessWriteRequestOptions,
): ManagedAgentInvocationRequest {
  const providerId = options.providerId ?? "live-fixture";
  const model = options.model ?? "fixture";
  return defineManagedAgentInvocationRequest({
    invocationId: options.invocationId,
    agentId: "agent-live-proof",
    parentSessionId: "session-parent",
    parentTurnId: "session-parent:turn:1",
    profile: "foundation-apply-approved-writes",
    requestedBy: "operator",
    requestSource: "manual",
    providerRoute: {
      providerId,
      surface: "cli-harness",
      model,
    },
    adapterKind: "harness",
    executionMode: "cli-harness",
    authority: {
      authorityProfileId: "foundation-apply-approved",
      permissionProfile: "apply-approved-writes",
      toolAuthority: {
        allowedToolNames: ["read", "apply-patch"],
        writeAllowed: true,
        networkAllowed: false,
      },
      workingDirectory: {
        path: options.workspaceRoot,
        mode: "workspace-write",
      },
      timeoutMs: 120000,
      credentialRoute: {
        mode: "runtime-selected",
        routeId: `credential-route:${providerId}`,
      },
      memoryScope: {
        scope: { kind: "project", id: "kiln" },
        access: "write-proposals",
      },
      writeAuthority: defineManagedAgentWriteAuthority({
        profile: "foundation-apply-approved-writes",
        scope: defineManagedAgentWriteScope({
          workspace: {
            mode: "apply-approved",
            allowedPaths: options.allowedPaths,
            deniedPaths: [join(options.workspaceRoot, ".git")],
          },
          memory: {
            mode: "propose",
            scope: { kind: "project", id: "kiln" },
            operations: ["create", "update"],
          },
          artifacts: {
            mode: "propose",
            resourceUris: [`kiln://managed-invocations/${options.invocationId}/write`],
            retention: "session",
          },
          tools: {
            allowedToolNames: ["read", "apply-patch"],
            deniedToolNames: ["git-commit"],
          },
        }),
        approval: {
          mode: "policy-approved",
          evidenceRequired: true,
          approver: "operator",
          evidenceUris: [`kiln://managed-invocations/${options.invocationId}/approval`],
        },
      }),
    },
    input: {
      summary: options.summary ?? "Apply an approved live fixture update.",
      prompt: options.prompt ?? "Apply only the approved fixture update and report evidence.",
    },
  });
}

export function makeManagedAgentLiveHarnessReadOnlyRequest(
  options: ManagedAgentLiveHarnessReadOnlyRequestOptions,
): ManagedAgentInvocationRequest {
  const providerId = options.providerId ?? "live-fixture";
  const model = options.model ?? "fixture";
  return defineManagedAgentInvocationRequest({
    invocationId: options.invocationId,
    agentId: "agent-live-proof",
    parentSessionId: "session-parent",
    parentTurnId: "session-parent:turn:1",
    profile: "foundation-readonly-plan",
    requestedBy: "operator",
    requestSource: "manual",
    providerRoute: {
      providerId,
      surface: "cli-harness",
      model,
      ...(options.deliberationIntent ? { deliberationIntent: options.deliberationIntent } : {}),
    },
    adapterKind: "harness",
    executionMode: "cli-harness",
    authority: {
      authorityProfileId: "foundation-readonly",
      permissionProfile: "read-only",
      toolAuthority: {
        allowedToolNames: ["read", "rg"],
        writeAllowed: false,
        networkAllowed: false,
      },
      workingDirectory: {
        path: options.workspaceRoot,
        mode: "read-only",
      },
      timeoutMs: 120000,
      credentialRoute: {
        mode: "runtime-selected",
        routeId: `credential-route:${providerId}`,
      },
      memoryScope: {
        scope: { kind: "project", id: "kiln" },
        access: "read-only",
      },
    },
    input: {
      summary: options.summary ?? "Inspect the live fixture without writing.",
      prompt: options.prompt ?? "Inspect the live fixture and report what would change.",
      ...(options.handoff !== undefined ? { handoff: options.handoff } : {}),
    },
  });
}

export function makeManagedAgentLiveCapabilitySnapshotInput(
  request: ManagedAgentInvocationRequest,
): ManagedAgentCapabilitySnapshotInput {
  return {
    routeId: `${request.providerRoute.providerId}-live-proof`,
    routeSource: "explicit-managed-route",
  };
}

export async function expectManagedAgentLiveFilesystemAndEvidence(
  expectation: ManagedAgentLiveFilesystemAndEvidenceExpectation,
): Promise<void> {
  await expect(expectation.workspace.readFile(expectation.relativePath)).resolves.toBe(expectation.expectedContents);
  expect(expectation.evidence.map((item) => item.kind)).toEqual(expectation.expectedEvidenceKinds);
  expect(expectation.evidence.every((item) => item.resourceUris.length > 0)).toBe(true);

  if (expectation.forbiddenInlineText !== undefined) {
    expect(JSON.stringify(expectation.evidence)).not.toContain(expectation.forbiddenInlineText);
  }
}

export function expectManagedAgentLiveDurableEvidenceSafe(
  expectation: ManagedAgentLiveDurableEvidenceExpectation,
): void {
  const observations = collectDurableEvidenceObservations(expectation.evidence);
  for (const forbiddenPath of expectation.forbiddenPaths) {
    const normalizedPath = normalizeEvidencePath(forbiddenPath);
    const leakingValues = observations.values
      .map(normalizeEvidencePath)
      .filter((value) => value.includes(normalizedPath))
      .map((value) => value.replaceAll(normalizedPath, "<forbidden-path>"));
    expect(leakingValues).toEqual([]);
  }
  expect(
    observations.keys.some((key) => SENSITIVE_EVIDENCE_KEYS.has(normalizeEvidenceKey(key))),
  ).toBe(false);
  expect(observations.values.some((value) =>
    SENSITIVE_EVIDENCE_VALUE_PATTERNS.some((pattern) => pattern.test(value)))).toBe(false);
}

function collectDurableEvidenceObservations(
  value: unknown,
): { readonly keys: string[]; readonly values: string[] } {
  const keys: string[] = [];
  const values: string[] = [];
  const pending: unknown[] = [value];
  const visited = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string") {
      values.push(current);
    } else if (Array.isArray(current)) {
      pending.push(...current);
    } else if (current !== null && typeof current === "object" && !visited.has(current)) {
      visited.add(current);
      for (const [key, entry] of Object.entries(current)) {
        keys.push(key);
        pending.push(entry);
      }
    }
  }
  return { keys, values };
}

function normalizeEvidencePath(value: string): string {
  return value.replaceAll("\\", "/").toLowerCase();
}

function normalizeEvidenceKey(value: string): string {
  return value.replace(/[^a-z0-9]/giu, "").toLowerCase();
}

function createWorkspace(workspaceRoot: string): ManagedAgentLiveFixtureWorkspace {
  return {
    workspaceRoot,
    filePath: (relativePath) => resolveInsideWorkspace(workspaceRoot, relativePath),
    readFile: async (relativePath) => readFile(resolveInsideWorkspace(workspaceRoot, relativePath), "utf8"),
    writeFile: async (relativePath, contents) => {
      await writeFile(resolveInsideWorkspace(workspaceRoot, relativePath), contents, "utf8");
    },
  };
}

function resolveInsideWorkspace(workspaceRoot: string, relativePath: string): string {
  if (isAbsolute(relativePath)) {
    throw new Error(`Live fixture paths must be relative: ${relativePath}`);
  }

  const resolvedRoot = resolve(workspaceRoot);
  const resolvedPath = resolve(resolvedRoot, relativePath);
  const workspaceRelativePath = relative(resolvedRoot, resolvedPath);
  if (workspaceRelativePath === "" || workspaceRelativePath.startsWith(`..${sep}`) || workspaceRelativePath === "..") {
    throw new Error(`Live fixture path escapes workspace: ${relativePath}`);
  }

  return resolvedPath;
}

function requireRelativeSafeSegment(value: string): string {
  if (value.trim().length === 0 || value.includes("/") || value.includes("\\")) {
    throw new Error("Live fixture workspace prefix must be a single path segment");
  }
  return value;
}

async function removeWorkspaceWithRetry(workspaceRoot: string): Promise<void> {
  const attempts = 30;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await rm(workspaceRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === attempts) {
        if (isTransientWindowsRemoveError(error)) {
          console.warn(`Live fixture cleanup left locked workspace for OS cleanup: ${workspaceRoot}`);
          return;
        }
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

function isTransientWindowsRemoveError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EBUSY" || code === "ENOTEMPTY" || code === "EPERM";
}
