import { describe, it, expect } from "vitest";
import { formatKnowledgeContext, formatContactContext, mergeContextSources, appendGroundingDirective, formatUserContext } from "../../src/gateway/context-formatter.js";
import type { ContactFact, VectorResult } from "@kilnai/core/engine";

describe("formatKnowledgeContext", () => {
  it("returns undefined for empty results", () => {
    expect(formatKnowledgeContext([])).toBeUndefined();
  });

  it("formats results with separator", () => {
    const results: VectorResult[] = [
      { id: "1", content: "chunk A", score: 0.9, metadata: {} },
      { id: "2", content: "chunk B", score: 0.8, metadata: {} },
    ];
    const formatted = formatKnowledgeContext(results);
    expect(formatted).toBe("[Knowledge context]:\nchunk A\n---\nchunk B");
  });

  it("formats single result without separator", () => {
    const results: VectorResult[] = [{ id: "1", content: "only chunk", score: 0.9, metadata: {} }];
    expect(formatKnowledgeContext(results)).toBe("[Knowledge context]:\nonly chunk");
  });
});

describe("formatContactContext", () => {
  it("returns undefined for empty facts", () => {
    expect(formatContactContext([])).toBeUndefined();
  });

  it("formats facts with line breaks", () => {
    const facts: ContactFact[] = [
      { id: "1", externalUserId: "u1", tenantId: "t1", content: "prefers email", category: "preference", confidence: 0.9, validAt: "2026-01-01", createdAt: "2026-01-01" },
      { id: "2", externalUserId: "u1", tenantId: "t1", content: "name is John", category: "entity", confidence: 0.95, validAt: "2026-01-01", createdAt: "2026-01-01" },
    ];
    const formatted = formatContactContext(facts);
    expect(formatted).toBe("--- Customer Context ---\nprefers email\nname is John\n---");
  });
});

describe("mergeContextSources", () => {
  it("returns undefined when all sources are undefined", () => {
    expect(mergeContextSources(undefined, undefined)).toBeUndefined();
  });

  it("returns single source without extra separators", () => {
    expect(mergeContextSources("knowledge")).toBe("knowledge");
  });

  it("joins multiple sources with double newline", () => {
    expect(mergeContextSources("knowledge", "contact")).toBe("knowledge\n\ncontact");
  });

  it("skips undefined sources", () => {
    expect(mergeContextSources("a", undefined, "b")).toBe("a\n\nb");
  });
});

describe("formatUserContext", () => {
  it("formats populated context as key-value lines under [User Context] header", () => {
    const result = formatUserContext({ role: "admin", name: "John" });
    expect(result).toBe("[User Context]:\nrole: admin\nname: John");
  });

  it("returns undefined for empty object", () => {
    expect(formatUserContext({})).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(formatUserContext(undefined)).toBeUndefined();
  });

  it("preserves multi-key insertion order", () => {
    const result = formatUserContext({ locale: "es", plan: "pro", company: "Acme" });
    expect(result).toBe("[User Context]:\nlocale: es\nplan: pro\ncompany: Acme");
  });
});

describe("appendGroundingDirective", () => {
  it("returns undefined when context is undefined", () => {
    expect(appendGroundingDirective(undefined, "strict")).toBeUndefined();
  });

  it("returns context unchanged when groundingMode is undefined", () => {
    expect(appendGroundingDirective("some context", undefined)).toBe("some context");
  });

  it("returns context unchanged when groundingMode is off", () => {
    expect(appendGroundingDirective("some context", "off")).toBe("some context");
  });

  it("appends grounding directive when groundingMode is strict", () => {
    const result = appendGroundingDirective("[Knowledge context]:\nchunk A", "strict");
    expect(result).toContain("[Knowledge context]:\nchunk A");
    expect(result).toContain("--- Grounding Rules ---");
    expect(result).toContain("Answer ONLY from the knowledge context");
    expect(result).toContain("Never fabricate specific data");
  });

  it("returns undefined when context is undefined even with strict mode", () => {
    expect(appendGroundingDirective(undefined, "strict")).toBeUndefined();
  });
});
