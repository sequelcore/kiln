import { describe, expect, it } from "vitest";
import {
  createContextEfficiencyReportIntegrity,
  digestContextEfficiencySchedule,
  verifyContextEfficiencyReportIdentity,
  type ContextEfficiencyFrozenReportIdentity,
  type ContextEfficiencyFrozenSchedule,
} from "./context-efficiency-report-integrity.js";

const schedule: ContextEfficiencyFrozenSchedule = {
  invalidRetryLimitPerCell: 1,
  entries: [
    { taskId: "exact", condition: "cold", repetition: 1, maximumProviderRequests: 8 },
    { taskId: "exact", condition: "cold", repetition: 2, maximumProviderRequests: 8 },
    { taskId: "repository", condition: "long_session", repetition: 1, maximumProviderRequests: 8 },
  ],
};

function digest(seed: string): string {
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}

function identity(overrides: Partial<ContextEfficiencyFrozenReportIdentity> = {}): ContextEfficiencyFrozenReportIdentity {
  return {
    manifestSchemaVersion: "kiln-context-efficiency-post-fix-manifest-v1",
    startingCommit: "a".repeat(40),
    frozenManifestDigest: digest("a"),
    sourceContractDigest: digest("b"),
    inputContractDigest: digest("c"),
    protocolContractDigest: digest("d"),
    configurationRevisionId: digest("e"),
    toolProjectionRecipeDigest: digest("f"),
    executionIdentityDigest: digest("0"),
    scheduleDigest: digestContextEfficiencySchedule(schedule),
    targetId: "target",
    providerId: "provider",
    modelId: "model",
    deliberationLevel: "low",
    ...overrides,
  };
}

