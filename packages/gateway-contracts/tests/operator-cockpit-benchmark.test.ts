import { describe, expect, it } from "vitest";
import {
  type OperatorCockpitBrowserRenderingBenchmarkEvidenceReport,
  type OperatorCockpitInteractionLatencyReport,
  type OperatorCockpitMemoryReport,
  type OperatorCockpitNativeRenderingBenchmarkEvidenceReport,
  type OperatorCockpitTargetClarityReport,
  createOperatorCockpitBenchmarkRunnerAdmission,
  createOperatorCockpitBenchmarkFixture,
  createOperatorCockpitBenchmarkEvidenceReport,
  measureOperatorCockpitProjectionBaseline,
  measureOperatorCockpitReadOnlyProjectionBaseline,
  measureOperatorCockpitReadOnlyViewStateBaseline,
} from "../src/operator-cockpit-benchmark.js";

describe("operator cockpit benchmark fixtures", () => {
  it("creates deterministic high-density session events with explicit instance and session targets", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "multi-session-small",
      instanceCount: 2,
      sessionCount: 3,
      activeManagedSessionCount: 2,
      childInvocationCount: 5,
      eventCount: 30,
      startedAt: "2026-05-14T12:00:00.000Z",
    });

    expect(fixture.summary).toEqual({
      fixtureId: "multi-session-small",
      instanceCount: 2,
      sessionCount: 3,
      activeManagedSessionCount: 2,
      childInvocationCount: 5,
      eventCount: 30,
    });
    expect(fixture.events).toHaveLength(30);
    expect(fixture.events[0]).toMatchObject({
      eventId: "multi-session-small:event:1",
      kilnSessionId: "multi-session-small:session:1",
      sequence: 1,
      kind: "turn_started",
      payload: {
        instanceId: "multi-session-small:instance:1",
        sessionId: "multi-session-small:session:1",
      },
    });
    expect(fixture.events.some((event) => event.kind === "agent_invocation_started")).toBe(true);
    expect(fixture.events.every((event) => typeof event.payload.instanceId === "string")).toBe(true);
  });

  it("measures a shared GUI projection baseline without mutating canonical events", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "projection-small",
      instanceCount: 1,
      sessionCount: 2,
      activeManagedSessionCount: 1,
      childInvocationCount: 3,
      eventCount: 20,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const baseline = measureOperatorCockpitProjectionBaseline({
      fixture,
      measuredAt: "2026-05-14T12:01:00.000Z",
    });

    expect(baseline.surface).toBe("gui-shared-projection");
    expect(baseline.fixture).toEqual(fixture.summary);
    expect(baseline.projectedEventCount).toBe(20);
    expect(baseline.durationMs).toBeGreaterThanOrEqual(0);
    expect(baseline.firstProjection).toMatchObject({
      eventId: "projection-small:event:1",
      title: "Turn Started",
    });
    expect(fixture.events[0]?.payload).toMatchObject({
      instanceId: "projection-small:instance:1",
    });
  });

  it("measures the shared read-only cockpit projection baseline with explicit attach targets", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "read-only-baseline",
      instanceCount: 2,
      sessionCount: 3,
      activeManagedSessionCount: 2,
      childInvocationCount: 5,
      eventCount: 30,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const baseline = measureOperatorCockpitReadOnlyProjectionBaseline({
      fixture,
      measuredAt: "2026-05-14T12:02:00.000Z",
      attachTargets: [
        {
          instanceId: "read-only-baseline:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
        {
          instanceId: "read-only-baseline:instance:2",
          label: "Simulated remote",
          kind: "simulated-remote",
        },
      ],
    });

    expect(baseline.surface).toBe("shared-read-only-cockpit-projection");
    expect(baseline.measuredAt).toBe("2026-05-14T12:02:00.000Z");
    expect(baseline.fixture).toEqual(fixture.summary);
    expect(baseline.projectedEventCount).toBe(30);
    expect(baseline.instanceCount).toBe(2);
    expect(baseline.sessionCount).toBe(3);
    expect(baseline.timelineCount).toBe(30);
    expect(baseline.invocationCount).toBeGreaterThan(0);
    expect(baseline.toolSummaryCount).toBeGreaterThan(0);
    expect(baseline.totalCostUsd).toBeGreaterThan(0);
    expect(baseline.providerRoutes).toContain("synthetic/fixture");
    expect(baseline.durationMs).toBeGreaterThanOrEqual(0);
    expect(baseline.firstTimelineEntry).toMatchObject({
      eventId: "read-only-baseline:event:1",
      target: {
        instanceId: "read-only-baseline:instance:1",
        sessionId: "read-only-baseline:session:1",
      },
      title: "Turn Started",
    });
    expect(baseline.lastTimelineEntry).toMatchObject({
      eventId: "read-only-baseline:event:30",
      target: {
        instanceId: "read-only-baseline:instance:1",
        sessionId: "read-only-baseline:session:3",
      },
    });
    expect(fixture.events[0]?.payload).toMatchObject({
      instanceId: "read-only-baseline:instance:1",
    });
  });

  it("fails the read-only projection baseline when attach targets are missing", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "missing-targets",
      instanceCount: 1,
      sessionCount: 1,
      activeManagedSessionCount: 0,
      childInvocationCount: 0,
      eventCount: 1,
      startedAt: "2026-05-14T12:00:00.000Z",
    });

    expect(() => measureOperatorCockpitReadOnlyProjectionBaseline({
      fixture,
      measuredAt: "2026-05-14T12:03:00.000Z",
      attachTargets: [],
    })).toThrow("requires at least one attach target");
  });

  it("measures read-only view-state baseline over shared projection substrate", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "read-only-view-state-baseline",
      instanceCount: 2,
      sessionCount: 3,
      activeManagedSessionCount: 2,
      childInvocationCount: 5,
      eventCount: 30,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const baseline = measureOperatorCockpitReadOnlyViewStateBaseline({
      fixture,
      measuredAt: "2026-05-14T12:05:00.000Z",
      attachTargets: [
        {
          instanceId: "read-only-view-state-baseline:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
        {
          instanceId: "read-only-view-state-baseline:instance:2",
          label: "Simulated remote",
          kind: "simulated-remote",
        },
      ],
      viewState: {
        focusTarget: {
          instanceId: "read-only-view-state-baseline:instance:1",
          sessionId: "read-only-view-state-baseline:session:1",
        },
        filters: {
          instanceId: "read-only-view-state-baseline:instance:1",
          sessionId: "read-only-view-state-baseline:session:1",
        },
        replayCursor: {
          instanceId: "read-only-view-state-baseline:instance:1",
          sessionId: "read-only-view-state-baseline:session:1",
          eventId: "read-only-view-state-baseline:event:1",
        },
      },
    });

    expect(baseline.surface).toBe("shared-read-only-cockpit-view-state");
    expect(baseline.measuredAt).toBe("2026-05-14T12:05:00.000Z");
    expect(baseline.fixture).toEqual(fixture.summary);
    expect(baseline.durationMs).toBeGreaterThanOrEqual(0);
    expect(baseline.focusResolved).toBe(true);
    expect(baseline.timelineValid).toBe(true);
    expect(baseline.filteredTimelineCount).toBeGreaterThan(0);
    expect(baseline.replayResolved).toBe(true);
    expect(baseline.replayEventId).toBe("read-only-view-state-baseline:event:1");
    expect(baseline.instanceCount).toBe(2);
    expect(baseline.sessionCount).toBe(3);
    expect(baseline.timelineCount).toBe(30);
    expect(baseline.invocationCount).toBeGreaterThan(0);
    expect(baseline.toolSummaryCount).toBeGreaterThan(0);
  });

  it("fails closed for invalid view-state selectors without throwing", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "read-only-view-state-fail-closed",
      instanceCount: 1,
      sessionCount: 1,
      activeManagedSessionCount: 1,
      childInvocationCount: 1,
      eventCount: 8,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const baseline = measureOperatorCockpitReadOnlyViewStateBaseline({
      fixture,
      measuredAt: "2026-05-14T12:06:00.000Z",
      attachTargets: [
        {
          instanceId: "read-only-view-state-fail-closed:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
      ],
      viewState: {
        focusTarget: {
          instanceId: "read-only-view-state-fail-closed:instance:missing",
          sessionId: "read-only-view-state-fail-closed:session:missing",
        },
        filters: {
          sessionId: "read-only-view-state-fail-closed:session:1",
        },
        replayCursor: {
          instanceId: "read-only-view-state-fail-closed:instance:missing",
          sessionId: "read-only-view-state-fail-closed:session:missing",
          eventId: "read-only-view-state-fail-closed:event:missing",
        },
      },
    });

    expect(baseline.focusResolved).toBe(false);
    expect(baseline.timelineValid).toBe(false);
    expect(baseline.filteredTimelineCount).toBe(0);
    expect(baseline.replayResolved).toBe(false);
    expect(baseline.replayEventId).toBeUndefined();
    expect(baseline.previousEventId).toBeUndefined();
    expect(baseline.nextEventId).toBeUndefined();
  });
});

