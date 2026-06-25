import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GuiInboundFrame, OperatorSessionEvent } from "@kilnai/gateway-contracts";
import {
  createOperatorCockpitBenchmarkFixture,
} from "@kilnai/gateway-contracts";
import {
  createNativeBrowserWindowOptions,
  createNativeSurfaceCapabilitySnapshot,
  createNativeSurfaceProjection,
  createNativeSurfaceTelemetry,
} from "../src/shared/native-surface.js";
import {
  createNativeBrowserHostEvidenceEvent,
  createNativeBrowserHostPolicy,
  createNativeBrowserHostSessionState,
  createNativeEmbeddedBrowserHostOptions,
  isNativeBrowserHostNavigationAllowed,
  nativeBrowserHostOperatorInputAllowed,
  nativeBrowserHostRuntimeActionAllowed,
} from "../src/shared/native-browser-host.js";
import {
  createNativeBrowserOperatorSurfaceProjection,
  createNativeBrowserRegionBounds,
  nativeBrowserOperatorActionAllowed,
} from "../src/shared/native-browser-operator-surface.js";
import {
  NATIVE_COCKPIT_BENCHMARK_FIXTURES,
  createNativeCockpitReadOnlyViewStateBaseline,
  createNativeCockpitPreconditionReview,
  createNativeCockpitReadOnlyAttachPlan,
  createNativeCockpitReadOnlyActionIntent,
  createNativeCockpitReadOnlyProjection,
  createNativeCockpitReadOnlyViewState,
  nativeCockpitActionAllowed,
} from "../src/shared/native-cockpit-contract.js";
import {
  createNativeManagedAgentCancelControlFrame,
  createNativeGatewayCockpitFrameState,
  reduceNativeGatewayCockpitFrame,
  resolveNativeGatewayCockpitWebSocketUrl,
  selectNativeManagedAgentDrilldownTarget,
  selectNativeWorkItems,
} from "../src/renderer/native-gateway-cockpit.js";

