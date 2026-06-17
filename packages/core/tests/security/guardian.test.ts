import { describe, it, expect, vi, beforeEach } from "vitest";
import { Guardian } from "../../src/security/guardian.js";
import { EventBus } from "../../src/events/event-bus.js";
import type { GuardianConfig } from "../../src/security/types.js";
import type { Capability } from "../../src/engine/domain/capability.js";
import type { ActionEffectEnvelope } from "../../src/engine/domain/action-effect.js";
import type { ProviderAdapter, AgentResponse } from "../../src/agents/index.js";
import { textParts } from "../../src/engine/domain/content.js";
import type { AuditLog, AuditEntry, AuditFilter, AuditChainResult } from "../../src/security/types.js";

// --- Helpers ---

const READ_ONLY_EFFECT: ActionEffectEnvelope = {
  operation: "observe",
  boundaries: ["process", "workspace"],
  reversibility: "reversible",
  dataEgress: "project-data",
  identityUse: "none",
  consequences: [],
  idempotency: "idempotent",
};

const IRREVERSIBLE_MUTATION_EFFECT: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["process", "workspace"],
  reversibility: "irreversible",
  dataEgress: "project-data",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "non-idempotent",
};

function makeConfig(overrides?: Partial<GuardianConfig>): GuardianConfig {
  return {
    enabled: true,
    reviewerTier: "fast",
    blockOnError: true,
    bypassForReadOnly: true,
    ...overrides,
  };
}

function makeDestructiveCapability(overrides?: Partial<Capability>): Capability {
  return {
    name: "delete_files",
    description: "Deletes files from the filesystem",
    schema: {},
    tags: [],
    effectEnvelope: IRREVERSIBLE_MUTATION_EFFECT,
    ...overrides,
  };
}

function makeReadOnlyCapability(): Capability {
  return {
    name: "read_file",
    description: "Reads a file from the filesystem",
    schema: {},
    tags: [],
    effectEnvelope: READ_ONLY_EFFECT,
  };
}

function makeSafeCapability(): Capability {
  return {
    name: "list_dir",
    description: "Lists directory contents",
    schema: {},
    tags: [],
    effectEnvelope: {
      ...READ_ONLY_EFFECT,
      idempotency: "conditionally-idempotent",
    },
  };
}

function makeApprovedProvider(): ProviderAdapter {
  return {
    name: "mock-provider",
    async createMessage() {
      return {
        parts: textParts(JSON.stringify({ approved: true, reason: "looks safe", riskLevel: "low" })),
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls: [],
      };
    },
    async *streamMessage() {},
  };
}

function makeDeniedProvider(): ProviderAdapter {
  return {
    name: "mock-provider",
    async createMessage() {
      return {
        parts: textParts(JSON.stringify({ approved: false, reason: "dangerous path", riskLevel: "critical" })),
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls: [],
      };
    },
    async *streamMessage() {},
  };
}

function makeErrorProvider(): ProviderAdapter {
  return {
    name: "mock-provider",
    async createMessage(): Promise<AgentResponse> {
      throw new Error("provider timeout");
    },
    async *streamMessage() {},
  };
}

function makeMalformedProvider(): ProviderAdapter {
  return {
    name: "mock-provider",
    async createMessage() {
      return {
        parts: textParts("not json at all"),
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls: [],
      };
    },
    async *streamMessage() {},
  };
}

class MockAuditLog implements AuditLog {
  readonly entries: Array<Omit<AuditEntry, "id" | "hash" | "previousHash">> = [];

  append(entry: Omit<AuditEntry, "id" | "hash" | "previousHash">): AuditEntry {
    this.entries.push(entry);
    return { ...entry, id: crypto.randomUUID() };
  }

  query(_filter: AuditFilter): readonly AuditEntry[] {
    return [];
  }

  verifyChain(): AuditChainResult {
    return { valid: true, entriesChecked: this.entries.length };
  }

  count(): number {
    return this.entries.length;
  }
}

// --- Tests ---