describe("operator cockpit benchmark evidence report", () => {
  const browserRenderingEvidenceFixture: OperatorCockpitBrowserRenderingBenchmarkEvidenceReport = {
    measuredAt: "2026-05-14T13:00:00.000Z",
    workloadId: "operator-cockpit-phase3",
    measured: true,
    environment: "playwright-ci",
    sampleCount: 5,
  };
  const nativeRenderingEvidenceFixture: OperatorCockpitNativeRenderingBenchmarkEvidenceReport = {
    measuredAt: "2026-05-14T13:00:10.000Z",
    workloadId: "operator-cockpit-phase3",
    measured: true,
    environment: "electron-ci",
    sampleCount: 5,
    nativeAdvantageConfirmed: true,
  };
  const targetClarityReportFixture: OperatorCockpitTargetClarityReport = {
    measuredAt: "2026-05-14T13:00:20.000Z",
    workloadId: "operator-cockpit-phase3",
    measured: true,
    complete: true,
    targetCount: 3,
  };
  const interactionLatencyReportFixture: OperatorCockpitInteractionLatencyReport = {
    measuredAt: "2026-05-14T13:00:30.000Z",
    workloadId: "operator-cockpit-phase3",
    measured: true,
    complete: true,
    sampleCount: 250,
    p95LatencyMs: 45,
  };
  const memoryReportFixture: OperatorCockpitMemoryReport = {
    measuredAt: "2026-05-14T13:00:40.000Z",
    workloadId: "operator-cockpit-phase3",
    measured: true,
    complete: true,
    sampleCount: 40,
    peakRssMb: 512,
  };

  it("defines typed phase 3 evidence report contracts", () => {
    expect(browserRenderingEvidenceFixture.measured).toBe(true);
    expect(nativeRenderingEvidenceFixture.nativeAdvantageConfirmed).toBe(true);
    expect(targetClarityReportFixture.complete).toBe(true);
    expect(interactionLatencyReportFixture.p95LatencyMs).toBeGreaterThan(0);
    expect(memoryReportFixture.peakRssMb).toBeGreaterThan(0);
  });

  function createSharedBaselines() {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "evidence-shared-only",
      instanceCount: 2,
      sessionCount: 3,
      activeManagedSessionCount: 2,
      childInvocationCount: 5,
      eventCount: 30,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const attachTargets = [
      {
        instanceId: "evidence-shared-only:instance:1",
        label: "Local / kiln",
        kind: "local" as const,
      },
      {
        instanceId: "evidence-shared-only:instance:2",
        label: "Simulated remote",
        kind: "simulated-remote" as const,
      },
    ];
    return {
      fixture,
      projectionBaseline: measureOperatorCockpitProjectionBaseline({
        fixture,
        measuredAt: "2026-05-14T12:01:00.000Z",
      }),
      readOnlyProjectionBaseline: measureOperatorCockpitReadOnlyProjectionBaseline({
        fixture,
        measuredAt: "2026-05-14T12:02:00.000Z",
        attachTargets,
      }),
      readOnlyViewStateBaseline: measureOperatorCockpitReadOnlyViewStateBaseline({
        fixture,
        measuredAt: "2026-05-14T12:03:00.000Z",
        attachTargets,
        viewState: {
          focusTarget: {
            instanceId: "evidence-shared-only:instance:1",
            sessionId: "evidence-shared-only:session:1",
          },
          filters: {
            instanceId: "evidence-shared-only:instance:1",
            sessionId: "evidence-shared-only:session:1",
          },
        },
      }),
    };
  }

  it("defaults to contract-only evidence and blocks promotion", () => {
    const baselines = createSharedBaselines();
    const report = createOperatorCockpitBenchmarkEvidenceReport({
      measuredAt: "2026-05-14T13:00:00.000Z",
      fixture: baselines.fixture,
      projectionBaseline: baselines.projectionBaseline,
      readOnlyProjectionBaseline: baselines.readOnlyProjectionBaseline,
      readOnlyViewStateBaseline: baselines.readOnlyViewStateBaseline,
    });

    expect(report.status).toBe("contract-only");
    expect(report.recommendation).toBe("run-rendering-benchmarks");
    expect(report.promotionAllowed).toBe(false);
    expect(report.rustCandidateAllowed).toBe(false);
    expect(report.implementedEvidence).toEqual([
      "shared-projection-baseline",
      "shared-read-only-projection-baseline",
      "shared-read-only-view-state-baseline",
    ]);
    expect(report.missingEvidence).toEqual(expect.arrayContaining([
      "browser-rendering-benchmark",
      "native-rendering-benchmark",
      "target-clarity-report",
      "interaction-latency-report",
      "memory-report",
      "native-advantage-proof",
    ]));
    expect(report.mutationDispatch).toBe("disabled");
    expect(report.networkAttach).toBe("not-started");
    expect(report.renderingBenchmark).toBe("not-run");
    expect(report.rustPromotionAllowed).toBe(false);
  });

  it("keeps promotion blocked when browser and native benchmarks exist without governance reports", () => {
    const baselines = createSharedBaselines();
    const report = createOperatorCockpitBenchmarkEvidenceReport({
      measuredAt: "2026-05-14T13:05:00.000Z",
      fixtureSummary: baselines.fixture.summary,
      projectionBaseline: baselines.projectionBaseline,
      readOnlyProjectionBaseline: baselines.readOnlyProjectionBaseline,
      readOnlyViewStateBaseline: baselines.readOnlyViewStateBaseline,
      browserRenderingEvidence: {
        measuredAt: "2026-05-14T13:05:00.000Z",
        workloadId: "operator-cockpit-phase3",
        measured: true,
        environment: "playwright-ci",
        sampleCount: 5,
      },
      nativeRenderingEvidence: {
        measuredAt: "2026-05-14T13:05:10.000Z",
        workloadId: "operator-cockpit-phase3",
        measured: true,
        environment: "electron-ci",
        sampleCount: 5,
        nativeAdvantageConfirmed: true,
      },
      resourceOpeningDispatchEvidence: {
        measured: true,
      },
      cancellationDispatchEvidence: {
        measured: true,
      },
    });

    expect(report.promotionAllowed).toBe(false);
    expect(report.recommendation).toBe("continue-contract-only");
    expect(report.mutationDispatch).toBe("disabled");
    expect(report.networkAttach).toBe("not-started");
    expect(report.missingEvidence).toEqual(expect.arrayContaining([
      "target-clarity-report",
      "interaction-latency-report",
      "memory-report",
    ]));
  });

  it("allows promotion only with complete rendering and governance evidence plus native advantage", () => {
    const baselines = createSharedBaselines();
    const report = createOperatorCockpitBenchmarkEvidenceReport({
      measuredAt: "2026-05-14T13:10:00.000Z",
      fixtureSummary: baselines.fixture.summary,
      projectionBaseline: baselines.projectionBaseline,
      readOnlyProjectionBaseline: baselines.readOnlyProjectionBaseline,
      readOnlyViewStateBaseline: baselines.readOnlyViewStateBaseline,
      browserRenderingEvidence: {
        measuredAt: "2026-05-14T13:10:00.000Z",
        workloadId: "operator-cockpit-phase3",
        measured: true,
        environment: "playwright-ci",
        sampleCount: 5,
      },
      nativeRenderingEvidence: {
        measuredAt: "2026-05-14T13:10:10.000Z",
        workloadId: "operator-cockpit-phase3",
        measured: true,
        environment: "electron-ci",
        sampleCount: 5,
        nativeAdvantageConfirmed: true,
      },
      targetClarityReport: {
        measuredAt: "2026-05-14T13:10:20.000Z",
        workloadId: "operator-cockpit-phase3",
        measured: true,
        complete: true,
        targetCount: 3,
      },
      interactionLatencyReport: {
        measuredAt: "2026-05-14T13:10:30.000Z",
        workloadId: "operator-cockpit-phase3",
        measured: true,
        complete: true,
        sampleCount: 250,
        p95LatencyMs: 45,
      },
      memoryReport: {
        measuredAt: "2026-05-14T13:10:40.000Z",
        workloadId: "operator-cockpit-phase3",
        measured: true,
        complete: true,
        sampleCount: 40,
        peakRssMb: 512,
      },
    });

    expect(report.status).toBe("promotion-candidate");
    expect(report.promotionAllowed).toBe(true);
    expect(report.recommendation).toBe("continue-native-without-rust");
    expect(report.rustPromotionAllowed).toBe(false);
  });

  it("blocks promotion when governance reports are complete but unmeasured", () => {
    const baselines = createSharedBaselines();
    const completeInput = {
      measuredAt: "2026-05-14T13:11:00.000Z",
      fixtureSummary: baselines.fixture.summary,
      projectionBaseline: baselines.projectionBaseline,
      readOnlyProjectionBaseline: baselines.readOnlyProjectionBaseline,
      readOnlyViewStateBaseline: baselines.readOnlyViewStateBaseline,
      browserRenderingEvidence: browserRenderingEvidenceFixture,
      nativeRenderingEvidence: nativeRenderingEvidenceFixture,
      targetClarityReport: targetClarityReportFixture,
      interactionLatencyReport: interactionLatencyReportFixture,
      memoryReport: memoryReportFixture,
    };

    const targetClarityReport = createOperatorCockpitBenchmarkEvidenceReport({
      ...completeInput,
      targetClarityReport: {
        ...targetClarityReportFixture,
        measured: false,
      },
    });
    const interactionLatencyReport = createOperatorCockpitBenchmarkEvidenceReport({
      ...completeInput,
      interactionLatencyReport: {
        ...interactionLatencyReportFixture,
        measured: false,
      },
    });
    const memoryReport = createOperatorCockpitBenchmarkEvidenceReport({
      ...completeInput,
      memoryReport: {
        ...memoryReportFixture,
        measured: false,
      },
    });

    expect(targetClarityReport.promotionAllowed).toBe(false);
    expect(targetClarityReport.missingEvidence).toContain("target-clarity-report");
    expect(interactionLatencyReport.promotionAllowed).toBe(false);
    expect(interactionLatencyReport.missingEvidence).toContain("interaction-latency-report");
    expect(memoryReport.promotionAllowed).toBe(false);
    expect(memoryReport.missingEvidence).toContain("memory-report");
  });

  it("blocks promotion when shared baselines are missing even if external evidence is present", () => {
    const baselines = createSharedBaselines();
    const report = createOperatorCockpitBenchmarkEvidenceReport({
      measuredAt: "2026-05-14T13:12:00.000Z",
      fixtureSummary: baselines.fixture.summary,
      browserRenderingEvidence: {
        measuredAt: "2026-05-14T13:12:00.000Z",
        workloadId: "operator-cockpit-phase3",
        measured: true,
        environment: "playwright-ci",
        sampleCount: 5,
      },
      nativeRenderingEvidence: {
        measuredAt: "2026-05-14T13:12:10.000Z",
        workloadId: "operator-cockpit-phase3",
        measured: true,
        environment: "electron-ci",
        sampleCount: 5,
        nativeAdvantageConfirmed: true,
      },
      targetClarityReport: {
        measuredAt: "2026-05-14T13:12:20.000Z",
        workloadId: "operator-cockpit-phase3",
        measured: true,
        complete: true,
        targetCount: 3,
      },
      interactionLatencyReport: {
        measuredAt: "2026-05-14T13:12:30.000Z",
        workloadId: "operator-cockpit-phase3",
        measured: true,
        complete: true,
        sampleCount: 250,
        p95LatencyMs: 45,
      },
      memoryReport: {
        measuredAt: "2026-05-14T13:12:40.000Z",
        workloadId: "operator-cockpit-phase3",
        measured: true,
        complete: true,
        sampleCount: 40,
        peakRssMb: 512,
      },
      projectionViewStateBottleneck: {
        reported: true,
      },
      rustHotPathEvidence: {
        present: true,
        advantageous: true,
      },
    });

    expect(report.status).toBe("rejected");
    expect(report.promotionAllowed).toBe(false);
    expect(report.rustCandidateAllowed).toBe(false);
    expect(report.rustPromotionAllowed).toBe(false);
  });

  it("blocks Rust promotion when Rust proof exists without a reported projection bottleneck", () => {
    const baselines = createSharedBaselines();
    const report = createOperatorCockpitBenchmarkEvidenceReport({
      measuredAt: "2026-05-14T13:13:00.000Z",
      fixtureSummary: baselines.fixture.summary,
      projectionBaseline: baselines.projectionBaseline,
      readOnlyProjectionBaseline: baselines.readOnlyProjectionBaseline,
      readOnlyViewStateBaseline: baselines.readOnlyViewStateBaseline,
      browserRenderingEvidence: {
        measuredAt: "2026-05-14T13:13:00.000Z",
        workloadId: "operator-cockpit-phase3",
        measured: true,
        environment: "playwright-ci",
        sampleCount: 5,
      },
      nativeRenderingEvidence: {
        measuredAt: "2026-05-14T13:13:10.000Z",
        workloadId: "operator-cockpit-phase3",
        measured: true,
        environment: "electron-ci",
        sampleCount: 5,
        nativeAdvantageConfirmed: true,
      },
      targetClarityReport: {
        measuredAt: "2026-05-14T13:13:20.000Z",
        workloadId: "operator-cockpit-phase3",
        measured: true,
        complete: true,
        targetCount: 3,
      },
      interactionLatencyReport: {
        measuredAt: "2026-05-14T13:13:30.000Z",
        workloadId: "operator-cockpit-phase3",
        measured: true,
        complete: true,
        sampleCount: 250,
        p95LatencyMs: 45,
      },
      memoryReport: {
        measuredAt: "2026-05-14T13:13:40.000Z",
        workloadId: "operator-cockpit-phase3",
        measured: true,
        complete: true,
        sampleCount: 40,
        peakRssMb: 512,
      },
      rustHotPathEvidence: {
        present: true,
        advantageous: true,
      },
    });

    expect(report.promotionAllowed).toBe(true);
    expect(report.rustCandidateAllowed).toBe(false);
    expect(report.rustPromotionAllowed).toBe(false);
    expect(report.recommendation).toBe("continue-native-without-rust");
  });

  it("blocks Rust candidacy when Rust is requested without hot-path proof", () => {
    const baselines = createSharedBaselines();
    const report = createOperatorCockpitBenchmarkEvidenceReport({
      measuredAt: "2026-05-14T13:14:00.000Z",
      fixtureSummary: baselines.fixture.summary,
      projectionBaseline: baselines.projectionBaseline,
      readOnlyProjectionBaseline: baselines.readOnlyProjectionBaseline,
      readOnlyViewStateBaseline: baselines.readOnlyViewStateBaseline,
      projectionViewStateBottleneck: {
        reported: true,
      },
      rustHotPathRequested: true,
    });

    expect(report.rustCandidateAllowed).toBe(false);
    expect(report.rustPromotionAllowed).toBe(false);
    expect(report.missingEvidence).toContain("rust-hot-path-proof");
  });

  it("gates Rust candidate and Rust promotion on bottleneck plus Rust evidence", () => {
    const baselines = createSharedBaselines();
    const report = createOperatorCockpitBenchmarkEvidenceReport({
      measuredAt: "2026-05-14T13:15:00.000Z",
      fixtureSummary: baselines.fixture.summary,
      projectionBaseline: baselines.projectionBaseline,
      readOnlyProjectionBaseline: baselines.readOnlyProjectionBaseline,
      readOnlyViewStateBaseline: baselines.readOnlyViewStateBaseline,
      browserRenderingEvidence: {
        measuredAt: "2026-05-14T13:15:00.000Z",
        workloadId: "operator-cockpit-phase3",
        measured: true,
        environment: "playwright-ci",
        sampleCount: 5,
      },
      nativeRenderingEvidence: {
        measuredAt: "2026-05-14T13:15:10.000Z",
        workloadId: "operator-cockpit-phase3",
        measured: true,
        environment: "electron-ci",
        sampleCount: 5,
        nativeAdvantageConfirmed: true,
      },
      targetClarityReport: {
        measuredAt: "2026-05-14T13:15:20.000Z",
        workloadId: "operator-cockpit-phase3",
        measured: true,
        complete: true,
        targetCount: 3,
      },
      interactionLatencyReport: {
        measuredAt: "2026-05-14T13:15:30.000Z",
        workloadId: "operator-cockpit-phase3",
        measured: true,
        complete: true,
        sampleCount: 250,
        p95LatencyMs: 45,
      },
      memoryReport: {
        measuredAt: "2026-05-14T13:15:40.000Z",
        workloadId: "operator-cockpit-phase3",
        measured: true,
        complete: true,
        sampleCount: 40,
        peakRssMb: 512,
      },
      projectionViewStateBottleneck: {
        reported: true,
      },
      rustHotPathEvidence: {
        present: true,
        advantageous: true,
      },
    });

    expect(report.rustCandidateAllowed).toBe(true);
    expect(report.rustPromotionAllowed).toBe(true);
    expect(report.recommendation).toBe("continue-native-with-rust-candidate");
  });
});