describe("native operator surface foundation", () => {
  it("advertises native capability slots including the proven embedded browser host", () => {
    const snapshot = createNativeSurfaceCapabilitySnapshot({
      surfaceId: "native:local",
      generatedAt: "2026-05-14T12:00:00.000Z",
    });

    expect(snapshot.surface).toBe("native");
    expect(snapshot.capabilities).toContainEqual({
      capability: "gateway-attach",
      status: "available",
    });
    expect(snapshot.capabilities).toContainEqual({
      capability: "native-window-lifecycle",
      status: "available",
    });
    expect(snapshot.capabilities).toContainEqual({
      capability: "native-cockpit-contract",
      status: "available",
      reason: "Roadmap 05 target, precondition, benchmark, read-only attach-plan, projection, and action-intent contracts are available.",
    });
    expect(snapshot.capabilities).toContainEqual({
      capability: "embedded-browser-host",
      status: "available",
      reason: "Electron WebContentsView host proof is available behind the native host adapter.",
    });
    expect(snapshot.capabilities).toContainEqual({
      capability: "voice-output-playback",
      status: "available",
      reason: "Native advertises the shared voice output playback surface capability; runtime voice policy remains app-owned.",
    });
    expect(snapshot.capabilities).toContainEqual({
      capability: "voice-output-on-demand",
      status: "available",
      reason: "Native advertises the shared on-demand voice output action capability; runtime voice policy remains app-owned.",
    });
    expect(snapshot.capabilities).toContainEqual({
      capability: "voice-input-capture",
      status: "available",
      reason: "Native advertises microphone/file capture as a surface capability; STT provider policy remains app-owned.",
    });
  });

  it("uses hardened browser window options for renderer isolation", () => {
    const options = createNativeBrowserWindowOptions();

    expect(options.webPreferences?.nodeIntegration).toBe(false);
    expect(options.webPreferences?.contextIsolation).toBe(true);
    expect(options.webPreferences?.sandbox).toBe(true);
    expect(options.webPreferences?.webSecurity).toBe(true);
    expect(options.webPreferences?.preload).toBeUndefined();
  });

  it("projects session and authority state from gateway-contract event data", () => {
    const projection = createNativeSurfaceProjection({
      connected: true,
      gatewayUrl: "http://localhost:4810",
      sessionId: "session-1",
      authority: "audited",
      providerRoute: "codex-oauth/gpt-5.4",
      theme: "kiln-dark",
      latestEvent: {
        eventId: "session-1:1",
        kilnSessionId: "session-1",
        sequence: 1,
        timestamp: "2026-05-14T12:00:00.000Z",
        kind: "session_started",
        source: {
          actor: "runtime",
          surface: "native",
          component: "native-smoke",
        },
        payload: {
          prompt: "do not render raw prompt text as runtime truth",
        },
      },
    });

    expect(projection.sessionId).toBe("session-1");
    expect(projection.authority).toBe("audited");
    expect(projection.providerRoute).toBe("codex-oauth/gpt-5.4");
    expect(projection.latestEvent?.title).toBe("Session Started");
    expect(projection.latestEvent?.payload).toBeUndefined();
  });

  it("records performance telemetry without reading runtime-owned config", () => {
    const telemetry = createNativeSurfaceTelemetry({
      startedAtMs: 100,
      firstPaintAtMs: 128,
      frameHandledAtMs: 142,
      projectedAtMs: 151,
      memoryUsageBytes: 512_000,
      droppedFrames: 0,
    });

    expect(telemetry.firstPaintMs).toBe(28);
    expect(telemetry.frameHandlingMs).toBe(42);
    expect(telemetry.projectionUpdateMs).toBe(51);
    expect(telemetry.memoryUsageBytes).toBe(512_000);
  });

  it("does not depend on core or runtime implementation packages", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies?.["@kilnai/core"]).toBeUndefined();
    expect(packageJson.dependencies?.["@kilnai/runtime"]).toBeUndefined();
    expect(packageJson.devDependencies?.["@kilnai/core"]).toBeUndefined();
    expect(packageJson.devDependencies?.["@kilnai/runtime"]).toBeUndefined();
  });

  it("configures the embedded browser host with isolated ephemeral security defaults", () => {
    const options = createNativeEmbeddedBrowserHostOptions({
      sessionId: "browser-1",
    });

    expect(options.transport).toBe("electron-webcontents");
    expect(options.webPreferences.nodeIntegration).toBe(false);
    expect(options.webPreferences.contextIsolation).toBe(true);
    expect(options.webPreferences.sandbox).toBe(true);
    expect(options.webPreferences.webSecurity).toBe(true);
    expect(options.webPreferences.allowRunningInsecureContent).toBe(false);
    expect(options.webPreferences.preload).toBeUndefined();
    expect(options.webPreferences.partition).toBe("kiln-embedded-browser-host:browser-1");
    expect(options.webPreferences.partition.startsWith("persist:")).toBe(false);
  });

  it("fails closed for unapproved embedded browser navigation", () => {
    const policy = createNativeBrowserHostPolicy({
      allowedUrls: ["file:///C:/workspace/kiln/packages/native/proof/browser-host-proof.html"],
    });

    expect(isNativeBrowserHostNavigationAllowed(
      "file:///C:/workspace/kiln/packages/native/proof/browser-host-proof.html",
      policy,
    )).toBe(true);
    expect(isNativeBrowserHostNavigationAllowed("https://example.com", policy)).toBe(false);
    expect(isNativeBrowserHostNavigationAllowed("javascript:alert(1)", policy)).toBe(false);
  });

  it("projects embedded browser host state and evidence through gateway-shaped data", () => {
    const state = createNativeBrowserHostSessionState({
      sessionId: "browser-1",
      kilnSessionId: "session-1",
      url: "file:///proof.html",
      title: "Kiln Browser Host Proof",
      updatedAt: "2026-05-14T12:00:00.000Z",
      viewport: {
        width: 1024,
        height: 640,
      },
      ownership: "operator",
    });
    const event = createNativeBrowserHostEvidenceEvent({
      eventId: "session-1:browser-host:1",
      kilnSessionId: "session-1",
      sequence: 1,
      timestamp: "2026-05-14T12:00:00.000Z",
      sessionId: "browser-1",
      action: "operator_input",
      url: "file:///proof.html",
      title: "Kiln Browser Host Proof",
      input: {
        kind: "text",
        textLength: 5,
      },
      acknowledgement: {
        status: "accepted",
      },
    });

    expect(state.latestCapture?.transport).toBe("electron-webcontents");
    expect(state.stream.status).toBe("live");
    expect(event.kind).toBe("browser_operator_evidence");
    expect(event.source.surface).toBe("native");
    expect(event.payload).toMatchObject({
      hostTransport: "electron-webcontents",
      browserSessionId: "browser-1",
      input: {
        kind: "text",
        textLength: 5,
      },
    });
    expect(JSON.stringify(event.payload)).not.toContain("typed secret");
  });

  it("keeps runtime dispatch and operator input mutually gated by ownership", () => {
    expect(nativeBrowserHostRuntimeActionAllowed({ ownership: "agent" })).toBe(true);
    expect(nativeBrowserHostRuntimeActionAllowed({ ownership: "operator" })).toBe(false);
    expect(nativeBrowserHostOperatorInputAllowed({ ownership: "operator" })).toBe(true);
    expect(nativeBrowserHostOperatorInputAllowed({ ownership: "agent" })).toBe(false);
    expect(nativeBrowserHostOperatorInputAllowed({ ownership: "released" })).toBe(false);
  });

  it("reserves a stable embedded browser region for the native operator surface", () => {
    const bounds = createNativeBrowserRegionBounds({
      windowWidth: 1280,
      windowHeight: 820,
    });

    expect(bounds).toEqual({
      x: 24,
      y: 232,
      width: 828,
      height: 572,
    });
  });

  it("projects embedded browser operator surface state without owning runtime truth", () => {
    const state = createNativeBrowserHostSessionState({
      sessionId: "browser-1",
      kilnSessionId: "session-1",
      url: "file:///proof.html",
      title: "Kiln Browser Host Proof",
      updatedAt: "2026-05-14T12:00:00.000Z",
      viewport: {
        width: 820,
        height: 548,
      },
      ownership: "agent",
    });
    const projection = createNativeBrowserOperatorSurfaceProjection({
      state,
      evidenceCount: 4,
      lastEvidenceAction: "runtime_dispatch",
      lastObservation: {
        url: "file:///proof.html",
        title: "Kiln Browser Host Proof",
        proofInputValue: "kiln!",
        scrollY: 480,
      },
    });

    expect(projection.surfaceMode).toBe("embedded-browser");
    expect(projection.transport).toBe("electron-webcontents");
    expect(projection.ownership).toBe("agent");
    expect(projection.operatorCanInput).toBe(false);
    expect(projection.runtimeCanDispatch).toBe(true);
    expect(projection.evidenceCount).toBe(4);
    expect(projection.lastEvidenceAction).toBe("runtime_dispatch");
    expect(projection.lastObservation?.proofInputValue).toBe("kiln!");
  });

  it("admits embedded browser operator actions only for the correct ownership state", () => {
    expect(nativeBrowserOperatorActionAllowed({
      action: "takeover",
      ownership: "agent",
    })).toBe(true);
    expect(nativeBrowserOperatorActionAllowed({
      action: "operator_input",
      ownership: "operator",
    })).toBe(true);
    expect(nativeBrowserOperatorActionAllowed({
      action: "release",
      ownership: "operator",
    })).toBe(true);
    expect(nativeBrowserOperatorActionAllowed({
      action: "runtime_dispatch",
      ownership: "agent",
    })).toBe(true);
    expect(nativeBrowserOperatorActionAllowed({
      action: "operator_input",
      ownership: "agent",
    })).toBe(false);
  });

  it("keeps native cockpit prototype start gated by roadmap preconditions", () => {
    const review = createNativeCockpitPreconditionReview({
      highDensityWorkloads: "synthetic",
      configProjectionStable: true,
      gatewayEventStreams: true,
      guiBaselineBenchmarks: false,
      managedInvocationLifecycleEvents: true,
      authorityProviderProjections: true,
      gatewayMediatedCancellation: false,
    });

    expect(review.canStartContractPhase).toBe(true);
    expect(review.canStartReadOnlyPrototype).toBe(false);
    expect(review.missingForReadOnlyPrototype).toEqual([
      "gui-baseline-benchmarks",
      "gateway-mediated-cancellation",
    ]);
  });

  it("allows native cockpit read-only prototype after baselines and cancellation targets exist", () => {
    const review = createNativeCockpitPreconditionReview({
      highDensityWorkloads: "synthetic",
      configProjectionStable: true,
      gatewayEventStreams: true,
      guiBaselineBenchmarks: true,
      managedInvocationLifecycleEvents: true,
      authorityProviderProjections: true,
      gatewayMediatedCancellation: true,
    });

    expect(review.canStartContractPhase).toBe(true);
    expect(review.canStartReadOnlyPrototype).toBe(true);
    expect(review.missingForReadOnlyPrototype).toEqual([]);
  });

  it("requires explicit cockpit targets before admitting operator actions", () => {
    expect(nativeCockpitActionAllowed({
      action: "inspect",
      target: {
        instanceId: "local",
      },
    })).toBe(true);
    expect(nativeCockpitActionAllowed({
      action: "focus_session",
      target: {
        instanceId: "local",
        sessionId: "session-1",
      },
    })).toBe(true);
    expect(nativeCockpitActionAllowed({
      action: "cancel",
      target: {
        instanceId: "local",
        sessionId: "session-1",
        managedInvocationId: "child-1",
      },
    })).toBe(true);
    expect(nativeCockpitActionAllowed({
      action: "focus_session",
      target: {
        instanceId: "local",
      },
    })).toBe(false);
    expect(nativeCockpitActionAllowed({
      action: "cancel",
      target: {
        instanceId: "local",
        sessionId: "session-1",
      },
    })).toBe(false);
  });

  it("projects native cockpit read-only views through shared gateway contracts", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "native-read-only",
      instanceCount: 2,
      sessionCount: 3,
      activeManagedSessionCount: 2,
      childInvocationCount: 4,
      eventCount: 24,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const projection = createNativeCockpitReadOnlyProjection({
      surfaceId: "native:local",
      projectedAt: "2026-05-14T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "native-read-only:instance:1",
          label: "Local / kiln",
          kind: "local",
          gatewayUrl: "http://127.0.0.1:4810",
        },
        {
          instanceId: "native-read-only:instance:2",
          label: "Simulated remote",
          kind: "simulated-remote",
          gatewayUrl: "https://example.invalid",
        },
      ],
      events: fixture.events,
    });

    expect(projection.surfaceMode).toBe("operator-cockpit");
    expect(projection.surfaceId).toBe("native:local");
    expect(projection.runtimeBoundary).toBe("gateway-contracts");
    expect(projection.mutationDispatch).toBe("disabled");
    expect(projection.view.mode).toBe("read-only");
    expect(projection.view.instances).toHaveLength(2);
    expect(projection.view.sessions).toHaveLength(3);
    expect(projection.view.timeline[0]).toMatchObject({
      eventId: "native-read-only:event:1",
      target: {
        instanceId: "native-read-only:instance:1",
        sessionId: "native-read-only:session:1",
        eventId: "native-read-only:event:1",
      },
    });
    expect(projection.view.invocations.length).toBeGreaterThan(0);
    expect(projection.view.invocations.every((invocation) => invocation.promptAdmissionCount === 0)).toBe(true);
    expect(projection.view.invocations.every((invocation) => invocation.latestPromptAdmission === undefined)).toBe(true);
    expect(JSON.stringify(projection)).not.toContain("inputSummary");
    expect(JSON.stringify(projection)).not.toContain("promptHash");
  });

  it("inherits fail-closed attach target validation for native cockpit projection", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "native-missing-target",
      instanceCount: 1,
      sessionCount: 1,
      activeManagedSessionCount: 1,
      childInvocationCount: 1,
      eventCount: 4,
      startedAt: "2026-05-14T12:00:00.000Z",
    });

    expect(() => createNativeCockpitReadOnlyProjection({
      surfaceId: "native:local",
      projectedAt: "2026-05-14T12:01:00.000Z",
      attachTargets: [],
      events: fixture.events,
    })).toThrow("requires at least one attach target");
  });

  it("plans native read-only cockpit attachment without starting gateway networking", () => {
    const attachPlan = createNativeCockpitReadOnlyAttachPlan({
      surfaceId: "native:local",
      plannedAt: "2026-05-14T12:04:00.000Z",
      attachTargets: [
        {
          instanceId: "native-attach:local",
          label: "Local / kiln",
          kind: "local",
          gatewayUrl: "http://127.0.0.1:4810",
        },
        {
          instanceId: "native-attach:remote",
          label: "Simulated remote",
          kind: "simulated-remote",
          gatewayUrl: "https://example.invalid",
        },
      ],
    });

    expect(attachPlan.surfaceMode).toBe("operator-cockpit");
    expect(attachPlan.surfaceId).toBe("native:local");
    expect(attachPlan.runtimeBoundary).toBe("gateway-contracts");
    expect(attachPlan.networkAttach).toBe("not-started");
    expect(attachPlan.mutationDispatch).toBe("disabled");
    expect(attachPlan.plan.targets).toEqual([
      expect.objectContaining({
        instanceId: "native-attach:local",
        connectionKind: "operator-gateway",
        connectionState: "planned",
      }),
      expect.objectContaining({
        instanceId: "native-attach:remote",
        connectionKind: "simulated-app-gateway",
        connectionState: "planned",
      }),
    ]);
  });

  it("resolves native gateway cockpit websocket endpoints without changing the runtime gateway", () => {
    expect(resolveNativeGatewayCockpitWebSocketUrl("http://127.0.0.1:4810")).toBe(
      "ws://127.0.0.1:4810/gui/ws?userId=native-operator",
    );
    expect(resolveNativeGatewayCockpitWebSocketUrl("https://kiln.example.test/base?ignored=true")).toBe(
      "wss://kiln.example.test/gui/ws?userId=native-operator",
    );
    expect(resolveNativeGatewayCockpitWebSocketUrl("not a url")).toBe(
      "ws://localhost:4810/gui/ws?userId=native-operator",
    );
    expect(resolveNativeGatewayCockpitWebSocketUrl("/relative")).toBe(
      "ws://localhost:4810/gui/ws?userId=native-operator",
    );
  });

  it("creates native managed-agent cancellation frames for the shared gateway control channel", () => {
    expect(createNativeManagedAgentCancelControlFrame({
      sessionId: "session-1",
      invocationId: "child-running",
      gatewayTargetId: "gateway:native-app",
      requestId: "native-managed-agent-cancel-1",
      reason: "Operator cancelled the managed child from the native cockpit.",
    })).toEqual({
      type: "managed_agent_control",
      action: "cancel",
      sessionId: "session-1",
      invocationId: "child-running",
      gatewayTargetId: "gateway:native-app",
      requestId: "native-managed-agent-cancel-1",
      reason: "Operator cancelled the managed child from the native cockpit.",
    });

    expect(() => createNativeManagedAgentCancelControlFrame({
      sessionId: " ",
      invocationId: "child-running",
    })).toThrow("Native managed-agent cancellation requires sessionId and invocationId.");
  });

  it("ingests only read-only native gateway cockpit frames", () => {
    const managedEvent: OperatorSessionEvent = {
      eventId: "event-managed-started",
      kilnSessionId: "session-1",
      sequence: 1,
      timestamp: "2026-05-23T12:00:00.000Z",
      kind: "agent_invocation_started",
      payload: {
        instanceId: "native-local",
        sessionId: "session-1",
        managedInvocationId: "child-1",
      },
    };
    const initial = createNativeGatewayCockpitFrameState();
    const welcomed = reduceNativeGatewayCockpitFrame(initial, {
      type: "welcome",
      providers: [],
      models: {},
      executionMode: "execute",
      authorityStatus: {
        effective: "read_only",
        completeness: "authoritative",
      },
    } satisfies GuiInboundFrame);
    const withEvent = reduceNativeGatewayCockpitFrame(welcomed, {
      type: "session_event",
      event: managedEvent,
    } satisfies GuiInboundFrame);
    const deduped = reduceNativeGatewayCockpitFrame(withEvent, {
      type: "session_event",
      event: managedEvent,
    } satisfies GuiInboundFrame);
    const afterMutationAck = reduceNativeGatewayCockpitFrame(deduped, {
      type: "managed_agent_control_result",
      action: "cancel",
      sessionId: "session-1",
      invocationId: "child-1",
      status: "accepted",
      handledAt: "2026-05-23T12:00:01.000Z",
    } satisfies GuiInboundFrame);

    expect(welcomed.connectionState).toBe("open");
    expect(withEvent.events).toEqual([managedEvent]);
    expect(deduped.events).toHaveLength(1);
    expect(afterMutationAck).toBe(deduped);
  });

  it("selects native managed-agent drilldown target from the latest canonical event", () => {
    const events: OperatorSessionEvent[] = [
      {
        eventId: "event-managed-started",
        kilnSessionId: "session-1",
        sequence: 1,
        timestamp: "2026-05-23T12:00:00.000Z",
        kind: "agent_invocation_started",
        payload: {
          instanceId: "native-local",
          sessionId: "session-1",
          managedInvocationId: "child-1",
        },
      },
      {
        eventId: "event-managed-completed",
        kilnSessionId: "session-1",
        sequence: 2,
        timestamp: "2026-05-23T12:00:01.000Z",
        kind: "agent_invocation_completed",
        payload: {
          instanceId: "native-local",
          sessionId: "session-1",
          invocationId: "child-2",
        },
      },
      {
        eventId: "event-work-adoption",
        kilnSessionId: "session-1",
        sequence: 3,
        timestamp: "2026-05-23T12:00:02.000Z",
        kind: "work_item_updated",
        payload: {
          instanceId: "native-local",
          sessionId: "session-1",
          managedOrchestrationAdoptionGate: {
            required: true,
            status: "adopted",
            childId: "child-3",
            resourceUris: [],
            blockingEvidence: [],
          },
        },
      },
    ];

    expect(selectNativeManagedAgentDrilldownTarget(events)).toEqual({
      instanceId: "native-local",
      sessionId: "session-1",
      managedInvocationId: "child-3",
      replayEventId: "event-work-adoption",
    });
  });

  it("projects governed work item visibility from canonical session events", () => {
    const events: OperatorSessionEvent[] = [
      {
        eventId: "event-work-visible",
        kilnSessionId: "session-1",
        sequence: 1,
        timestamp: "2026-06-24T10:00:00.000Z",
        kind: "work_item_updated",
        payload: {
          workItem: {
            id: "work-visible",
            summary: "Audit native work item visibility.",
            status: "blocked",
            workflowProfile: "verification-heavy",
            authorityProfile: "authority:foundation-readonly-plan",
            assignedAgentProfile: "foundation-readonly-plan",
            expectedEvidence: ["surface-map", "tests"],
            providedEvidence: ["surface-map"],
            missingEvidence: ["tests"],
            missingResidualRisk: true,
            pauseRequirements: [
              {
                id: "capability-1",
                kind: "capability",
                summary: "Route unavailable",
                status: "pending",
              },
            ],
            updatedAt: "2026-06-24T10:00:00.000Z",
          },
        },
      },
    ];

    expect(selectNativeWorkItems(events)).toEqual([
      {
        id: "work-visible",
        resourceUri: "kiln://session/work-items/work-visible",
        summary: "Audit native work item visibility.",
        status: "blocked",
        workflowProfile: "verification-heavy",
        authorityProfile: "authority:foundation-readonly-plan",
        assignedAgentProfile: "foundation-readonly-plan",
        expectedEvidence: ["surface-map", "tests"],
        providedEvidence: ["surface-map"],
        missingEvidence: ["tests", "residual-risk"],
        pendingPauseRequirementCount: 1,
        updatedAt: "2026-06-24T10:00:00.000Z",
      },
    ]);
  });

  it("marks native gateway cockpit attach as closed without dropping read-only event state", () => {
    const managedEvent: OperatorSessionEvent = {
      eventId: "event-managed-started",
      kilnSessionId: "session-1",
      sequence: 1,
      timestamp: "2026-05-23T12:00:00.000Z",
      kind: "agent_invocation_started",
      payload: {
        instanceId: "native-local",
        sessionId: "session-1",
        managedInvocationId: "child-1",
      },
    };
    const openState = reduceNativeGatewayCockpitFrame(
      reduceNativeGatewayCockpitFrame(createNativeGatewayCockpitFrameState(), {
        type: "welcome",
        providers: [],
        models: {},
        executionMode: "execute",
        authorityStatus: {
          effective: "read_only",
          completeness: "authoritative",
        },
      } satisfies GuiInboundFrame),
      {
        type: "session_event",
        event: managedEvent,
      } satisfies GuiInboundFrame,
    );

    const closed = reduceNativeGatewayCockpitFrame(openState, {
      type: "native_gateway_closed",
      reason: "socket closed",
    });

    expect(closed.connectionState).toBe("closed");
    expect(closed.error).toBe("socket closed");
    expect(closed.events).toEqual([managedEvent]);
  });

  it("creates native read-only cockpit action intents without dispatching mutations", () => {
    const intent = createNativeCockpitReadOnlyActionIntent({
      surfaceId: "native:local",
      action: "focus_session",
      requestedAt: "2026-05-14T12:02:00.000Z",
      target: {
        instanceId: "local",
        sessionId: "session-1",
      },
    });

    expect(intent).toEqual({
      surfaceId: "native:local",
      runtimeBoundary: "gateway-contracts",
      mutationDispatch: "disabled",
      intent: {
        mode: "read-only",
        action: "focus_session",
        requestedAt: "2026-05-14T12:02:00.000Z",
        dispatch: "not-dispatched",
        target: {
          instanceId: "local",
          sessionId: "session-1",
        },
      },
    });
  });

  it("keeps read-only action intents from dispatching cancellation outside the gateway control channel", () => {
    expect(() => createNativeCockpitReadOnlyActionIntent({
      surfaceId: "native:local",
      action: "cancel",
      requestedAt: "2026-05-14T12:02:00.000Z",
      target: {
        instanceId: "local",
        sessionId: "session-1",
        managedInvocationId: "child-1",
      },
    })).toThrow("not available in read-only cockpit mode");
  });

  it("wraps shared read-only cockpit view-state with native boundary metadata", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "native-view-state",
      instanceCount: 1,
      sessionCount: 1,
      activeManagedSessionCount: 1,
      childInvocationCount: 2,
      eventCount: 10,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const projection = createNativeCockpitReadOnlyProjection({
      surfaceId: "native:local",
      projectedAt: "2026-05-14T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "native-view-state:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
      ],
      events: fixture.events,
    });
    const cursorEvent = projection.view.timeline[1]!;
    const viewState = createNativeCockpitReadOnlyViewState({
      surfaceId: "native:local",
      projection: projection.view,
      viewState: {
        focusTarget: {
          instanceId: cursorEvent.instanceId,
          sessionId: cursorEvent.sessionId,
        },
        replayCursor: {
          instanceId: cursorEvent.instanceId,
          sessionId: cursorEvent.sessionId,
          eventId: cursorEvent.eventId,
        },
      },
    });

    expect(viewState.surfaceId).toBe("native:local");
    expect(viewState.runtimeBoundary).toBe("gateway-contracts");
    expect(viewState.mutationDispatch).toBe("disabled");
    expect(viewState.view.mode).toBe("read-only");
    expect(viewState.view.dispatch).toBe("not-dispatched");
    expect(viewState.workspaceHome.mode).toBe("read-only");
    expect(viewState.workspaceHome.projectedAt).toBe(projection.view.projectedAt);
    expect(viewState.workspaceHome.managedAgents).toEqual({
      totalCount: viewState.view.managedAgents.items.length,
      activeCount: viewState.view.managedAgents.activeCount,
      attentionCount: viewState.view.managedAgents.attentionCount,
    });
    expect(viewState.workspaceHome.gatewayTargets[0]?.gatewayTarget).toMatchObject({
      targetId: "native-view-state:instance:1",
      kind: "local-operator-gateway",
      trust: "local",
    });
    expect(viewState.view.focus.resolved).toBe(true);
    expect(viewState.view.replay.resolved).toBe(true);
    expect(viewState.view.replay.entry?.eventId).toBe(cursorEvent.eventId);
  });

  it("fails closed in native wrapper for unknown focus and replay targets", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "native-view-state-fail",
      instanceCount: 1,
      sessionCount: 1,
      activeManagedSessionCount: 1,
      childInvocationCount: 1,
      eventCount: 6,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const projection = createNativeCockpitReadOnlyProjection({
      surfaceId: "native:local",
      projectedAt: "2026-05-14T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "native-view-state-fail:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
      ],
      events: fixture.events,
    });
    const viewState = createNativeCockpitReadOnlyViewState({
      surfaceId: "native:local",
      projection: projection.view,
      viewState: {
        focusTarget: {
          instanceId: "native-view-state-fail:instance:missing",
          sessionId: "native-view-state-fail:session:missing",
        },
        replayCursor: {
          instanceId: "native-view-state-fail:instance:missing",
          sessionId: "native-view-state-fail:session:missing",
          eventId: "native-view-state-fail:event:missing",
        },
      },
    });

    expect(viewState.view.focus.resolved).toBe(false);
    expect(viewState.view.replay.resolved).toBe(false);
    expect(viewState.view.replay.entry).toBeUndefined();
  });

  it("wraps shared read-only view-state baseline with native boundary metadata", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "native-view-state-baseline",
      instanceCount: 1,
      sessionCount: 1,
      activeManagedSessionCount: 1,
      childInvocationCount: 2,
      eventCount: 10,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const baseline = createNativeCockpitReadOnlyViewStateBaseline({
      surfaceId: "native:local",
      measuredAt: "2026-05-14T12:07:00.000Z",
      fixture,
      attachTargets: [
        {
          instanceId: "native-view-state-baseline:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
      ],
      viewState: {
        focusTarget: {
          instanceId: "native-view-state-baseline:instance:1",
          sessionId: "native-view-state-baseline:session:1",
        },
      },
    });

    expect(baseline.surfaceId).toBe("native:local");
    expect(baseline.runtimeBoundary).toBe("gateway-contracts");
    expect(baseline.mutationDispatch).toBe("disabled");
    expect(baseline.baseline.surface).toBe("shared-read-only-cockpit-view-state");
    expect(baseline.baseline.focusResolved).toBe(true);
  });

  it("fails closed in native view-state baseline for invalid selectors without throwing", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "native-view-state-baseline-fail",
      instanceCount: 1,
      sessionCount: 1,
      activeManagedSessionCount: 1,
      childInvocationCount: 1,
      eventCount: 6,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const baseline = createNativeCockpitReadOnlyViewStateBaseline({
      surfaceId: "native:local",
      measuredAt: "2026-05-14T12:08:00.000Z",
      fixture,
      attachTargets: [
        {
          instanceId: "native-view-state-baseline-fail:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
      ],
      viewState: {
        focusTarget: {
          instanceId: "native-view-state-baseline-fail:instance:missing",
          sessionId: "native-view-state-baseline-fail:session:missing",
        },
        filters: {
          sessionId: "native-view-state-baseline-fail:session:1",
        },
        replayCursor: {
          instanceId: "native-view-state-baseline-fail:instance:missing",
          sessionId: "native-view-state-baseline-fail:session:missing",
          eventId: "native-view-state-baseline-fail:event:missing",
        },
      },
    });

    expect(baseline.baseline.focusResolved).toBe(false);
    expect(baseline.baseline.timelineValid).toBe(false);
    expect(baseline.baseline.replayResolved).toBe(false);
  });

  it("defines high-density benchmark fixtures before native cockpit promotion", () => {
    expect(NATIVE_COCKPIT_BENCHMARK_FIXTURES.singleSessionHeavy).toMatchObject({
      minimumSessionCount: 1,
      minimumChildInvocationCount: 50,
      minimumEventCount: 100_000,
    });
    expect(NATIVE_COCKPIT_BENCHMARK_FIXTURES.multiSession).toMatchObject({
      minimumSessionCount: 10,
      minimumActiveManagedSessionCount: 3,
      minimumChildInvocationCount: 50,
      minimumEventCount: 100_000,
    });
    expect(NATIVE_COCKPIT_BENCHMARK_FIXTURES.multiInstance.minimumInstanceCount).toBe(2);
    expect(NATIVE_COCKPIT_BENCHMARK_FIXTURES.projectionHotPath.requiresIdenticalOutput).toBe(true);
  });
});
