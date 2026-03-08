import { describe, it, expect } from "vitest";
import { mapEventToSpan } from "../../src/observability/span-mapper.js";
import type { KilnEvent } from "../../src/events/index.js";

const BASE = { timestamp: new Date(), sessionId: "sess-1" } as const;

function ev<T extends KilnEvent>(partial: Omit<T, "timestamp" | "sessionId">): T {
    return { ...BASE, ...(partial as object) } as T;
}

describe("mapEventToSpan (Phase 9)", () => {
    describe("model_routed", () => {
        it("returns addEvent with gen_ai attributes", () => {
            const result = mapEventToSpan(
                ev({
                    type: "model_routed",
                    model: "claude-sonnet-4-6",
                    provider: "anthropic",
                    routingTier: "complexity",
                    complexityScore: 0.75,
                    reason: "High complexity detected",
                }),
            );
            expect(result.action).toBe("addEvent");
            if (result.action === "addEvent") {
                expect(result.name).toBe("model_routed");
                expect(result.attributes["gen_ai.request.model"]).toBe("claude-sonnet-4-6");
                expect(result.attributes["gen_ai.system"]).toBe("anthropic");
                expect(result.attributes["model"]).toBe("claude-sonnet-4-6");
                expect(result.attributes["provider"]).toBe("anthropic");
                expect(result.attributes["routingTier"]).toBe("complexity");
                expect(result.attributes["complexityScore"]).toBe(0.75);
                expect(result.attributes["reason"]).toBe("High complexity detected");
            }
        });

        it("includes previousModel when present", () => {
            const result = mapEventToSpan(
                ev({
                    type: "model_routed",
                    model: "claude-opus-4-6",
                    provider: "anthropic",
                    previousModel: "claude-sonnet-4-6",
                    routingTier: "cascade",
                    reason: "Cascade escalation",
                }),
            );
            if (result.action === "addEvent") {
                expect(result.attributes["previousModel"]).toBe("claude-sonnet-4-6");
            }
        });

        it("omits optional fields when not present", () => {
            const result = mapEventToSpan(
                ev({
                    type: "model_routed",
                    model: "claude-haiku-4-5-20251001",
                    provider: "anthropic",
                    routingTier: "default",
                    reason: "Default selection",
                }),
            );
            if (result.action === "addEvent") {
                expect(result.attributes).not.toHaveProperty("previousModel");
                expect(result.attributes).not.toHaveProperty("complexityScore");
            }
        });
    });

    describe("conversation_closed", () => {
        it("returns endSpan with ok status and close attributes", () => {
            const result = mapEventToSpan(
                ev({
                    type: "conversation_closed",
                    closedBy: "user",
                    turnCount: 12,
                    durationMs: 45000,
                    effortScore: 3,
                }),
            );
            expect(result.action).toBe("endSpan");
            if (result.action === "endSpan") {
                expect(result.status).toBe("ok");
                expect(result.attributes!["closedBy"]).toBe("user");
                expect(result.attributes!["turnCount"]).toBe(12);
                expect(result.attributes!["durationMs"]).toBe(45000);
                expect(result.attributes!["effortScore"]).toBe(3);
            }
        });

        it("omits effortScore when not present", () => {
            const result = mapEventToSpan(
                ev({
                    type: "conversation_closed",
                    closedBy: "session_timeout",
                    turnCount: 5,
                    durationMs: 120000,
                }),
            );
            if (result.action === "endSpan") {
                expect(result.attributes).not.toHaveProperty("effortScore");
            }
        });

        it("handles all closedBy values", () => {
            for (const closedBy of ["user", "operator", "session_timeout", "resolved"] as const) {
                const result = mapEventToSpan(
                    ev({
                        type: "conversation_closed",
                        closedBy,
                        turnCount: 1,
                        durationMs: 1000,
                    }),
                );
                if (result.action === "endSpan") {
                    expect(result.attributes!["closedBy"]).toBe(closedBy);
                }
            }
        });
    });

    describe("conversation_enriched", () => {
        it("returns addEvent with enrichmentId", () => {
            const result = mapEventToSpan(
                ev({
                    type: "conversation_enriched",
                    enrichmentId: "enr-abc-123",
                }),
            );
            expect(result.action).toBe("addEvent");
            if (result.action === "addEvent") {
                expect(result.name).toBe("conversation_enriched");
                expect(result.attributes["enrichmentId"]).toBe("enr-abc-123");
            }
        });
    });

    describe("cost_update gen_ai attributes", () => {
        it("includes both gen_ai.* and legacy attributes", () => {
            const result = mapEventToSpan(
                ev({
                    type: "cost_update",
                    inputTokens: 1500,
                    outputTokens: 800,
                    cacheReadTokens: 200,
                    totalCostUsd: 0.05,
                    byRole: {},
                }),
            );
            expect(result.action).toBe("setAttributes");
            if (result.action === "setAttributes") {
                // OTel GenAI conventions
                expect(result.attributes["gen_ai.usage.input_tokens"]).toBe(1500);
                expect(result.attributes["gen_ai.usage.output_tokens"]).toBe(800);
                expect(result.attributes["gen_ai.usage.cache_read_input_tokens"]).toBe(200);
                // Legacy Kiln attributes (backward compat)
                expect(result.attributes["inputTokens"]).toBe(1500);
                expect(result.attributes["outputTokens"]).toBe(800);
                expect(result.attributes["cacheReadTokens"]).toBe(200);
                expect(result.attributes["totalCostUsd"]).toBe(0.05);
            }
        });

        it("includes agentId when present", () => {
            const result = mapEventToSpan(
                ev({
                    type: "cost_update",
                    inputTokens: 100,
                    outputTokens: 50,
                    cacheReadTokens: 0,
                    totalCostUsd: 0.01,
                    byRole: {},
                    agentId: "sales-agent",
                }),
            );
            if (result.action === "setAttributes") {
                expect(result.attributes["agentId"]).toBe("sales-agent");
            }
        });
    });
});
