import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { describe, expect } from "vitest";
import {
  defineManagedAgentInvocationRequest,
  defineManagedAgentWriteAuthority,
  defineManagedAgentWriteScope,
} from "@kilnai/core";
import type {
  ManagedAgentInvocationRequest,
  ManagedAgentWriteEvidence,
} from "@kilnai/core";

export const KILN_LIVE_MANAGED_AGENT_TESTS_ENV = "KILN_LIVE_MANAGED_AGENT_TESTS";

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
}

export interface ManagedAgentLiveHarnessWriteRequestOptions {
  readonly invocationId: string;
  readonly workspaceRoot: string;
  readonly allowedPaths: readonly string[];
}

export interface ManagedAgentLiveFilesystemAndEvidenceExpectation {
  readonly workspace: ManagedAgentLiveFixtureWorkspace;
  readonly relativePath: string;
  readonly expectedContents: string;
  readonly evidence: readonly ManagedAgentWriteEvidence[];
  readonly expectedEvidenceKinds: readonly ManagedAgentWriteEvidence["kind"][];
  readonly forbiddenInlineText?: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

export function isManagedAgentLiveTestsEnabled(env: Environment = process.env): boolean {
  return env[KILN_LIVE_MANAGED_AGENT_TESTS_ENV] === "1";
}

export function describeManagedAgentLive(name: string, factory: () => void): void {
  const describeLive = isManagedAgentLiveTestsEnabled() ? describe : describe.skip;
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
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

export function makeManagedAgentLiveHarnessWriteRequest(
  options: ManagedAgentLiveHarnessWriteRequestOptions,
): ManagedAgentInvocationRequest {
  return defineManagedAgentInvocationRequest({
    invocationId: options.invocationId,
    agentId: "agent-live-proof",
    parentSessionId: "session-parent",
    parentTurnId: "session-parent:turn:1",
    profile: "foundation-apply-approved-writes",
    requestedBy: "operator",
    requestSource: "manual",
    providerRoute: {
      providerId: "live-fixture",
      surface: "cli-harness",
      model: "fixture",
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
        routeId: "credential-route:live-fixture",
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
      summary: "Apply an approved live fixture update.",
      prompt: "Apply only the approved fixture update and report evidence.",
    },
  });
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
