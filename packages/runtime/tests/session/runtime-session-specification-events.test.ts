import { describe, expect, it } from "vitest";
import { textParts } from "@kilnai/core";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { appendCanonicalTurnEvents } from "../../src/session/runtime-session-event-ledger.js";

describe("runtime specification session events", () => {
  it("projects structured specification and clarification artifacts into canonical session events", () => {
    const session = new RuntimeSession({
      appName: "kiln",
      tenantId: "test-tenant",
      userId: "operator",
      systemPrompt: "test",
    });
    session.addUserMessage(textParts("Plan with structured intake"));

    const timestamp = new Date("2026-05-08T13:00:00.000Z");
    const events = appendCanonicalTurnEvents({
      session,
      channel: "gui",
      userMessageContent: "Plan with structured intake",
      assistantMessageContent: "Specification captured.",
      queued: false,
      turnStartedAt: timestamp,
      turnCompletedAt: timestamp,
      continuity: { strategy: "new-session" },
      runtimeEvents: [],
      specificationSubmissions: [{
        specificationId: "spec_1",
        status: "ready_for_plan",
        summary: "Specification spec_1 is ready for planning.",
        issueCodes: [],
        blockingIssueCodes: [],
      }],
      clarificationRecords: [{
        specificationId: "spec_1",
        clarificationId: "clar_1",
        affectedSection: "authority",
      }],
    });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "specification_submitted",
        specificationId: "spec_1",
        status: "ready_for_plan",
      }),
      expect.objectContaining({
        kind: "clarification_recorded",
        specificationId: "spec_1",
        clarificationId: "clar_1",
        affectedSection: "authority",
      }),
    ]));
  });

  it("projects plan analysis reports into canonical session events", () => {
    const session = new RuntimeSession({
      appName: "kiln",
      tenantId: "test-tenant",
      userId: "operator",
      systemPrompt: "test",
    });
    session.addUserMessage(textParts("Analyze plan/spec consistency"));

    const timestamp = new Date("2026-05-08T14:00:00.000Z");
    const events = appendCanonicalTurnEvents({
      session,
      channel: "gui",
      userMessageContent: "Analyze plan/spec consistency",
      assistantMessageContent: "Analysis complete.",
      queued: false,
      turnStartedAt: timestamp,
      turnCompletedAt: timestamp,
      continuity: { strategy: "new-session" },
      runtimeEvents: [],
      analysisReports: [{
        reportId: "analysis_report_1",
        planId: "plan_1",
        specificationId: "spec_1",
        status: "blocked",
        highestSeverity: "critical",
        findingIds: ["analysis_finding_1"],
        blockingFindingIds: ["analysis_finding_1"],
        findingCount: 1,
        findings: [{
          id: "analysis_finding_1",
          fingerprint: "fingerprint-1",
          category: "constitution_conflict",
          severity: "critical",
          title: "Constitution Snapshot Mismatch",
          detail: "Plan and specification instruction-profile hashes differ.",
          references: ["specification:spec_1", "plan:plan_1"],
          status: "blocked",
        }],
        summary: "1 critical finding blocks approval.",
      }],
    });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "plan_analysis_reported",
        reportId: "analysis_report_1",
        planId: "plan_1",
        specificationId: "spec_1",
        status: "blocked",
        findings: [expect.objectContaining({
          id: "analysis_finding_1",
          status: "blocked",
          category: "constitution_conflict",
        })],
      }),
    ]));
  });
});
