import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync, writeFileSync } from "node:fs";
import { JsonlAuditLog } from "../../src/security/audit-log.js";
import type { AuditEntry } from "../../src/security/types.js";

describe("JsonlAuditLog", () => {
  let tempDir: string;
  let logPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-audit-"));
    logPath = join(tempDir, "audit.jsonl");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createLog(options?: { hashChaining?: boolean }): JsonlAuditLog {
    return new JsonlAuditLog(logPath, options);
  }

  function makeEntry(overrides?: Partial<Omit<AuditEntry, "id" | "hash" | "previousHash">>) {
    return {
      timestamp: new Date("2026-01-15T10:00:00Z"),
      action: "capability_executed" as const,
      actor: "agent-1",
      resource: "read_file",
      outcome: "allowed" as const,
      ...overrides,
    };
  }

  describe("append", () => {
    it("appends an entry and assigns id + hash", () => {
      const log = createLog();
      const entry = log.append(makeEntry());

      expect(entry.id).toBeDefined();
      expect(entry.hash).toBeDefined();
      expect(entry.previousHash).toBe("genesis");
      expect(entry.action).toBe("capability_executed");
      expect(entry.actor).toBe("agent-1");
    });

    it("chains hashes across entries", () => {
      const log = createLog();
      const first = log.append(makeEntry());
      const second = log.append(makeEntry({ actor: "agent-2" }));

      expect(second.previousHash).toBe(first.hash);
      expect(second.hash).not.toBe(first.hash);
    });

    it("persists entries to JSONL file", () => {
      const log = createLog();
      log.append(makeEntry());
      log.append(makeEntry({ actor: "agent-2" }));

      const content = readFileSync(logPath, "utf-8").trim();
      const lines = content.split("\n");
      expect(lines).toHaveLength(2);

      const parsed = JSON.parse(lines[0]!);
      expect(parsed.action).toBe("capability_executed");
      expect(parsed.actor).toBe("agent-1");
    });

    it("includes optional metadata", () => {
      const log = createLog();
      const entry = log.append(makeEntry({
        metadata: { toolArgs: { path: "/tmp/test.txt" } },
        tenantId: "tenant-123",
        sessionId: "session-456",
      }));

      expect(entry.metadata).toEqual({ toolArgs: { path: "/tmp/test.txt" } });
      expect(entry.tenantId).toBe("tenant-123");
      expect(entry.sessionId).toBe("session-456");
    });

    it("increments count", () => {
      const log = createLog();
      expect(log.count()).toBe(0);
      log.append(makeEntry());
      expect(log.count()).toBe(1);
      log.append(makeEntry());
      expect(log.count()).toBe(2);
    });

    it("works without hash chaining", () => {
      const log = createLog({ hashChaining: false });
      const entry = log.append(makeEntry());

      expect(entry.hash).toBeUndefined();
      expect(entry.previousHash).toBeUndefined();
    });
  });

  describe("query", () => {
    it("returns all entries with empty filter", () => {
      const log = createLog();
      log.append(makeEntry({ actor: "a" }));
      log.append(makeEntry({ actor: "b" }));
      log.append(makeEntry({ actor: "c" }));

      const results = log.query({});
      expect(results).toHaveLength(3);
    });

    it("filters by action", () => {
      const log = createLog();
      log.append(makeEntry({ action: "capability_executed" }));
      log.append(makeEntry({ action: "injection_detected" }));
      log.append(makeEntry({ action: "capability_executed" }));

      const results = log.query({ action: "injection_detected" });
      expect(results).toHaveLength(1);
      expect(results[0]!.action).toBe("injection_detected");
    });

    it("filters by actor", () => {
      const log = createLog();
      log.append(makeEntry({ actor: "agent-1" }));
      log.append(makeEntry({ actor: "agent-2" }));
      log.append(makeEntry({ actor: "agent-1" }));

      const results = log.query({ actor: "agent-2" });
      expect(results).toHaveLength(1);
    });

    it("filters by tenantId", () => {
      const log = createLog();
      log.append(makeEntry({ tenantId: "t1" }));
      log.append(makeEntry({ tenantId: "t2" }));
      log.append(makeEntry({ tenantId: "t1" }));

      const results = log.query({ tenantId: "t1" });
      expect(results).toHaveLength(2);
    });

    it("filters by outcome", () => {
      const log = createLog();
      log.append(makeEntry({ outcome: "allowed" }));
      log.append(makeEntry({ outcome: "denied" }));
      log.append(makeEntry({ outcome: "error" }));

      const results = log.query({ outcome: "denied" });
      expect(results).toHaveLength(1);
      expect(results[0]!.outcome).toBe("denied");
    });

    it("filters by date range", () => {
      const log = createLog();
      log.append(makeEntry({ timestamp: new Date("2026-01-10T00:00:00Z") }));
      log.append(makeEntry({ timestamp: new Date("2026-01-15T00:00:00Z") }));
      log.append(makeEntry({ timestamp: new Date("2026-01-20T00:00:00Z") }));

      const results = log.query({
        since: new Date("2026-01-12T00:00:00Z"),
        until: new Date("2026-01-17T00:00:00Z"),
      });
      expect(results).toHaveLength(1);
    });

    it("respects limit", () => {
      const log = createLog();
      log.append(makeEntry({ actor: "a" }));
      log.append(makeEntry({ actor: "b" }));
      log.append(makeEntry({ actor: "c" }));

      const results = log.query({ limit: 2 });
      expect(results).toHaveLength(2);
      expect(results[0]!.actor).toBe("a");
      expect(results[1]!.actor).toBe("b");
    });

    it("combines multiple filters", () => {
      const log = createLog();
      log.append(makeEntry({ actor: "agent-1", outcome: "allowed" }));
      log.append(makeEntry({ actor: "agent-1", outcome: "denied" }));
      log.append(makeEntry({ actor: "agent-2", outcome: "denied" }));

      const results = log.query({ actor: "agent-1", outcome: "denied" });
      expect(results).toHaveLength(1);
    });
  });

  describe("verifyChain", () => {
    it("verifies empty log", () => {
      const log = createLog();
      const result = log.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.entriesChecked).toBe(0);
    });

    it("verifies single entry", () => {
      const log = createLog();
      log.append(makeEntry());
      const result = log.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.entriesChecked).toBe(1);
    });

    it("verifies multi-entry chain", () => {
      const log = createLog();
      log.append(makeEntry({ actor: "a" }));
      log.append(makeEntry({ actor: "b" }));
      log.append(makeEntry({ actor: "c" }));

      const result = log.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.entriesChecked).toBe(3);
    });

    it("detects tampered entry", () => {
      const log = createLog();
      log.append(makeEntry({ actor: "a" }));
      log.append(makeEntry({ actor: "b" }));
      log.append(makeEntry({ actor: "c" }));

      // Tamper with middle entry
      const content = readFileSync(logPath, "utf-8");
      const lines = content.trim().split("\n");
      const parsed = JSON.parse(lines[1]!) as Record<string, unknown>;
      parsed["actor"] = "TAMPERED";
      lines[1] = JSON.stringify(parsed);
      writeFileSync(logPath, lines.join("\n") + "\n", "utf-8");

      // Create new log instance to read tampered file
      const verifyLog = createLog();
      const result = verifyLog.verifyChain();
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(1);
      expect(result.error).toContain("hash mismatch");
    });

    it("detects broken chain link (modified previousHash)", () => {
      const log = createLog();
      log.append(makeEntry({ actor: "a" }));
      log.append(makeEntry({ actor: "b" }));

      // Tamper with previousHash
      const content = readFileSync(logPath, "utf-8");
      const lines = content.trim().split("\n");
      const parsed = JSON.parse(lines[1]!) as Record<string, unknown>;
      parsed["previousHash"] = "fake-hash";
      lines[1] = JSON.stringify(parsed);
      writeFileSync(logPath, lines.join("\n") + "\n", "utf-8");

      const verifyLog = createLog();
      const result = verifyLog.verifyChain();
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(1);
      expect(result.error).toContain("previousHash mismatch");
    });

    it("verifies partial range", () => {
      const log = createLog();
      log.append(makeEntry({ actor: "a" }));
      log.append(makeEntry({ actor: "b" }));
      log.append(makeEntry({ actor: "c" }));
      log.append(makeEntry({ actor: "d" }));

      const result = log.verifyChain(1, 2);
      expect(result.valid).toBe(true);
      expect(result.entriesChecked).toBe(2);
    });

    it("returns true when hash chaining is disabled", () => {
      const log = createLog({ hashChaining: false });
      log.append(makeEntry());
      log.append(makeEntry());

      const result = log.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.entriesChecked).toBe(0);
    });
  });

  describe("persistence", () => {
    it("loads state from existing file", () => {
      const log1 = createLog();
      log1.append(makeEntry({ actor: "a" }));
      const second = log1.append(makeEntry({ actor: "b" }));

      // Create new instance pointing at same file
      const log2 = createLog();
      expect(log2.count()).toBe(2);

      // New entry should chain from the second entry's hash
      const third = log2.append(makeEntry({ actor: "c" }));
      expect(third.previousHash).toBe(second.hash);

      // Verify full chain
      const result = log2.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.entriesChecked).toBe(3);
    });
  });

  describe("all AuditAction values", () => {
    const actions = [
      "capability_executed",
      "destructive_blocked",
      "destructive_approved",
      "injection_detected",
      "injection_cleared",
      "secret_accessed",
      "secret_rotated",
      "tenant_created",
      "tenant_updated",
      "tenant_deleted",
      "memory_accessed",
      "memory_denied",
      "session_started",
      "session_ended",
      "config_changed",
      "self_audit_completed",
    ] as const;

    for (const action of actions) {
      it(`stores and retrieves action "${action}"`, () => {
        const log = createLog();
        const entry = log.append(makeEntry({ action }));
        expect(entry.action).toBe(action);

        const results = log.query({ action });
        expect(results).toHaveLength(1);
      });
    }
  });
});