describe("operator cockpit benchmark runner admission", () => {
  const fixtureSummary = {
    fixtureId: "phase3-admission",
    instanceCount: 2,
    sessionCount: 10,
    activeManagedSessionCount: 3,
    childInvocationCount: 50,
    eventCount: 100_000,
  } as const;

  it("admits web GUI browser rendering plans only when prerequisites and workload thresholds are met", () => {
    const admission = createOperatorCockpitBenchmarkRunnerAdmission({
      measuredAt: "2026-05-15T09:00:00.000Z",
      surface: "web-gui",
      runnerKind: "browser-rendering",
      workloadKind: "multi-session",
      fixtureSummary,
      prerequisites: {
        runnerAvailable: true,
        rendererAvailable: true,
        fixtureApproved: true,
        baselineEvidencePresent: true,
      },
    });

    expect(admission.status).toBe("admitted");
    expect(admission.missingPrerequisites).toEqual([]);
    expect(admission.failedThresholds).toEqual([]);
    expect(admission.execution).toBe("not-started");
    expect(admission.mutationDispatch).toBe("disabled");
    expect(admission.networkAttach).toBe("not-started");
  });

  it("blocks native rendering when runner or renderer prerequisites are missing", () => {
    const admission = createOperatorCockpitBenchmarkRunnerAdmission({
      measuredAt: "2026-05-15T09:01:00.000Z",
      surface: "native-cockpit",
      runnerKind: "native-rendering",
      workloadKind: "multi-instance",
      fixtureSummary,
      prerequisites: {
        runnerAvailable: false,
        rendererAvailable: false,
        fixtureApproved: true,
        baselineEvidencePresent: true,
      },
    });

    expect(admission.status).toBe("blocked");
    expect(admission.missingPrerequisites).toEqual([
      "runnerAvailable",
      "rendererAvailable",
    ]);
    expect(admission.execution).toBe("not-started");
    expect(admission.mutationDispatch).toBe("disabled");
    expect(admission.networkAttach).toBe("not-started");
  });

  it("blocks workloads that fail threshold requirements", () => {
    const admission = createOperatorCockpitBenchmarkRunnerAdmission({
      measuredAt: "2026-05-15T09:02:00.000Z",
      surface: "web-gui",
      runnerKind: "browser-rendering",
      workloadKind: "single-session-heavy",
      fixtureSummary: {
        fixtureId: "insufficient-workload",
        instanceCount: 1,
        sessionCount: 1,
        activeManagedSessionCount: 1,
        childInvocationCount: 49,
        eventCount: 99_999,
      },
      prerequisites: {
        runnerAvailable: true,
        rendererAvailable: true,
        fixtureApproved: true,
        baselineEvidencePresent: true,
      },
    });

    expect(admission.status).toBe("blocked");
    expect(admission.missingPrerequisites).toEqual([]);
    expect(admission.failedThresholds).toEqual([
      "minimum-child-invocation-count",
      "minimum-event-count",
    ]);
    expect(admission.execution).toBe("not-started");
    expect(admission.mutationDispatch).toBe("disabled");
    expect(admission.networkAttach).toBe("not-started");
  });

  it("fails closed for single-session-heavy workload when session count is below minimum", () => {
    const admission = createOperatorCockpitBenchmarkRunnerAdmission({
      measuredAt: "2026-05-15T09:05:00.000Z",
      surface: "web-gui",
      runnerKind: "browser-rendering",
      workloadKind: "single-session-heavy",
      fixtureSummary: {
        fixtureId: "invalid-single-session",
        instanceCount: 1,
        sessionCount: 0,
        activeManagedSessionCount: 0,
        childInvocationCount: 50,
        eventCount: 100_000,
      },
      prerequisites: {
        runnerAvailable: true,
        rendererAvailable: true,
        fixtureApproved: true,
        baselineEvidencePresent: true,
      },
    });

    expect(admission.status).toBe("blocked");
    expect(admission.failedThresholds).toContain("minimum-session-count");
    expect(admission.execution).toBe("not-started");
    expect(admission.mutationDispatch).toBe("disabled");
    expect(admission.networkAttach).toBe("not-started");
  });

  it("blocks web GUI plans that request native rendering", () => {
    const admission = createOperatorCockpitBenchmarkRunnerAdmission({
      measuredAt: "2026-05-15T09:03:00.000Z",
      surface: "web-gui",
      runnerKind: "native-rendering",
      workloadKind: "multi-session",
      fixtureSummary,
      prerequisites: {
        runnerAvailable: true,
        rendererAvailable: true,
        fixtureApproved: true,
        baselineEvidencePresent: true,
      },
    });

    expect(admission.status).toBe("blocked");
    expect(admission.failedThresholds).toContain("surface-runner-mismatch");
    expect(admission.execution).toBe("not-started");
    expect(admission.mutationDispatch).toBe("disabled");
    expect(admission.networkAttach).toBe("not-started");
  });

  it("blocks native cockpit plans that request browser rendering", () => {
    const admission = createOperatorCockpitBenchmarkRunnerAdmission({
      measuredAt: "2026-05-15T09:04:00.000Z",
      surface: "native-cockpit",
      runnerKind: "browser-rendering",
      workloadKind: "multi-instance",
      fixtureSummary,
      prerequisites: {
        runnerAvailable: true,
        rendererAvailable: true,
        fixtureApproved: true,
        baselineEvidencePresent: true,
      },
    });

    expect(admission.status).toBe("blocked");
    expect(admission.failedThresholds).toContain("surface-runner-mismatch");
    expect(admission.execution).toBe("not-started");
    expect(admission.mutationDispatch).toBe("disabled");
    expect(admission.networkAttach).toBe("not-started");
  });

  it("blocks contradictory fixture summaries when active managed sessions exceed session count", () => {
    const admission = createOperatorCockpitBenchmarkRunnerAdmission({
      measuredAt: "2026-05-15T09:06:00.000Z",
      surface: "web-gui",
      runnerKind: "browser-rendering",
      workloadKind: "multi-session",
      fixtureSummary: {
        fixtureId: "contradictory-summary",
        instanceCount: 2,
        sessionCount: 10,
        activeManagedSessionCount: 11,
        childInvocationCount: 50,
        eventCount: 100_000,
      },
      prerequisites: {
        runnerAvailable: true,
        rendererAvailable: true,
        fixtureApproved: true,
        baselineEvidencePresent: true,
      },
    });

    expect(admission.status).toBe("blocked");
    expect(admission.failedThresholds).toContain("invalid-active-managed-session-count");
    expect(admission.execution).toBe("not-started");
    expect(admission.mutationDispatch).toBe("disabled");
    expect(admission.networkAttach).toBe("not-started");
  });
});