describe("Guardian", () => {
  describe("needsReview", () => {
    it("returns false when Guardian is disabled", () => {
      const guardian = new Guardian(makeConfig({ enabled: false }), makeApprovedProvider());
      expect(guardian.needsReview(makeDestructiveCapability())).toBe(false);
    });

    it("returns true for destructive capabilities", () => {
      const guardian = new Guardian(makeConfig(), makeApprovedProvider());
      expect(guardian.needsReview(makeDestructiveCapability())).toBe(true);
    });

    it("returns false for non-destructive capabilities", () => {
      const guardian = new Guardian(makeConfig(), makeApprovedProvider());
      expect(guardian.needsReview(makeSafeCapability())).toBe(false);
    });

    it("bypasses read-only capabilities when bypassForReadOnly is true", () => {
      const guardian = new Guardian(makeConfig({ bypassForReadOnly: true }), makeApprovedProvider());
      expect(guardian.needsReview(makeReadOnlyCapability())).toBe(false);
    });

    it("does NOT bypass read-only capabilities when bypassForReadOnly is false", () => {
      // read-only without destructive flag -> still returns false because only destructive triggers review
      const guardian = new Guardian(makeConfig({ bypassForReadOnly: false }), makeApprovedProvider());
      expect(guardian.needsReview(makeReadOnlyCapability())).toBe(false);
    });

    it("returns true for irreversible mutation effects when bypassForReadOnly is false", () => {
      const cap: Capability = {
        name: "override",
        description: "Irreversible mutation",
        schema: {},
        tags: [],
        effectEnvelope: IRREVERSIBLE_MUTATION_EFFECT,
      };
      const guardian = new Guardian(makeConfig({ bypassForReadOnly: false }), makeApprovedProvider());
      expect(guardian.needsReview(cap)).toBe(true);
    });

    it("does not bypass irreversible mutation effects when bypassForReadOnly is true", () => {
      const cap: Capability = {
        name: "override",
        description: "Irreversible mutation",
        schema: {},
        tags: [],
        effectEnvelope: IRREVERSIBLE_MUTATION_EFFECT,
      };
      const guardian = new Guardian(makeConfig({ bypassForReadOnly: true }), makeApprovedProvider());
      expect(guardian.needsReview(cap)).toBe(true);
    });
  });

  describe("review", () => {
    it("approves a destructive capability when provider returns approved", async () => {
      const guardian = new Guardian(makeConfig(), makeApprovedProvider());
      const result = await guardian.review({
        capability: makeDestructiveCapability(),
        agentName: "agent-1",
        arguments: { path: "/tmp/file.txt" },
      });

      expect(result.approved).toBe(true);
      expect(result.reason).toBe("looks safe");
      expect(result.riskLevel).toBe("low");
      expect(result.capabilityName).toBe("delete_files");
      expect(result.agentName).toBe("agent-1");
      expect(result.reviewedBy).toBe("mock-provider");
      expect(result.reviewDurationMs).toBeGreaterThanOrEqual(0);
    });

    it("blocks a destructive capability when provider returns denied", async () => {
      const guardian = new Guardian(makeConfig(), makeDeniedProvider());
      const result = await guardian.review({
        capability: makeDestructiveCapability(),
        agentName: "agent-1",
        arguments: { path: "/etc/passwd" },
      });

      expect(result.approved).toBe(false);
      expect(result.reason).toBe("dangerous path");
      expect(result.riskLevel).toBe("critical");
    });

    it("blocks on reviewer failure when blockOnError is true", async () => {
      const guardian = new Guardian(makeConfig({ blockOnError: true }), makeErrorProvider());
      const result = await guardian.review({
        capability: makeDestructiveCapability(),
        agentName: "agent-1",
        arguments: {},
      });

      expect(result.approved).toBe(false);
      expect(result.riskLevel).toBe("critical");
      expect(result.reason).toContain("unavailable");
    });

    it("allows on reviewer failure when blockOnError is false", async () => {
      const guardian = new Guardian(makeConfig({ blockOnError: false }), makeErrorProvider());
      const result = await guardian.review({
        capability: makeDestructiveCapability(),
        agentName: "agent-1",
        arguments: {},
      });

      expect(result.approved).toBe(true);
      expect(result.riskLevel).toBe("high");
      expect(result.reason).toContain("unavailable");
    });

    it("blocks on malformed provider response when blockOnError is true", async () => {
      const guardian = new Guardian(makeConfig({ blockOnError: true }), makeMalformedProvider());
      const result = await guardian.review({
        capability: makeDestructiveCapability(),
        agentName: "agent-1",
        arguments: {},
      });

      expect(result.approved).toBe(false);
      expect(result.riskLevel).toBe("critical");
    });

    it("allows on malformed provider response when blockOnError is false", async () => {
      const guardian = new Guardian(makeConfig({ blockOnError: false }), makeMalformedProvider());
      const result = await guardian.review({
        capability: makeDestructiveCapability(),
        agentName: "agent-1",
        arguments: {},
      });

      expect(result.approved).toBe(true);
      expect(result.riskLevel).toBe("high");
    });

    it("emits guardian_reviewed event with correct fields", async () => {
      const eventBus = new EventBus();
      const emitted: unknown[] = [];
      eventBus.on("guardian_reviewed", (e) => emitted.push(e));

      const guardian = new Guardian(makeConfig(), makeApprovedProvider(), eventBus);
      await guardian.review({
        capability: makeDestructiveCapability(),
        agentName: "agent-x",
        arguments: {},
        sessionId: "sess-1",
      });

      expect(emitted).toHaveLength(1);
      const event = emitted[0] as Record<string, unknown>;
      expect(event["type"]).toBe("guardian_reviewed");
      expect(event["approved"]).toBe(true);
      expect(event["capabilityName"]).toBe("delete_files");
      expect(event["agentName"]).toBe("agent-x");
      expect(event["sessionId"]).toBe("sess-1");
      expect(event["riskLevel"]).toBe("low");
    });

    it("logs destructive_approved to audit log when approved", async () => {
      const auditLog = new MockAuditLog();
      const guardian = new Guardian(makeConfig(), makeApprovedProvider(), undefined, auditLog);

      await guardian.review({
        capability: makeDestructiveCapability(),
        agentName: "agent-1",
        arguments: { path: "/tmp/x" },
        tenantId: "tenant-abc",
        sessionId: "sess-42",
      });

      expect(auditLog.entries).toHaveLength(1);
      const entry = auditLog.entries[0]!;
      expect(entry.action).toBe("destructive_approved");
      expect(entry.outcome).toBe("allowed");
      expect(entry.actor).toBe("agent-1");
      expect(entry.resource).toBe("delete_files");
      expect(entry.tenantId).toBe("tenant-abc");
      expect(entry.sessionId).toBe("sess-42");
    });

    it("logs destructive_blocked to audit log when denied", async () => {
      const auditLog = new MockAuditLog();
      const guardian = new Guardian(makeConfig(), makeDeniedProvider(), undefined, auditLog);

      await guardian.review({
        capability: makeDestructiveCapability(),
        agentName: "agent-1",
        arguments: {},
      });

      expect(auditLog.entries).toHaveLength(1);
      const entry = auditLog.entries[0]!;
      expect(entry.action).toBe("destructive_blocked");
      expect(entry.outcome).toBe("denied");
    });

    it("truncates long argument values in audit log metadata", async () => {
      const auditLog = new MockAuditLog();
      const guardian = new Guardian(makeConfig(), makeApprovedProvider(), undefined, auditLog);
      const longValue = "a".repeat(200);

      await guardian.review({
        capability: makeDestructiveCapability(),
        agentName: "agent-1",
        arguments: { payload: longValue },
      });

      const entry = auditLog.entries[0]!;
      const args = (entry.metadata as Record<string, unknown>)["arguments"] as Record<string, string>;
      expect(args["payload"]!.length).toBeLessThanOrEqual(103); // 100 + "..."
    });

    it("does not review when Guardian is disabled (needsReview returns false)", () => {
      const guardian = new Guardian(makeConfig({ enabled: false }), makeApprovedProvider());
      expect(guardian.needsReview(makeDestructiveCapability())).toBe(false);
    });
  });
});
