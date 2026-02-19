import { describe, it, expect } from "vitest";
import type { TenantConfig } from "@kilnai/core";
import { buildTenantSystemPrompt } from "../../src/tenant/system-prompt-builder.js";

function makeMinimalTenant(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    tenantId: "test-biz",
    appName: "atendia",
    name: "Test Business",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildTenantSystemPrompt", () => {
  it("includes business name in opening line", () => {
    const prompt = buildTenantSystemPrompt(makeMinimalTenant());
    expect(prompt).toContain('asistente virtual de "Test Business"');
  });

  it("includes description when present", () => {
    const prompt = buildTenantSystemPrompt(makeMinimalTenant({ description: "Premium salon" }));
    expect(prompt).toContain("Premium salon");
  });

  it("renders services with price and duration", () => {
    const prompt = buildTenantSystemPrompt(
      makeMinimalTenant({
        services: [
          { name: "Corte", price: "$150", duration: "30 min", description: "Haircut" },
        ],
      }),
    );
    expect(prompt).toContain("## Servicios");
    expect(prompt).toContain("Corte");
    expect(prompt).toContain("$150");
    expect(prompt).toContain("30 min");
    expect(prompt).toContain("Haircut");
  });

  it("renders hours section", () => {
    const prompt = buildTenantSystemPrompt(
      makeMinimalTenant({ hours: { lun: "09:00-18:00", mar: "09:00-18:00" } }),
    );
    expect(prompt).toContain("## Horarios");
    expect(prompt).toContain("lun: 09:00-18:00");
    expect(prompt).toContain("mar: 09:00-18:00");
  });

  it("renders FAQ with question and answer format", () => {
    const prompt = buildTenantSystemPrompt(
      makeMinimalTenant({
        faqEntries: [{ q: "Do you accept cards?", r: "Yes, all cards." }],
      }),
    );
    expect(prompt).toContain("## Preguntas frecuentes");
    expect(prompt).toContain("**P:** Do you accept cards?");
    expect(prompt).toContain("**R:** Yes, all cards.");
  });

  it("renders escalation contact with phone", () => {
    const prompt = buildTenantSystemPrompt(
      makeMinimalTenant({
        escalationContact: { name: "Maria Lopez", phone: "+521234567890" },
      }),
    );
    expect(prompt).toContain("Maria Lopez");
    expect(prompt).toContain("+521234567890");
  });

  it("renders escalation contact with email", () => {
    const prompt = buildTenantSystemPrompt(
      makeMinimalTenant({
        escalationContact: { name: "Maria", email: "maria@example.com" },
      }),
    );
    expect(prompt).toContain("<maria@example.com>");
  });

  it("uses formal tone instruction when tone is formal", () => {
    const prompt = buildTenantSystemPrompt(makeMinimalTenant({ tone: "formal" }));
    expect(prompt).toContain("formal y profesional");
  });

  it("uses casual tone instruction when tone is casual", () => {
    const prompt = buildTenantSystemPrompt(makeMinimalTenant({ tone: "casual" }));
    expect(prompt).toContain("casual y relajado");
  });

  it("uses friendly tone by default", () => {
    const prompt = buildTenantSystemPrompt(makeMinimalTenant());
    expect(prompt).toContain("amigable y cercano");
  });

  it("defaults to es-MX language", () => {
    const prompt = buildTenantSystemPrompt(makeMinimalTenant());
    expect(prompt).toContain("es-MX");
  });

  it("uses custom language when provided", () => {
    const prompt = buildTenantSystemPrompt(makeMinimalTenant({ language: "es-AR" }));
    expect(prompt).toContain("es-AR");
  });

  it("includes instruction to not fabricate information", () => {
    const prompt = buildTenantSystemPrompt(makeMinimalTenant());
    expect(prompt).toContain("No inventes");
  });
});
