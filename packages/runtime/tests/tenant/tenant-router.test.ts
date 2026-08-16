import { describe, it, expect, vi } from "vitest";
import type { AgentRAG } from "@kilnai/core/agents";
import { type TenantAgentConfig, textParts } from "@kilnai/core/engine";
import { DefaultTenantRouter, EmbeddingTenantRouter } from "../../src/tenant/tenant-router.js";

describe("DefaultTenantRouter", () => {
  describe("regex rule matching", () => {
    it("basic regex match routes to correct agent", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "sales", agent: "sales-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts("I want to talk to sales"));
      expect(result.agentId).toBe("sales-agent");
    });

    it("case-insensitive matching", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "sales", agent: "sales-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts("SALES please"));
      expect(result.agentId).toBe("sales-agent");
    });

    it("first match wins when multiple rules match", () => {
      const router = new DefaultTenantRouter({
        rules: [
          { match: "help", agent: "support-agent" },
          { match: "help", agent: "faq-agent" },
        ],
        fallback: "default-agent",
      });
      const result = router.route(textParts("I need help"));
      expect(result.agentId).toBe("support-agent");
    });

    it("multiple rules, second one matches", () => {
      const router = new DefaultTenantRouter({
        rules: [
          { match: "billing", agent: "billing-agent" },
          { match: "support", agent: "support-agent" },
        ],
        fallback: "default-agent",
      });
      const result = router.route(textParts("I need support"));
      expect(result.agentId).toBe("support-agent");
    });

    it("complex pattern: multi-word regex", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "book.*appointment", agent: "booking-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts("I want to book an appointment"));
      expect(result.agentId).toBe("booking-agent");
    });

    it("regex with special chars (word boundary)", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "\\bprice\\b", agent: "pricing-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts("What is the price?"));
      expect(result.agentId).toBe("pricing-agent");
    });

    it("pattern with | alternation", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "refund|return|exchange", agent: "returns-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts("I need a return"));
      expect(result.agentId).toBe("returns-agent");
    });

    it("pattern with quantifiers (.*pricing.*)", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: ".*pricing.*", agent: "pricing-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts("tell me about your pricing plans"));
      expect(result.agentId).toBe("pricing-agent");
    });

    it("long message matches rule in middle of text", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "billing", agent: "billing-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(
        textParts("Hello, I have a question. It is about billing for my account. Can you help?"),
      );
      expect(result.agentId).toBe("billing-agent");
    });

    it("unicode text in message (accented chars)", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "facturación", agent: "billing-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts("Necesito ayuda con facturación"));
      expect(result.agentId).toBe("billing-agent");
    });
  });

  describe("fallback behavior", () => {
    it("no match falls to fallback", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "sales", agent: "sales-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts("hello there"));
      expect(result.agentId).toBe("default-agent");
    });

    it("empty rules array falls to fallback immediately", () => {
      const router = new DefaultTenantRouter({
        rules: [],
        fallback: "default-agent",
      });
      const result = router.route(textParts("anything"));
      expect(result.agentId).toBe("default-agent");
    });

    it("no rules key falls to fallback immediately", () => {
      const router = new DefaultTenantRouter({
        fallback: "default-agent",
      });
      const result = router.route(textParts("anything"));
      expect(result.agentId).toBe("default-agent");
    });

    it("empty message text falls to fallback", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "sales", agent: "sales-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts(""));
      expect(result.agentId).toBe("default-agent");
    });
  });

  describe("invalid regex handling", () => {
    it("invalid regex in rules is skipped (fail-open), continues to next rule", () => {
      const router = new DefaultTenantRouter({
        rules: [
          { match: "[invalid(", agent: "broken-agent" },
          { match: "support", agent: "support-agent" },
        ],
        fallback: "default-agent",
      });
      const result = router.route(textParts("I need support"));
      expect(result.agentId).toBe("support-agent");
    });

    it("mixed valid/invalid regex rules: invalid skipped, valid evaluated", () => {
      const router = new DefaultTenantRouter({
        rules: [
          { match: "(?invalid", agent: "bad-agent" },
          { match: "sales", agent: "sales-agent" },
          { match: "[broken", agent: "another-bad-agent" },
        ],
        fallback: "default-agent",
      });
      const result = router.route(textParts("sales question"));
      expect(result.agentId).toBe("sales-agent");
    });
  });

  describe("routing result shape", () => {
    it("has tier 'rule' for matched rule", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "sales", agent: "sales-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts("sales"));
      expect(result.tier).toBe("rule");
    });

    it("has tier 'fallback' for unmatched", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "sales", agent: "sales-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts("hello"));
      expect(result.tier).toBe("fallback");
    });

    it("includes matchedPattern for matched rule", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "book.*appointment", agent: "booking-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts("I want to book an appointment"));
      expect(result.matchedPattern).toBe("book.*appointment");
    });

    it("omits matchedPattern for fallback", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "sales", agent: "sales-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts("hello"));
      expect(result.matchedPattern).toBeUndefined();
    });
  });
});

