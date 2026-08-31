import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteMemoryRepository } from "../../../src/index.js";
import {
  createManagedAgentMemoryWriteProposal,
  defineManagedAgentInvocationRequest,
  defineManagedAgentWriteAuthority,
  defineManagedAgentWriteScope,
  storeManagedAgentArtifactWriteProposal,
  type ManagedAgentInvocationRequest,
} from "@kilnai/core/agents";
import type { MemoryRepository } from "@kilnai/core/memory";
import { MemoryArtifactResourceStore } from "@kilnai/core/tools";

function makeWriteScope() {
  return defineManagedAgentWriteScope({
    workspace: {
      mode: "propose",
      allowedPaths: ["C:/workspace/kiln/packages/core/src/agents/managed-invocation"],
      deniedPaths: ["C:/workspace/kiln/.git"],
    },
    memory: {
      operations: ["create", "update"],
    },
    artifacts: {
      mode: "propose",
      resourceUris: ["kiln://artifacts/managed-agent-write-proposals"],
      retention: "session",
    },
    tools: {
      allowedToolNames: ["read", "rg"],
      deniedToolNames: ["git-commit"],
    },
  });
}

function makeRequest(overrides: Partial<ManagedAgentInvocationRequest["authority"]> = {}): ManagedAgentInvocationRequest {
  const writeAuthority = defineManagedAgentWriteAuthority({
    scope: makeWriteScope(),
    approval: {
      mode: "required-before-apply",
      evidenceRequired: true,
    },
  });
  return defineManagedAgentInvocationRequest({
    access: "propose",
    invocationId: "invocation-write-1",
    agentId: "agent-implementer",
    parentSessionId: "session-parent",
    parentTurnId: "turn-parent",
    requestedBy: "operator",
    requestSource: "manual",
    providerRoute: {
      providerId: "opencode",
      surface: "cli-harness",
      model: "sonic",
    },
    adapterKind: "harness",
    executionMode: "cli-harness",
    authority: {
      authorityProfileId: "authority:propose",
      toolAuthority: {
        allowedToolNames: ["read", "rg"],
        writeAllowed: false,
        networkAllowed: false,
      },
      workingDirectory: {
        path: "C:/workspace/kiln",
        mode: "read-only",
      },
      timeoutMs: 120000,
      credentialRoute: {
        mode: "runtime-selected",
        routeId: "credential-route:opencode:primary",
      },
      memoryScope: {
        scope: { kind: "project", id: "kiln" },
        access: "write-proposals",
      },
      writeAuthority,
      ...overrides,
    },
    input: {
      summary: "Propose governed write integration changes",
    },
  });
}

describe("managed agent governed write integration", () => {
  let tmpDir: string;
  let repository: MemoryRepository;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-managed-write-integration-"));
    repository = createSqliteMemoryRepository({ dbPath: join(tmpDir, "memory.db") });
  });

  afterEach(() => {
    repository.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("turns child memory writes into proposals without mutating durable memory", () => {
    const request = makeRequest();
    const proposal = createManagedAgentMemoryWriteProposal({
      request,
      proposalId: "memory-proposal-1",
      childSessionId: "child-session-1",
      operation: "create",
      scope: { kind: "project", id: "kiln" },
      summary: "Capture a useful managed invocation lesson.",
      evidenceUris: ["kiln://artifacts/managed-agent-write-proposals/artifact_1/content"],
      risk: {
        level: "medium",
        reasons: ["child-produced memory requires review"],
      },
      createdAt: "2026-05-04T20:00:00.000Z",
    });

    expect(proposal).toMatchObject({
      proposalId: "memory-proposal-1",
      invocationId: "invocation-write-1",
      parentSessionId: "session-parent",
      parentTurnId: "turn-parent",
      childSessionId: "child-session-1",
      target: {
        kind: "memory",
        scope: { kind: "project", id: "kiln" },
        operation: "create",
      },
      evidenceUris: ["kiln://artifacts/managed-agent-write-proposals/artifact_1/content"],
    });
    expect(repository.countRecords({ kind: "project", id: "kiln" })).toBe(0);
  });

  it("stores child artifact write proposals as linked artifacts instead of inline payload evidence", () => {
    const store = new MemoryArtifactResourceStore({
      now: () => "2026-05-04T20:01:00.000Z",
    });
    const result = storeManagedAgentArtifactWriteProposal({
      request: makeRequest(),
      artifactStore: store,
      proposalId: "artifact-proposal-1",
      childSessionId: "child-session-1",
      title: "Managed invocation patch proposal",
      content: {
        type: "text",
        text: "diff --git a/packages/core/src/example.ts b/packages/core/src/example.ts",
      },
      summary: "Store proposed patch as an artifact resource.",
      createdAt: "2026-05-04T20:01:00.000Z",
    });

    expect(result.artifactUri).toBe("kiln://artifacts/managed-agent-write-proposals/artifact_1/content");
    expect(result.proposal).toMatchObject({
      proposalId: "artifact-proposal-1",
      target: {
        kind: "artifact",
        uri: "kiln://artifacts/managed-agent-write-proposals/artifact_1/content",
      },
      evidenceUris: ["kiln://artifacts/managed-agent-write-proposals/artifact_1/content"],
    });
    expect(result.evidence).toMatchObject({
      kind: "write-proposal-created",
      proposalId: "artifact-proposal-1",
      resourceUris: ["kiln://artifacts/managed-agent-write-proposals/artifact_1/content"],
    });
    expect(JSON.stringify(result.evidence)).not.toContain("diff --git");
    expect(store.get("managed-agent-write-proposals", "artifact_1")?.content).toMatchObject({
      type: "text",
      text: expect.stringContaining("diff --git"),
    });
  });

  it("denies memory and artifact proposals outside admitted write scope", () => {
    const request = makeRequest({
      writeAuthority: defineManagedAgentWriteAuthority({
        scope: defineManagedAgentWriteScope({
          ...makeWriteScope(),
          memory: {
            operations: [],
          },
          artifacts: {
            mode: "none",
            resourceUris: [],
            retention: "none",
          },
        }),
        approval: {
          mode: "required-before-apply",
          evidenceRequired: true,
        },
      }),
      memoryScope: {
        scope: { kind: "project", id: "kiln" },
        access: "read-only",
      },
    });

    expect(() => createManagedAgentMemoryWriteProposal({
      request,
      proposalId: "memory-proposal-denied",
      operation: "create",
      scope: { kind: "project", id: "kiln" },
      summary: "Denied memory proposal",
      evidenceUris: [],
      createdAt: "2026-05-04T20:02:00.000Z",
    })).toThrow("Managed agent memory write proposals require admitted memory proposal authority");

    expect(() => storeManagedAgentArtifactWriteProposal({
      request,
      artifactStore: new MemoryArtifactResourceStore(),
      proposalId: "artifact-proposal-denied",
      title: "Denied artifact proposal",
      content: { type: "text", text: "denied" },
      summary: "Denied artifact proposal",
      createdAt: "2026-05-04T20:02:00.000Z",
    })).toThrow("Managed agent artifact write proposals require admitted artifact proposal authority");
  });
});
