import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { EventBus } from "@kilnai/core/events";
import { SafetyPipeline, type SafetyPipelineResult } from "@kilnai/core/safety";
import type { AuditLog } from "@kilnai/core/security";
import { safetyMiddleware } from "../../src/gateway/safety-middleware.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTestApp(
  pipeline: SafetyPipeline,
  options?: { eventBus?: EventBus; auditLog?: AuditLog },
): Hono<{ Variables: { safetyRedactedMessage: string } }> {
  const app = new Hono<{ Variables: { safetyRedactedMessage: string } }>();
  app.use("*", safetyMiddleware(pipeline, options));
  app.post("/test", (c) => c.json({ content: "Hello from handler" }));
  app.get("/test", (c) => c.json({ content: "GET response" }));
  return app;
}

function makeMockPipeline(result: SafetyPipelineResult): SafetyPipeline {
  return {
    evaluate: vi.fn(async () => result),
  } as unknown as SafetyPipeline;
}

function makeAllowedResult(overrides: Partial<SafetyPipelineResult> = {}): SafetyPipelineResult {
  return {
    allowed: true,
    policyResults: [],
    ...overrides,
  };
}

function makeBlockedResult(overrides: Partial<SafetyPipelineResult> = {}): SafetyPipelineResult {
  return {
    allowed: false,
    blockReason: "Blocked by safety policy",
    policyResults: [],
    ...overrides,
  };
}

