import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApprovalMemoryStore } from "../../src/wrapper/approval-memory-store.js";

describe("ApprovalMemoryStore", () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), "kiln-approval-memory-"));
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  it("persists grants and supports round-trip list()", async () => {
    const store = new ApprovalMemoryStore(projectPath);
    const granted = await store.grant({
      scope: "project",
      surface: "tool",
      selector: "Read",
      action: "allow",
      reason: "trusted reader",
    });

    expect(granted).not.toBeNull();

    const reloaded = new ApprovalMemoryStore(projectPath);
    const records = await reloaded.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe(granted?.id);
    expect(records[0]?.scope).toBe("project");
    expect(records[0]?.surface).toBe("tool");
    expect(records[0]?.selector).toBe("Read");
    expect(records[0]?.action).toBe("allow");
    expect(records[0]?.reason).toBe("trusted reader");
    expect(records[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("matches project scope approvals across sessions", async () => {
    const store = new ApprovalMemoryStore(projectPath);
    await store.grant({
      scope: "project",
      surface: "command",
      selector: "bash:git status*",
      action: "allow",
    });

    const matchA = await store.findMatch({
      surface: "command",
      selector: "bash:git status*",
      action: "allow",
      sessionId: "session-a",
    });
    const matchB = await store.findMatch({
      surface: "command",
      selector: "bash:git status*",
      action: "allow",
      sessionId: "session-b",
    });

    expect(matchA).not.toBeNull();
    expect(matchB).not.toBeNull();
    expect(matchA?.scope).toBe("project");
    expect(matchB?.scope).toBe("project");
    expect(matchA?.id).toBe(matchB?.id);
  });

  it("isolates session scope approvals to matching sessionId", async () => {
    const store = new ApprovalMemoryStore(projectPath);
    await store.grant({
      scope: "session",
      sessionId: "session-1",
      surface: "file",
      selector: "src/**/*.ts",
      action: "allow",
    });

    const sameSession = await store.findMatch({
      surface: "file",
      selector: "src/**/*.ts",
      sessionId: "session-1",
    });
    const otherSession = await store.findMatch({
      surface: "file",
      selector: "src/**/*.ts",
      sessionId: "session-2",
    });

    expect(sameSession).not.toBeNull();
    expect(sameSession?.scope).toBe("session");
    expect(otherSession).toBeNull();
  });

  it("consumes once scope approvals exactly once", async () => {
    const store = new ApprovalMemoryStore(projectPath);
    const onceGrant = await store.grant({
      scope: "once",
      surface: "destination",
      selector: "logs",
      action: "allow",
    });

    expect(onceGrant).not.toBeNull();

    const firstLookup = await store.findMatch({
      surface: "destination",
      selector: "logs",
    });
    expect(firstLookup?.id).toBe(onceGrant?.id);

    const consumed = await store.consumeOnce({
      surface: "destination",
      selector: "logs",
    });
    expect(consumed?.id).toBe(onceGrant?.id);

    const secondLookup = await store.findMatch({
      surface: "destination",
      selector: "logs",
    });
    const secondConsume = await store.consumeOnce({
      surface: "destination",
      selector: "logs",
    });
    expect(secondLookup).toBeNull();
    expect(secondConsume).toBeNull();
  });

  it("clearSession removes only matching session-scoped approvals", async () => {
    const store = new ApprovalMemoryStore(projectPath);
    const sessionOne = await store.grant({
      scope: "session",
      sessionId: "session-1",
      surface: "tool",
      selector: "Edit",
      action: "allow",
    });
    const sessionTwo = await store.grant({
      scope: "session",
      sessionId: "session-2",
      surface: "tool",
      selector: "Edit",
      action: "allow",
    });
    const projectScoped = await store.grant({
      scope: "project",
      surface: "tool",
      selector: "Write",
      action: "allow",
    });

    expect(sessionOne).not.toBeNull();
    expect(sessionTwo).not.toBeNull();
    expect(projectScoped).not.toBeNull();

    const removed = await store.clearSession("session-1");
    expect(removed).toBe(1);

    const records = await store.list();
    expect(records).toHaveLength(2);
    expect(records.some((record) => record.scope === "session" && record.sessionId === "session-1")).toBe(false);
    expect(records.some((record) => record.scope === "session" && record.sessionId === "session-2")).toBe(true);
    expect(records.some((record) => record.scope === "project" && record.selector === "Write")).toBe(true);
  });

  it("uses latest matching entry when multiple records match", async () => {
    const store = new ApprovalMemoryStore(projectPath);
    const first = await store.grant({
      scope: "project",
      surface: "tool",
      selector: "Read",
      action: "allow",
      reason: "older",
    });
    const second = await store.grant({
      scope: "project",
      surface: "tool",
      selector: "Read",
      action: "allow",
      reason: "newer",
    });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    const match = await store.findMatch({
      surface: "tool",
      selector: "Read",
      action: "allow",
    });
    expect(match?.id).toBe(second?.id);
    expect(match?.reason).toBe("newer");
  });
});
