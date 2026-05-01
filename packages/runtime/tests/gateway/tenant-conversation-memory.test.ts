import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "@kilnai/core";
import {
  createTenantConversationMemoryRepository,
  TenantConversationMemory,
} from "../../src/gateway/tenant-conversation-memory.js";

describe("TenantConversationMemory", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function createTempBasePath(): string {
    const dir = mkdtempSync(join(tmpdir(), "kiln-tenant-memory-"));
    tempDirs.push(dir);
    return dir;
  }

  it("stores gateway exchanges as governed episodic tenant memory", async () => {
    const basePath = createTempBasePath();
    const repository = createTenantConversationMemoryRepository(basePath);
    const memory = new TenantConversationMemory({ repository });

    const id = memory.saveExchange({
      appName: "support",
      channel: "whatsapp",
      tenantId: "tenant-a",
      participantId: "+155501",
      userMessage: "I prefer morning delivery",
      assistantMessage: "I noted morning delivery.",
    });

    const record = repository.getRecord(id);
    expect(record).toMatchObject({
      layer: "episodic",
      scope: { kind: "tenant", id: "tenant-a" },
      tags: ["channel:whatsapp", "app:support", "participant:+155501"],
      provenance: {
        sourceType: "gateway_app",
        sourceId: "support:whatsapp",
        actor: "+155501",
      },
    });
    expect(record?.content).toContain("User: I prefer morning delivery");

    repository.close();
  });

  it("recalls only the participant memory inside the tenant scope", async () => {
    const basePath = createTempBasePath();
    const repository = createTenantConversationMemoryRepository(basePath);
    const memory = new TenantConversationMemory({ repository });

    memory.saveExchange({
      appName: "support",
      channel: "email",
      tenantId: "tenant-a",
      participantId: "customer@example.com",
      userMessage: "Please keep invoices under accounting",
      assistantMessage: "Accounting preference saved.",
    });
    memory.saveExchange({
      appName: "support",
      channel: "email",
      tenantId: "tenant-b",
      participantId: "customer@example.com",
      userMessage: "Tenant B private note",
      assistantMessage: "Tenant B response.",
    });
    memory.saveExchange({
      appName: "support",
      channel: "email",
      tenantId: "tenant-a",
      participantId: "other@example.com",
      userMessage: "Other participant private note",
      assistantMessage: "Other response.",
    });

    const recalled = memory.recall({
      tenantId: "tenant-a",
      participantId: "customer@example.com",
      query: "invoice accounting",
      tokenBudget: 80,
    });

    expect(recalled).toContain("Please keep invoices under accounting");
    expect(recalled).not.toContain("Tenant B private note");
    expect(recalled).not.toContain("Other participant private note");

    repository.close();
  });

  it("emits memory mutation events through the governed service", () => {
    const basePath = createTempBasePath();
    const repository = createTenantConversationMemoryRepository(basePath);
    const eventBus = new EventBus();
    const events: string[] = [];
    eventBus.onAny((event) => events.push(event.type));
    const memory = new TenantConversationMemory({ repository, eventBus });

    memory.saveExchange({
      appName: "support",
      channel: "messenger",
      tenantId: "tenant-a",
      participantId: "psid-1",
      userMessage: "Hello",
      assistantMessage: "Hi",
    });

    expect(events).toEqual(["memory_record_created"]);

    repository.close();
  });
});