function makeEventBus(): EventBus {
  return {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as EventBus;
}

function makeAuditLog(): AuditLog {
  return {
    append: vi.fn((e) => ({ ...e, id: "test-id", hash: undefined, previousHash: undefined })),
    query: vi.fn(() => []),
    verifyChain: vi.fn(() => ({ valid: true, entriesChecked: 0 })),
    count: vi.fn(() => 0),
  } as unknown as AuditLog;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("safetyMiddleware", () => {
  describe("request filtering", () => {
    it("skips non-POST requests (GET passes through)", async () => {
      const pipeline = makeMockPipeline(makeAllowedResult());
      const app = makeTestApp(pipeline);

      const res = await app.request("/test", { method: "GET" });

      expect(res.status).toBe(200);
      expect(pipeline.evaluate).not.toHaveBeenCalled();
      const body = await res.json() as { content: string };
      expect(body.content).toBe("GET response");
    });

    it("skips requests with no parseable body", async () => {
      const pipeline = makeMockPipeline(makeAllowedResult());
      const app = makeTestApp(pipeline);

      const res = await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-valid-json",
      });

      expect(pipeline.evaluate).not.toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it("skips requests with no message or content field", async () => {
      const pipeline = makeMockPipeline(makeAllowedResult());
      const app = makeTestApp(pipeline);

      const res = await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ someOtherField: "value" }),
      });

      expect(pipeline.evaluate).not.toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it("skips requests with empty message field", async () => {
      const pipeline = makeMockPipeline(makeAllowedResult());
      const app = makeTestApp(pipeline);

      const res = await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "" }),
      });

      expect(pipeline.evaluate).not.toHaveBeenCalled();
      expect(res.status).toBe(200);
    });
  });

  describe("input scan", () => {
    it("blocks with 422 when pipeline returns allowed: false", async () => {
      const pipeline = makeMockPipeline(makeBlockedResult({ blockReason: "PII detected: email" }));
      const app = makeTestApp(pipeline);

      const res = await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Contact me at user@example.com" }),
      });

      expect(res.status).toBe(422);
      const body = await res.json() as { error: string; reason: string };
      expect(body.error).toBe("safety_blocked");
      expect(body.reason).toBe("PII detected: email");
    });

    it("uses default block reason when blockReason is not provided", async () => {
      const pipeline = makeMockPipeline(makeBlockedResult({ blockReason: undefined }));
      const app = makeTestApp(pipeline);

      const res = await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "some message" }),
      });

      expect(res.status).toBe(422);
      const body = await res.json() as { error: string; reason: string };
      expect(body.error).toBe("safety_blocked");
      expect(body.reason).toBe("Input blocked by safety policy");
    });

    it("passes through when pipeline returns allowed: true", async () => {
      const pipeline = makeMockPipeline(makeAllowedResult());
      const app = makeTestApp(pipeline);

      const res = await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Hello, how are you?" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { content: string };
      expect(body.content).toBe("Hello from handler");
    });

    it("sets safetyRedactedMessage in context when pipeline returns redacted text", async () => {
      const pipeline = makeMockPipeline(
        makeAllowedResult({ redactedText: "Contact me at [REDACTED]" }),
      );

      const app = new Hono<{ Variables: { safetyRedactedMessage: string } }>();
      app.use("*", safetyMiddleware(pipeline));
      app.post("/test", (c) => {
        const redacted = c.get("safetyRedactedMessage");
        return c.json({ redacted: redacted ?? null });
      });

      const res = await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Contact me at user@example.com" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { redacted: string | null };
      expect(body.redacted).toBe("Contact me at [REDACTED]");
    });

    it("scans 'content' field if 'message' is not present", async () => {
      const pipeline = makeMockPipeline(makeBlockedResult({ blockReason: "Blocked content" }));
      const app = makeTestApp(pipeline);

      const res = await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "some problematic content" }),
      });

      expect(pipeline.evaluate).toHaveBeenCalledWith(
        "some problematic content",
        "input",
      );
      expect(res.status).toBe(422);
    });
  });

  describe("event emission", () => {
    it("emits pii_detected event when PII found in input result", async () => {
      const piiResult: SafetyPipelineResult = {
        allowed: true,
        policyResults: [],
        pii: {
          matches: [
            { type: "email", value: "user@example.com", startIndex: 0, endIndex: 16 },
          ],
          tier: "heuristic",
          scannedAt: new Date(),
        },
      };
      const pipeline = makeMockPipeline(piiResult);
      const eventBus = makeEventBus();
      const app = makeTestApp(pipeline, { eventBus });

      await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "user@example.com is my email" }),
      });

      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "pii_detected",
          direction: "input",
          piiTypes: ["email"],
          count: 1,
        }),
      );
    });

    it("emits content_classified event when content scores present", async () => {
      const contentResult: SafetyPipelineResult = {
        allowed: true,
        policyResults: [],
        content: {
          scores: [{ category: "hate", confidence: 0.8 }],
          tier: "heuristic",
          scannedAt: new Date(),
        },
      };
      const pipeline = makeMockPipeline(contentResult);
      const eventBus = makeEventBus();
      const app = makeTestApp(pipeline, { eventBus });

      await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "some text to classify" }),
      });

      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "content_classified",
          direction: "input",
          categories: { hate: 0.8 },
        }),
      );
    });

    it("emits policy_evaluated event for each rail result", async () => {
      const railResult: SafetyPipelineResult = {
        allowed: true,
        policyResults: [
          { allowed: true, railType: "topic" },
          { allowed: true, railType: "competitor" },
        ],
      };
      const pipeline = makeMockPipeline(railResult);
      const eventBus = makeEventBus();
      const app = makeTestApp(pipeline, { eventBus });

      await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "clean message" }),
      });

      // Middleware runs input + output scan; each scan emits one event per rail.
      // The handler returns { content: "Hello from handler" }, so output scan also fires.
      // That means 2 rails × 2 scans = 4 policy_evaluated events total.
      const emitCalls = vi.mocked(eventBus.emit).mock.calls.map((call) => call[0] as { type: string; railType?: string });
      const policyEvents = emitCalls.filter((e) => e.type === "policy_evaluated");
      expect(policyEvents.length).toBeGreaterThanOrEqual(2);
      const railTypes = policyEvents.map((e) => e.railType);
      expect(railTypes).toContain("topic");
      expect(railTypes).toContain("competitor");
    });

    it("does not emit events when no eventBus provided", async () => {
      // No eventBus -- should not throw
      const pipeline = makeMockPipeline(
        makeAllowedResult({
          pii: {
            matches: [{ type: "email", value: "a@b.com", startIndex: 0, endIndex: 7 }],
            tier: "heuristic",
            scannedAt: new Date(),
          },
        }),
      );
      const app = makeTestApp(pipeline);

      const res = await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "a@b.com" }),
      });

      expect(res.status).toBe(200);
    });

    it("uses x-session-id header for event sessionId", async () => {
      const piiResult: SafetyPipelineResult = {
        allowed: true,
        policyResults: [],
        pii: {
          matches: [{ type: "email", value: "a@b.com", startIndex: 0, endIndex: 7 }],
          tier: "heuristic",
          scannedAt: new Date(),
        },
      };
      const pipeline = makeMockPipeline(piiResult);
      const eventBus = makeEventBus();
      const app = makeTestApp(pipeline, { eventBus });

      await app.request("/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session-id": "session-abc-123",
        },
        body: JSON.stringify({ message: "a@b.com" }),
      });

      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "pii_detected",
          sessionId: "session-abc-123",
        }),
      );
    });

    it("falls back to 'unknown' sessionId when header is missing", async () => {
      const piiResult: SafetyPipelineResult = {
        allowed: true,
        policyResults: [],
        pii: {
          matches: [{ type: "email", value: "a@b.com", startIndex: 0, endIndex: 7 }],
          tier: "heuristic",
          scannedAt: new Date(),
        },
      };
      const pipeline = makeMockPipeline(piiResult);
      const eventBus = makeEventBus();
      const app = makeTestApp(pipeline, { eventBus });

      await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "a@b.com" }),
      });

      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "pii_detected",
          sessionId: "unknown",
        }),
      );
    });
  });

  describe("audit logging", () => {
    it("logs pii_detected audit entry when PII found", async () => {
      const piiResult: SafetyPipelineResult = {
        allowed: true,
        policyResults: [],
        pii: {
          matches: [{ type: "email", value: "a@b.com", startIndex: 0, endIndex: 7 }],
          tier: "heuristic",
          scannedAt: new Date(),
        },
      };
      const pipeline = makeMockPipeline(piiResult);
      const auditLog = makeAuditLog();
      const app = makeTestApp(pipeline, { auditLog });

      await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "a@b.com" }),
      });

      expect(auditLog.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "pii_detected",
          actor: "safety-middleware",
          outcome: "allowed",
          metadata: expect.objectContaining({
            authorityScope: "none",
          }),
        }),
      );
    });

    it("logs content_classified audit entry when content scores present", async () => {
      const contentResult: SafetyPipelineResult = {
        allowed: true,
        policyResults: [],
        content: {
          scores: [{ category: "violence", confidence: 0.5 }],
          tier: "heuristic",
          scannedAt: new Date(),
        },
      };
      const pipeline = makeMockPipeline(contentResult);
      const auditLog = makeAuditLog();
      const app = makeTestApp(pipeline, { auditLog });

      await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "some text" }),
      });

      expect(auditLog.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "content_classified",
          actor: "safety-middleware",
          metadata: expect.objectContaining({
            authorityScope: "none",
          }),
        }),
      );
    });

    it("logs policy_evaluated audit entry when rail blocks", async () => {
      const railResult: SafetyPipelineResult = {
        allowed: false,
        blockReason: "Blocked topic detected: forbidden",
        policyResults: [
          { allowed: false, railType: "topic", reason: "Blocked topic detected: forbidden" },
        ],
      };
      const pipeline = makeMockPipeline(railResult);
      const auditLog = makeAuditLog();
      const app = makeTestApp(pipeline, { auditLog });

      await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "forbidden topic here" }),
      });

      expect(auditLog.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "policy_evaluated",
          actor: "safety-middleware",
          outcome: "denied",
          metadata: expect.objectContaining({
            authorityScope: "none",
          }),
        }),
      );
    });

    it("does not log when auditLog not provided", async () => {
      const piiResult: SafetyPipelineResult = {
        allowed: true,
        policyResults: [],
        pii: {
          matches: [{ type: "email", value: "a@b.com", startIndex: 0, endIndex: 7 }],
          tier: "heuristic",
          scannedAt: new Date(),
        },
      };
      const pipeline = makeMockPipeline(piiResult);
      // No auditLog passed -- should not throw
      const app = makeTestApp(pipeline);

      const res = await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "a@b.com" }),
      });

      expect(res.status).toBe(200);
    });
  });

  describe("real SafetyPipeline integration", () => {
    it("blocks email with PII pipeline configured to block", async () => {
      const pipeline = new SafetyPipeline({
        pii: { detect: ["email"], action: "block" },
      });

      const app = makeTestApp(pipeline);

      const res = await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "reach me at test@example.com please" }),
      });

      expect(res.status).toBe(422);
      const body = await res.json() as { error: string; reason: string };
      expect(body.error).toBe("safety_blocked");
      expect(body.reason).toContain("email");
    });

    it("passes clean message through real pipeline", async () => {
      const pipeline = new SafetyPipeline({
        pii: { detect: ["email"], action: "block" },
      });

      const app = makeTestApp(pipeline);

      const res = await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Hello, how can I help you today?" }),
      });

      expect(res.status).toBe(200);
    });

    it("blocks topic rail with real pipeline", async () => {
      const pipeline = new SafetyPipeline({
        rails: [{ type: "topic", block: ["competitor-product"] }],
      });

      const app = makeTestApp(pipeline);

      const res = await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "tell me about competitor-product features" }),
      });

      expect(res.status).toBe(422);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("safety_blocked");
    });
  });
});
