import { describe, it, expect } from "vitest";
import { mapEventToSpan } from "../../src/observability/span-mapper.js";
import type { KilnEvent } from "../../src/events/index.js";

const BASE = { timestamp: new Date(), sessionId: "sess-1" } as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ev<T extends KilnEvent>(partial: Omit<T, "timestamp" | "sessionId">): T {
    return { ...BASE, ...(partial as object) } as T;
}

// ---------------------------------------------------------------------------
// Tests -- one per event type (29 total)
// ---------------------------------------------------------------------------

describe("mapEventToSpan", () => {
    describe("phase_changed", () => {
        it("returns startSpan with phase kind and phase attributes", () => {
            const result = mapEventToSpan(
                ev({ type: "phase_changed", phase: "implement", phaseName: "Implement", phaseDescription: "Write code" }),
            );
            expect(result.action).toBe("startSpan");
            if (result.action === "startSpan") {
                expect(result.kind).toBe("phase");
                expect(result.name).toBe("Implement");
                expect(result.attributes["phase"]).toBe("implement");
            }
        });
    });

    describe("task_started", () => {
        it("returns startSpan with task kind and taskId", () => {
            const result = mapEventToSpan(
                ev({ type: "task_started", taskId: "t-1", statement: "Build the feature", parentId: null }),
            );
            expect(result.action).toBe("startSpan");
            if (result.action === "startSpan") {
                expect(result.kind).toBe("task");
                expect(result.name).toBe("Build the feature");
                expect(result.attributes["taskId"]).toBe("t-1");
            }
        });

        it("includes parentId attribute when present", () => {
            const result = mapEventToSpan(
                ev({ type: "task_started", taskId: "t-2", statement: "Sub-task", parentId: "t-1" }),
            );
            if (result.action === "startSpan") {
                expect(result.attributes["parentId"]).toBe("t-1");
            }
        });
    });

    describe("task_completed", () => {
        it("returns endSpan with ok status for non-failed tasks", () => {
            const result = mapEventToSpan(
                ev({ type: "task_completed", taskId: "t-1", status: "done", action: "complete" }),
            );
            expect(result.action).toBe("endSpan");
            if (result.action === "endSpan") {
                expect(result.status).toBe("ok");
                expect(result.attributes?.["taskId"]).toBe("t-1");
            }
        });

        it("returns endSpan with error status for failed tasks", () => {
            const result = mapEventToSpan(
                ev({ type: "task_completed", taskId: "t-1", status: "failed", action: "abandon" }),
            );
            if (result.action === "endSpan") {
                expect(result.status).toBe("error");
            }
        });
    });

    describe("tool_called", () => {
        it("returns startSpan with tool kind", () => {
            const result = mapEventToSpan(
                ev({ type: "tool_called", toolName: "read_file", taskId: "t-1", workerIndex: 0 }),
            );
            expect(result.action).toBe("startSpan");
            if (result.action === "startSpan") {
                expect(result.kind).toBe("tool");
                expect(result.name).toBe("read_file");
                expect(result.attributes["workerIndex"]).toBe(0);
            }
        });
    });

    describe("tool_result", () => {
        it("returns endSpan with ok when success=true", () => {
            const result = mapEventToSpan(
                ev({ type: "tool_result", toolName: "read_file", taskId: "t-1", durationMs: 45, success: true }),
            );
            expect(result.action).toBe("endSpan");
            if (result.action === "endSpan") {
                expect(result.status).toBe("ok");
                expect(result.attributes?.["durationMs"]).toBe(45);
            }
        });

        it("returns endSpan with error when success=false", () => {
            const result = mapEventToSpan(
                ev({ type: "tool_result", toolName: "read_file", taskId: "t-1", durationMs: 10, success: false }),
            );
            if (result.action === "endSpan") {
                expect(result.status).toBe("error");
            }
        });
    });

    describe("thinking", () => {
        it("returns addEvent named 'thinking' with role and content", () => {
            const result = mapEventToSpan(
                ev({ type: "thinking", role: "architect", content: "Let me think about this..." }),
            );
            expect(result.action).toBe("addEvent");
            if (result.action === "addEvent") {
                expect(result.name).toBe("thinking");
                expect(result.attributes["role"]).toBe("architect");
                expect(typeof result.attributes["content"]).toBe("string");
            }
        });

        it("truncates content to 512 chars", () => {
            const long = "x".repeat(600);
            const result = mapEventToSpan(ev({ type: "thinking", role: "r", content: long }));
            if (result.action === "addEvent") {
                expect((result.attributes["content"] as string).length).toBe(512);
            }
        });
    });

    describe("verification_result", () => {
        it("returns addEvent named 'verification'", () => {
            const result = mapEventToSpan(
                ev({
                    type: "verification_result",
                    passed: true,
                    iteration: 2,
                    maxIterations: 5,
                    checks: [{ name: "lint", passed: true, output: "" }],
                }),
            );
            expect(result.action).toBe("addEvent");
            if (result.action === "addEvent") {
                expect(result.name).toBe("verification");
                expect(result.attributes["passed"]).toBe(true);
                expect(result.attributes["checksCount"]).toBe(1);
            }
        });
    });

    describe("cost_update", () => {
        it("returns setAttributes with token and cost values", () => {
            const result = mapEventToSpan(
                ev({
                    type: "cost_update",
                    inputTokens: 100,
                    outputTokens: 200,
                    cacheReadTokens: 50,
                    totalCostUsd: 0.005,
                    byRoleModel: {},
                }),
            );
            expect(result.action).toBe("setAttributes");
            if (result.action === "setAttributes") {
                expect(result.attributes["gen_ai.usage.input_tokens"]).toBe(100);
                expect(result.attributes["gen_ai.usage.output_tokens"]).toBe(200);
            }
        });
    });

    describe("memory_saved", () => {
        it("returns addEvent named 'memory.saved'", () => {
            const result = mapEventToSpan(
                ev({ type: "memory_saved", memoryId: "m-1", layer: "user", tags: ["plan", "draft"] }),
            );
            expect(result.action).toBe("addEvent");
            if (result.action === "addEvent") {
                expect(result.name).toBe("memory.saved");
                expect(result.attributes["tags"]).toBe("plan,draft");
            }
        });
    });

    describe("memory_recalled", () => {
        it("returns addEvent named 'memory.recalled'", () => {
            const result = mapEventToSpan(
                ev({ type: "memory_recalled", query: "previous decisions", resultsCount: 3 }),
            );
            expect(result.action).toBe("addEvent");
            if (result.action === "addEvent") {
                expect(result.name).toBe("memory.recalled");
                expect(result.attributes["resultsCount"]).toBe(3);
            }
        });
    });

    describe("memory_sync", () => {
        it("returns addEvent named 'memory.sync'", () => {
            const result = mapEventToSpan(
                ev({ type: "memory_sync", imported: 5, entries: 120, developers: 2 }),
            );
            expect(result.action).toBe("addEvent");
            if (result.action === "addEvent") {
                expect(result.name).toBe("memory.sync");
                expect(result.attributes["imported"]).toBe(5);
            }
        });
    });

    describe("approval_requested", () => {
        it("returns addEvent named 'approval.requested'", () => {
            const result = mapEventToSpan(
                ev({ type: "approval_requested", approvalId: "approval-1", taskId: "t-1", description: "Deploy to prod?" }),
            );
            expect(result.action).toBe("addEvent");
            if (result.action === "addEvent") {
                expect(result.name).toBe("approval.requested");
                expect(result.attributes["taskId"]).toBe("t-1");
            }
        });
    });

    describe("approval_received", () => {
        it("returns addEvent named 'approval.received'", () => {
            const result = mapEventToSpan(
                ev({ type: "approval_received", approvalId: "approval-1", taskId: "t-1", approved: true }),
            );
            expect(result.action).toBe("addEvent");
            if (result.action === "addEvent") {
                expect(result.name).toBe("approval.received");
                expect(result.attributes["approved"]).toBe(true);
            }
        });
    });

    describe("worker_assigned", () => {
        it("returns startSpan with agent kind", () => {
            const result = mapEventToSpan(
                ev({ type: "worker_assigned", workerIndex: 2, taskId: "t-1" }),
            );
            expect(result.action).toBe("startSpan");
            if (result.action === "startSpan") {
                expect(result.kind).toBe("agent");
                expect(result.name).toBe("worker-2");
                expect(result.attributes["workerIndex"]).toBe(2);
            }
        });
    });

    describe("error", () => {
        it("returns endSpan with error status and exception attributes", () => {
            const result = mapEventToSpan(
                ev({ type: "error", message: "Something failed", code: "TOOL_FAILED", taskId: "t-1" }),
            );
            expect(result.action).toBe("endSpan");
            if (result.action === "endSpan") {
                expect(result.status).toBe("error");
                expect(result.attributes?.["exception.message"]).toBe("Something failed");
                expect(result.attributes?.["exception.type"]).toBe("TOOL_FAILED");
            }
        });

        it("omits taskId attribute when taskId is null", () => {
            const result = mapEventToSpan(
                ev({ type: "error", message: "Oops", code: "UNKNOWN", taskId: null }),
            );
            if (result.action === "endSpan") {
                expect(result.attributes?.["taskId"]).toBeUndefined();
            }
        });
    });

    describe("trace_span", () => {
        it("returns addEvent named 'trace_span' with span metadata", () => {
            const result = mapEventToSpan(
                ev({
                    type: "trace_span",
                    span: {
                        spanId: "sp-1",
                        traceId: "tr-1",
                        parentSpanId: null,
                        name: "my-span",
                        kind: "tool",
                        startTime: new Date(),
                        status: "ok",
                        attributes: {},
                        events: [],
                    },
                }),
            );
            expect(result.action).toBe("addEvent");
            if (result.action === "addEvent") {
                expect(result.name).toBe("trace_span");
                expect(result.attributes["spanId"]).toBe("sp-1");
                expect(result.attributes["spanKind"]).toBe("tool");
            }
        });
    });

    describe("handoff_requested", () => {
        it("returns addEvent named 'handoff.requested'", () => {
            const result = mapEventToSpan(
                ev({ type: "handoff_requested", fromAgent: "A", toAgent: "B", reason: "specialization" }),
            );
            expect(result.action).toBe("addEvent");
            if (result.action === "addEvent") {
                expect(result.name).toBe("handoff.requested");
                expect(result.attributes["toAgent"]).toBe("B");
            }
        });
    });

    describe("handoff_completed", () => {
        it("returns addEvent named 'handoff.completed'", () => {
            const result = mapEventToSpan(
                ev({ type: "handoff_completed", fromAgent: "A", toAgent: "B", accepted: true }),
            );
            expect(result.action).toBe("addEvent");
            if (result.action === "addEvent") {
                expect(result.name).toBe("handoff.completed");
                expect(result.attributes["accepted"]).toBe(true);
            }
        });
    });

    describe("interrupt_requested", () => {
        it("returns addEvent named 'interrupt.requested'", () => {
            const result = mapEventToSpan(
                ev({ type: "interrupt_requested", checkpointId: "cp-1", reason: "waiting for user" }),
            );
            expect(result.action).toBe("addEvent");
            if (result.action === "addEvent") {
                expect(result.name).toBe("interrupt.requested");
                expect(result.attributes["checkpointId"]).toBe("cp-1");
            }
        });
    });

    describe("interrupt_resumed", () => {
        it("returns addEvent named 'interrupt.resumed'", () => {
            const result = mapEventToSpan(
                ev({ type: "interrupt_resumed", checkpointId: "cp-1", resumeValue: "approved" }),
            );
            expect(result.action).toBe("addEvent");
            if (result.action === "addEvent") {
                expect(result.name).toBe("interrupt.resumed");
                expect(result.attributes["checkpointId"]).toBe("cp-1");
            }
        });
    });

    describe("injection_scanned", () => {
        it("returns addEvent named 'security.injection_scan'", () => {
            const result = mapEventToSpan(
                ev({ type: "injection_scanned", safe: true, threats: 0, tier: "heuristic", inputPreview: "hello" }),
            );
            expect(result.action).toBe("addEvent");
            if (result.action === "addEvent") {
                expect(result.name).toBe("security.injection_scan");
                expect(result.attributes["safe"]).toBe(true);
                expect(result.attributes["tier"]).toBe("heuristic");
                expect(result.attributes["inputPreview"]).toBe("hello");
            }
        });
    });

    describe("guardian_reviewed", () => {
        it("returns addEvent named 'security.guardian_review'", () => {
            const result = mapEventToSpan(
                ev({
                    type: "guardian_reviewed",
                    approved: false,
                    capabilityName: "delete_database",
                    agentName: "destroyer",
                    riskLevel: "critical",
                    reason: "too dangerous",
                }),
            );
            expect(result.action).toBe("addEvent");
            if (result.action === "addEvent") {
                expect(result.name).toBe("security.guardian_review");
                expect(result.attributes["approved"]).toBe(false);
                expect(result.attributes["riskLevel"]).toBe("critical");
                expect(result.attributes["reason"]).toBe("too dangerous");
            }
        });
    });

    describe("audit_entry", () => {
        it("returns addEvent named 'security.audit'", () => {
            const result = mapEventToSpan(
                ev({ type: "audit_entry", action: "read", actor: "agent-1", outcome: "success", resource: "file.txt" }),
            );
            expect(result.action).toBe("addEvent");
            if (result.action === "addEvent") {
                expect(result.name).toBe("security.audit");
                expect(result.attributes["actor"]).toBe("agent-1");
            }
        });
    });

    describe("tenant_isolation_violation", () => {
        it("returns addEvent named 'security.tenant_violation'", () => {
            const result = mapEventToSpan(
                ev({
                    type: "tenant_isolation_violation",
                    tenantId: "tenant-a",
                    attemptedResource: "/data/tenant-b/",
                    blockedBy: "sandbox",
                }),
            );
            expect(result.action).toBe("addEvent");
            if (result.action === "addEvent") {
                expect(result.name).toBe("security.tenant_violation");
                expect(result.attributes["tenantId"]).toBe("tenant-a");
                expect(result.attributes["blockedBy"]).toBe("sandbox");
            }
        });
    });

    describe("security_alert", () => {
        it("returns addEvent named 'security.alert'", () => {
            const result = mapEventToSpan(
                ev({ type: "security_alert", severity: "high", category: "injection", message: "Detected injection attempt" }),
            );
            expect(result.action).toBe("addEvent");
            if (result.action === "addEvent") {
                expect(result.name).toBe("security.alert");
                expect(result.attributes["severity"]).toBe("high");
            }
        });
    });

    describe("webhook_received", () => {
        it("returns startSpan named 'trigger.webhook'", () => {
            const result = mapEventToSpan(
                ev({
                    type: "webhook_received",
                    path: "/webhooks/gh",
                    appName: "my-app",
                    triggerName: "github-push",
                    method: "POST",
                }),
            );
            expect(result.action).toBe("startSpan");
            if (result.action === "startSpan") {
                expect(result.name).toBe("trigger.webhook");
                expect(result.kind).toBe("trigger");
                expect(result.attributes["path"]).toBe("/webhooks/gh");
                expect(result.attributes["method"]).toBe("POST");
            }
        });
    });

    describe("trigger_fired", () => {
        it("returns addEvent named 'trigger.fired'", () => {
            const result = mapEventToSpan(
                ev({
                    type: "trigger_fired",
                    triggerName: "on-push",
                    triggerType: "webhook",
                    team: "backend",
                    task: "deploy",
                }),
            );
            expect(result.action).toBe("addEvent");
            if (result.action === "addEvent") {
                expect(result.name).toBe("trigger.fired");
                expect(result.attributes["triggerType"]).toBe("webhook");
            }
        });
    });

    describe("trigger_failed", () => {
        it("returns endSpan with error status", () => {
            const result = mapEventToSpan(
                ev({ type: "trigger_failed", triggerName: "on-push", triggerType: "webhook", error: "timeout" }),
            );
            expect(result.action).toBe("endSpan");
            if (result.action === "endSpan") {
                expect(result.status).toBe("error");
                expect(result.attributes?.["exception.message"]).toBe("timeout");
            }
        });
    });

    describe("schedule_fired", () => {
        it("returns addEvent named 'trigger.schedule_fired'", () => {
            const result = mapEventToSpan(
                ev({ type: "schedule_fired", triggerName: "nightly", cron: "0 2 * * *", team: "ops" }),
            );
            expect(result.action).toBe("addEvent");
            if (result.action === "addEvent") {
                expect(result.name).toBe("trigger.schedule_fired");
                expect(result.attributes["cron"]).toBe("0 2 * * *");
            }
        });
    });
});