describe("context efficiency report integrity", () => {
  it("binds a complete checkpoint to the frozen schedule and accounts for observed requests", () => {
    const report = createContextEfficiencyReportIntegrity({
      identity: identity(),
      schedule,
      attempts: [
        {
          taskId: "exact", condition: "cold", repetition: 1, attempt: 1, validity: "valid",
          physicalRequestEvidence: { state: "observed", physicalRequestCount: 2 },
        },
        {
          taskId: "exact", condition: "cold", repetition: 2, attempt: 1, validity: "invalid",
          physicalRequestEvidence: { state: "observed", physicalRequestCount: 1 },
        },
        {
          taskId: "exact", condition: "cold", repetition: 2, attempt: 2, validity: "valid",
          physicalRequestEvidence: { state: "observed", physicalRequestCount: 3 },
        },
        {
          taskId: "repository", condition: "long_session", repetition: 1, attempt: 1, validity: "valid",
          physicalRequestEvidence: { state: "observed", physicalRequestCount: 8 },
        },
      ],
    });

    expect(report.reconciliation).toEqual({
      status: "complete",
      expectedScheduledTrialCount: 3,
      observedScheduledTrialCount: 3,
      validTerminalScheduledTrialCount: 3,
      missingScheduledTrials: [],
      missingValidTerminalTrials: [],
      findings: [],
    });
    expect(report.physicalRequestAccounting).toEqual({
      status: "complete",
      observedAttemptCount: 4,
      observedPhysicalRequestCount: 14,
      unknownAttemptCount: 0,
      unknownObservedPhysicalRequestCount: 0,
      reservedMaximumPhysicalRequestCount: 0,
      maximumPhysicalRequestCount: 14,
    });
  });

  it("retains an uncertain invalid attempt as reserved physical usage without claiming complete evidence", () => {
    const report = createContextEfficiencyReportIntegrity({
      identity: identity(),
      schedule,
      attempts: [
        {
          taskId: "exact", condition: "cold", repetition: 1, attempt: 1, validity: "invalid",
          physicalRequestEvidence: { state: "unknown", reservedMaximumProviderRequests: 8 },
        },
        {
          taskId: "exact", condition: "cold", repetition: 1, attempt: 2, validity: "valid",
          physicalRequestEvidence: { state: "observed", physicalRequestCount: 1 },
        },
        {
          taskId: "exact", condition: "cold", repetition: 2, attempt: 1, validity: "valid",
          physicalRequestEvidence: { state: "observed", physicalRequestCount: 1 },
        },
        {
          taskId: "repository", condition: "long_session", repetition: 1, attempt: 1, validity: "valid",
          physicalRequestEvidence: { state: "observed", physicalRequestCount: 1 },
        },
      ],
    });

    expect(report.reconciliation.status).toBe("complete");
    expect(report.physicalRequestAccounting).toEqual({
      status: "incomplete",
      observedAttemptCount: 3,
      observedPhysicalRequestCount: 3,
      unknownAttemptCount: 1,
      unknownObservedPhysicalRequestCount: 0,
      reservedMaximumPhysicalRequestCount: 8,
      maximumPhysicalRequestCount: 11,
    });
  });

  it("uses a partial unknown attempt's full ceiling once, not once plus its retained lower bound", () => {
    const report = createContextEfficiencyReportIntegrity({
      identity: identity(),
      schedule,
      attempts: [{
        taskId: "exact", condition: "cold", repetition: 1, attempt: 1, validity: "invalid",
        physicalRequestEvidence: {
          state: "unknown",
          observedPhysicalRequestCount: 2,
          reservedMaximumProviderRequests: 8,
        },
      }],
    });

    expect(report.physicalRequestAccounting).toEqual({
      status: "incomplete",
      observedAttemptCount: 0,
      observedPhysicalRequestCount: 2,
      unknownAttemptCount: 1,
      unknownObservedPhysicalRequestCount: 2,
      reservedMaximumPhysicalRequestCount: 8,
      maximumPhysicalRequestCount: 8,
    });
  });

  it("marks a checkpoint partial when scheduled rows have not yet been recorded", () => {
    const report = createContextEfficiencyReportIntegrity({
      identity: identity(),
      schedule,
      attempts: [{
        taskId: "exact", condition: "cold", repetition: 1, attempt: 1, validity: "valid",
        physicalRequestEvidence: { state: "observed", physicalRequestCount: 1 },
      }],
    });

    expect(report.reconciliation).toMatchObject({
      status: "partial",
      observedScheduledTrialCount: 1,
      validTerminalScheduledTrialCount: 1,
      missingScheduledTrials: [
        { taskId: "exact", condition: "cold", repetition: 2 },
        { taskId: "repository", condition: "long_session", repetition: 1 },
      ],
    });
  });

  it("keeps invalid-only trials visible but treats their missing valid terminal result as partial", () => {
    const report = createContextEfficiencyReportIntegrity({
      identity: identity(),
      schedule,
      attempts: [
        {
          taskId: "exact", condition: "cold", repetition: 1, attempt: 1, validity: "invalid",
          physicalRequestEvidence: { state: "unknown", reservedMaximumProviderRequests: 8 },
        },
        {
          taskId: "exact", condition: "cold", repetition: 2, attempt: 1, validity: "valid",
          physicalRequestEvidence: { state: "observed", physicalRequestCount: 1 },
        },
        {
          taskId: "repository", condition: "long_session", repetition: 1, attempt: 1, validity: "valid",
          physicalRequestEvidence: { state: "observed", physicalRequestCount: 1 },
        },
      ],
    });

    expect(report.reconciliation).toMatchObject({
      status: "partial",
      observedScheduledTrialCount: 3,
      validTerminalScheduledTrialCount: 2,
      missingScheduledTrials: [],
      missingValidTerminalTrials: [{ taskId: "exact", condition: "cold", repetition: 1 }],
    });
  });

  it("requires an uncertain attempt to reserve its exact frozen provider-request ceiling", () => {
    expect(() => createContextEfficiencyReportIntegrity({
      identity: identity(),
      schedule,
      attempts: [{
        taskId: "exact", condition: "cold", repetition: 1, attempt: 1, validity: "invalid",
        physicalRequestEvidence: { state: "unknown", reservedMaximumProviderRequests: 1 },
      }],
    })).toThrow(/frozen per-trial/u);
    expect(() => createContextEfficiencyReportIntegrity({
      identity: identity(),
      schedule,
      attempts: [{
        taskId: "exact", condition: "cold", repetition: 1, attempt: 1, validity: "invalid",
        physicalRequestEvidence: {
          state: "unknown", observedPhysicalRequestCount: 9, reservedMaximumProviderRequests: 8,
        },
      }],
    })).toThrow(/cannot exceed/u);
  });

  it("retains observed provider-request overages as adverse evidence and rejects complete reconciliation", () => {
    const report = createContextEfficiencyReportIntegrity({
      identity: identity(),
      schedule,
      attempts: [
        {
          taskId: "exact", condition: "cold", repetition: 1, attempt: 1, validity: "valid",
          physicalRequestEvidence: { state: "observed", physicalRequestCount: 9 },
        },
        {
          taskId: "exact", condition: "cold", repetition: 2, attempt: 1, validity: "valid",
          physicalRequestEvidence: { state: "observed", physicalRequestCount: 1 },
        },
        {
          taskId: "repository", condition: "long_session", repetition: 1, attempt: 1, validity: "valid",
          physicalRequestEvidence: { state: "observed", physicalRequestCount: 1 },
        },
      ],
    });

    expect(report.reconciliation).toMatchObject({
      status: "invalid",
      findings: [{
        code: "provider_request_limit_exceeded",
        identity: { taskId: "exact", condition: "cold", repetition: 1, attempt: 1 },
      }],
    });
    expect(report.physicalRequestAccounting).toMatchObject({ observedPhysicalRequestCount: 11 });
  });

  it("fails closed for duplicate, missing, and invalid retry records", () => {
    const report = createContextEfficiencyReportIntegrity({
      identity: identity(),
      schedule,
      attempts: [
        {
          taskId: "exact", condition: "cold", repetition: 1, attempt: 1, validity: "valid",
          physicalRequestEvidence: { state: "observed", physicalRequestCount: 1 },
        },
        {
          taskId: "exact", condition: "cold", repetition: 1, attempt: 1, validity: "invalid",
          physicalRequestEvidence: { state: "unknown", reservedMaximumProviderRequests: 8 },
        },
        {
          taskId: "not-scheduled", condition: "cold", repetition: 1, attempt: 1, validity: "invalid",
          physicalRequestEvidence: { state: "unknown", reservedMaximumProviderRequests: 8 },
        },
      ],
    });

    expect(report.reconciliation.status).toBe("invalid");
    expect(report.reconciliation.findings.map((finding) => finding.code)).toEqual([
      "unexpected_attempt_trial",
      "duplicate_attempt",
      "attempt_after_terminal",
    ]);
    expect(report.physicalRequestAccounting).toMatchObject({
      status: "incomplete",
      reservedMaximumPhysicalRequestCount: 16,
    });
  });

  it("enforces the frozen invalid-retry limit across a task-condition cell", () => {
    const report = createContextEfficiencyReportIntegrity({
      identity: identity(),
      schedule,
      attempts: [
        {
          taskId: "exact", condition: "cold", repetition: 1, attempt: 1, validity: "invalid",
          physicalRequestEvidence: { state: "observed", physicalRequestCount: 1 },
        },
        {
          taskId: "exact", condition: "cold", repetition: 1, attempt: 2, validity: "valid",
          physicalRequestEvidence: { state: "observed", physicalRequestCount: 1 },
        },
        {
          taskId: "exact", condition: "cold", repetition: 2, attempt: 1, validity: "invalid",
          physicalRequestEvidence: { state: "observed", physicalRequestCount: 1 },
        },
        {
          taskId: "exact", condition: "cold", repetition: 2, attempt: 2, validity: "valid",
          physicalRequestEvidence: { state: "observed", physicalRequestCount: 1 },
        },
        {
          taskId: "repository", condition: "long_session", repetition: 1, attempt: 1, validity: "valid",
          physicalRequestEvidence: { state: "observed", physicalRequestCount: 1 },
        },
      ],
    });

    expect(report.reconciliation).toMatchObject({ status: "invalid" });
    expect(report.reconciliation.findings).toContainEqual({
      code: "invalid_retry_limit_exceeded",
      identity: { taskId: "exact", condition: "cold", repetition: 1 },
    });
  });

  it("rejects an identity that does not bind the exact frozen schedule or expected cohort", () => {
    expect(() => createContextEfficiencyReportIntegrity({
      identity: identity({ scheduleDigest: digest("9") }),
      schedule,
      attempts: [],
    })).toThrow(/does not bind/u);

    const report = createContextEfficiencyReportIntegrity({ identity: identity(), schedule, attempts: [] });
    expect(() => verifyContextEfficiencyReportIdentity(report, identity({ modelId: "other" })))
      .toThrow(/modelId/u);
  });
});