describe("EmbeddingTenantRouter", () => {
  const agents: TenantAgentConfig[] = [
    { id: "sales", name: "Sales", role: "seller", goal: "sell" },
    { id: "support", name: "Support", role: "helper", goal: "help", isDefault: true },
  ];

  function createRouter(
    overrides: {
      rules?: { match: string; agent: string }[];
      fallback?: string;
      embeddingThreshold?: number;
    } = {},
    agentRag?: AgentRAG,
  ) {
    const mockRag = agentRag ?? ({ selectAgent: vi.fn() } as unknown as AgentRAG);
    const config = {
      rules: overrides.rules ?? [],
      fallback: overrides.fallback ?? "support",
      embeddingThreshold: overrides.embeddingThreshold,
    };
    return { router: new EmbeddingTenantRouter(config, mockRag, agents), mockRag };
  }

  it("Tier 1 regex match skips embedding", async () => {
    const mockAgentRag = { selectAgent: vi.fn() } as unknown as AgentRAG;
    const { router } = createRouter(
      { rules: [{ match: "sales", agent: "sales" }] },
      mockAgentRag,
    );

    const result = await router.routeAsync(textParts("I want sales"));

    expect(result.agentId).toBe("sales");
    expect(result.tier).toBe("rule");
    expect(mockAgentRag.selectAgent).not.toHaveBeenCalled();
  });

  it("Tier 2 embedding match when regex misses", async () => {
    const mockAgentRag = {
      selectAgent: vi.fn().mockResolvedValue({ agentId: "sales", score: 0.9 }),
    } as unknown as AgentRAG;
    const { router } = createRouter(
      { rules: [{ match: "billing", agent: "billing" }] },
      mockAgentRag,
    );

    const result = await router.routeAsync(textParts("I want to buy something"));

    expect(result.agentId).toBe("sales");
    expect(result.tier).toBe("embedding");
    expect(result.confidence).toBe(0.9);
    expect(mockAgentRag.selectAgent).toHaveBeenCalledOnce();
  });

  it("Tier 2 below threshold falls to fallback", async () => {
    const mockAgentRag = {
      selectAgent: vi.fn().mockResolvedValue({ agentId: "sales", score: 0.5 }),
    } as unknown as AgentRAG;
    const { router } = createRouter({}, mockAgentRag);

    const result = await router.routeAsync(textParts("something random"));

    expect(result.agentId).toBe("support");
    expect(result.tier).toBe("fallback");
    expect(result.confidence).toBeUndefined();
  });

  it("embeddingThreshold defaults to 0.75", async () => {
    const mockAgentRag = {
      selectAgent: vi.fn().mockResolvedValue({ agentId: "sales", score: 0.74 }),
    } as unknown as AgentRAG;
    const { router } = createRouter({}, mockAgentRag);

    const result = await router.routeAsync(textParts("test"));

    expect(result.tier).toBe("fallback");

    // Score exactly at 0.75 should pass
    mockAgentRag.selectAgent = vi.fn().mockResolvedValue({ agentId: "sales", score: 0.75 });
    const result2 = await router.routeAsync(textParts("test2"));

    expect(result2.tier).toBe("embedding");
    expect(result2.agentId).toBe("sales");
  });

  it("custom embeddingThreshold respected", async () => {
    const mockAgentRag = {
      selectAgent: vi.fn().mockResolvedValue({ agentId: "sales", score: 0.55 }),
    } as unknown as AgentRAG;
    const { router } = createRouter({ embeddingThreshold: 0.5 }, mockAgentRag);

    const result = await router.routeAsync(textParts("something"));

    expect(result.tier).toBe("embedding");
    expect(result.agentId).toBe("sales");
    expect(result.confidence).toBe(0.55);
  });

  it("agentRag failure falls to fallback (fail-open)", async () => {
    const mockAgentRag = {
      selectAgent: vi.fn().mockRejectedValue(new Error("embedding service down")),
    } as unknown as AgentRAG;
    const { router } = createRouter({}, mockAgentRag);

    const result = await router.routeAsync(textParts("help me please"));

    expect(result.agentId).toBe("support");
    expect(result.tier).toBe("fallback");
  });

  it("sync route() uses regex only", () => {
    const mockAgentRag = { selectAgent: vi.fn() } as unknown as AgentRAG;
    const { router } = createRouter(
      { rules: [{ match: "sales", agent: "sales" }] },
      mockAgentRag,
    );

    const result = router.route(textParts("something unrelated"));

    expect(result.agentId).toBe("support");
    expect(result.tier).toBe("fallback");
    expect(mockAgentRag.selectAgent).not.toHaveBeenCalled();
  });

  it("routeAsync with no rules returns fallback when below threshold", async () => {
    const mockAgentRag = {
      selectAgent: vi.fn().mockResolvedValue({ agentId: "sales", score: 0.3 }),
    } as unknown as AgentRAG;
    const { router } = createRouter({ rules: [] }, mockAgentRag);

    const result = await router.routeAsync(textParts("hello"));

    expect(result.agentId).toBe("support");
    expect(result.tier).toBe("fallback");
    expect(mockAgentRag.selectAgent).toHaveBeenCalledOnce();
  });

  it("Tier 2 result includes confidence score", async () => {
    const mockAgentRag = {
      selectAgent: vi.fn().mockResolvedValue({ agentId: "sales", score: 0.88 }),
    } as unknown as AgentRAG;
    const { router } = createRouter({}, mockAgentRag);

    const result = await router.routeAsync(textParts("pricing info"));

    expect(result).toEqual({
      agentId: "sales",
      tier: "embedding",
      confidence: 0.88,
    });
  });

  it("routeAsync with empty message", async () => {
    const mockAgentRag = {
      selectAgent: vi.fn().mockResolvedValue({ agentId: "sales", score: 0.4 }),
    } as unknown as AgentRAG;
    const { router } = createRouter({}, mockAgentRag);

    const result = await router.routeAsync(textParts(""));

    expect(result.agentId).toBe("support");
    expect(result.tier).toBe("fallback");
    expect(mockAgentRag.selectAgent).toHaveBeenCalledWith("", agents);
  });
});
