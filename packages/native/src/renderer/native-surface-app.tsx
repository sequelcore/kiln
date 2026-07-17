import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { OperatorSessionEvent } from "@kilnai/gateway-contracts";
import {
  createNativeSurfaceCapabilitySnapshot,
  createNativeSurfaceProjection,
  createNativeSurfaceTelemetry,
} from "../shared/native-surface";
import {
  createNativeCockpitReadOnlyProjection,
  createNativeCockpitReadOnlyViewState,
} from "../shared/native-cockpit-contract";
import {
  createNativeManagedAgentCancelControlFrame,
  createNativeGatewayCockpitFrameState,
  readNativeGatewayCockpitFrame,
  reduceNativeGatewayCockpitFrame,
  resolveNativeGatewayCockpitWebSocketUrl,
  selectNativeManagedAgentDrilldownTarget,
  selectNativeWorkItems,
} from "./native-gateway-cockpit";
import type {
  EmbeddedBrowserOperatorSurfaceSnapshot,
} from "./native-api";
import { ManagedAgentCockpitPanel } from "./managed-agent-cockpit-panel";
import { NativeWorkItemsPanel } from "./native-work-items-panel";
import "./styles.css";

const gatewayUrl = new URLSearchParams(window.location.search).get("gateway")
  ?? "http://localhost:4810";

const latestEvent: OperatorSessionEvent = {
  eventId: "native-local:session-started",
  kilnSessionId: "native-local",
  sequence: 1,
  timestamp: new Date().toISOString(),
  kind: "turn_started",
  source: {
    actor: "runtime",
    surface: "native",
    component: "native-foundation",
  },
  payload: {
    instanceId: "native-local",
    sessionId: "native-local",
  },
};

export function NativeSurfaceApp(): ReactElement {
  const startedAt = performance.timeOrigin;
  const browserRegionRef = useRef<HTMLDivElement | null>(null);
  const cockpitGatewaySocketRef = useRef<WebSocket | null>(null);
  const [browserSnapshot, setBrowserSnapshot] = useState<EmbeddedBrowserOperatorSurfaceSnapshot | null>(null);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [browserBusy, setBrowserBusy] = useState(false);
  const [cockpitFrameState, setCockpitFrameState] = useState(createNativeGatewayCockpitFrameState);
  const cockpitGatewayWsUrl = useMemo(() => resolveNativeGatewayCockpitWebSocketUrl(gatewayUrl), []);
  const projection = useMemo(() => {
    return createNativeSurfaceProjection({
      connected: true,
      gatewayUrl,
      sessionId: "native-local",
      authority: "read_only",
      providerRoute: "unrouted",
      latestEvent,
    });
  }, []);
  const capabilities = useMemo(() => {
    return createNativeSurfaceCapabilitySnapshot({
      surfaceId: "native:local",
      generatedAt: new Date().toISOString(),
    });
  }, []);
  const telemetry = useMemo(() => {
    const now = performance.now() + performance.timeOrigin;
    return createNativeSurfaceTelemetry({
      startedAtMs: startedAt,
      firstPaintAtMs: now,
      frameHandledAtMs: now,
      projectedAtMs: now,
      droppedFrames: 0,
    });
  }, [startedAt]);
  const cockpit = useMemo(() => {
    const managedAgentDrilldownTarget = selectNativeManagedAgentDrilldownTarget(cockpitFrameState.events);
    const cockpitProjection = createNativeCockpitReadOnlyProjection({
      surfaceId: "native:local",
      projectedAt: new Date().toISOString(),
      attachTargets: [
        {
          instanceId: "native-local",
          label: "Local native",
          kind: "local",
          gatewayUrl,
        },
      ],
      events: cockpitFrameState.events,
    });
    return createNativeCockpitReadOnlyViewState({
      surfaceId: "native:local",
      projection: cockpitProjection.view,
      viewState: {
        ...(managedAgentDrilldownTarget ? { managedAgentDrilldownTarget } : {}),
      },
    });
  }, [cockpitFrameState.events]);
  const workItems = useMemo(() => selectNativeWorkItems(cockpitFrameState.events), [cockpitFrameState.events]);
  const browserApi = window.kilnNativeBrowser;

  const readBrowserRegionBounds = useCallback(() => {
    const region = browserRegionRef.current;
    if (!region) {
      throw new Error("Embedded browser region is not mounted.");
    }
    const rect = region.getBoundingClientRect();
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.max(320, Math.round(rect.width)),
      height: Math.max(240, Math.round(rect.height)),
    };
  }, []);

  const runBrowserAction = useCallback(async (
    action: () => Promise<EmbeddedBrowserOperatorSurfaceSnapshot | null>,
  ) => {
    if (!browserApi) {
      setBrowserError("Native browser bridge unavailable.");
      return;
    }
    setBrowserBusy(true);
    setBrowserError(null);
    try {
      const nextSnapshot = await action();
      if (nextSnapshot) {
        setBrowserSnapshot(nextSnapshot);
      }
    } catch (error: unknown) {
      setBrowserError(error instanceof Error ? error.message : String(error));
    } finally {
      setBrowserBusy(false);
    }
  }, [browserApi]);

  const openBrowser = useCallback(() => {
    void runBrowserAction(() => browserApi?.open(readBrowserRegionBounds()) ?? Promise.resolve(null));
  }, [browserApi, readBrowserRegionBounds, runBrowserAction]);

  const takeoverBrowser = useCallback(() => {
    void runBrowserAction(() => browserApi?.takeover() ?? Promise.resolve(null));
  }, [browserApi, runBrowserAction]);

  const typeInBrowser = useCallback(() => {
    void runBrowserAction(() => browserApi?.sendInput({
      kind: "text",
      text: "kiln",
    }) ?? Promise.resolve(null));
  }, [browserApi, runBrowserAction]);

  const scrollBrowser = useCallback(() => {
    void runBrowserAction(() => browserApi?.sendInput({
      kind: "wheel",
      x: 500,
      y: 500,
      deltaX: 0,
      deltaY: 480,
    }) ?? Promise.resolve(null));
  }, [browserApi, runBrowserAction]);

  const releaseBrowser = useCallback(() => {
    void runBrowserAction(() => browserApi?.release() ?? Promise.resolve(null));
  }, [browserApi, runBrowserAction]);

  const resumeRuntime = useCallback(() => {
    void runBrowserAction(() => browserApi?.resumeRuntime() ?? Promise.resolve(null));
  }, [browserApi, runBrowserAction]);

  const cancelManagedAgent = useCallback((input: { readonly sessionId: string; readonly invocationId: string }) => {
    const ws = cockpitGatewaySocketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setCockpitFrameState((current) => ({
        ...current,
        connectionState: "error",
        error: "Native managed-agent cancellation requires an open gateway control channel.",
      }));
      return;
    }
    try {
      ws.send(JSON.stringify(createNativeManagedAgentCancelControlFrame({
        ...input,
        requestId: `native-managed-agent-cancel-${Date.now()}`,
        reason: "Operator cancelled the managed child from the native cockpit.",
      })));
    } catch (error: unknown) {
      setCockpitFrameState((current) => ({
        ...current,
        connectionState: "error",
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, []);

  useEffect(() => {
    let closed = false;
    const ws = new WebSocket(cockpitGatewayWsUrl);
    cockpitGatewaySocketRef.current = ws;
    ws.onmessage = (event) => {
      try {
        const frame = readNativeGatewayCockpitFrame(JSON.parse(String(event.data)));
        if (frame) {
          setCockpitFrameState((current) => reduceNativeGatewayCockpitFrame(current, frame));
        }
      } catch (error: unknown) {
        if (!closed) {
          setCockpitFrameState((current) => ({
            ...current,
            connectionState: "error",
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }
    };
    ws.onerror = () => {
      if (!closed) {
        setCockpitFrameState((current) => ({
          ...current,
          connectionState: "error",
          error: "Native cockpit gateway attach failed.",
        }));
      }
    };
    ws.onclose = () => {
      if (cockpitGatewaySocketRef.current === ws) {
        cockpitGatewaySocketRef.current = null;
      }
      if (!closed) {
        setCockpitFrameState((current) => reduceNativeGatewayCockpitFrame(current, {
          type: "native_gateway_closed",
          reason: "Native cockpit gateway attach closed.",
        }));
      }
    };
    return () => {
      closed = true;
      if (cockpitGatewaySocketRef.current === ws) {
        cockpitGatewaySocketRef.current = null;
      }
      ws.close();
    };
  }, [cockpitGatewayWsUrl]);

  useEffect(() => {
    if (!browserApi || !browserSnapshot || !browserRegionRef.current) return;
    const observer = new ResizeObserver(() => {
      void browserApi.resize(readBrowserRegionBounds())
        .then((nextSnapshot) => {
          if (nextSnapshot) setBrowserSnapshot(nextSnapshot);
        })
        .catch((error: unknown) => {
          setBrowserError(error instanceof Error ? error.message : String(error));
        });
    });
    observer.observe(browserRegionRef.current);
    return () => {
      observer.disconnect();
    };
  }, [browserApi, browserSnapshot, readBrowserRegionBounds]);

  const ownership = browserSnapshot?.projection.ownership ?? "released";
  const operatorCanInput = browserSnapshot?.projection.operatorCanInput ?? false;
  const runtimeCanDispatch = browserSnapshot?.projection.runtimeCanDispatch ?? false;

  return (
    <main className="native-shell">
      <section className="native-panel native-browser-panel" aria-label="Embedded browser operator surface">
        <p className="eyebrow">Kiln Native</p>
        <h1>Embedded Browser</h1>
        <dl className="native-grid">
          <div>
            <dt>Gateway</dt>
            <dd>{projection.gatewayUrl}</dd>
          </div>
          <div>
            <dt>Cockpit attach</dt>
            <dd>{cockpitFrameState.connectionState}</dd>
          </div>
          <div>
            <dt>Session</dt>
            <dd>{projection.sessionId}</dd>
          </div>
          <div>
            <dt>Authority</dt>
            <dd>{projection.authority}</dd>
          </div>
          <div>
            <dt>Provider route</dt>
            <dd>{projection.providerRoute}</dd>
          </div>
        </dl>
        {cockpitFrameState.error ? <p className="browser-error">{cockpitFrameState.error}</p> : null}
        <div className="browser-surface-toolbar" aria-label="Browser controls">
          <button type="button" onClick={openBrowser} disabled={browserBusy || !browserApi}>
            Open
          </button>
          <button type="button" onClick={takeoverBrowser} disabled={browserBusy || ownership !== "agent"}>
            Take over
          </button>
          <button type="button" onClick={typeInBrowser} disabled={browserBusy || !operatorCanInput}>
            Type
          </button>
          <button type="button" onClick={scrollBrowser} disabled={browserBusy || !operatorCanInput}>
            Scroll
          </button>
          <button type="button" onClick={releaseBrowser} disabled={browserBusy || ownership !== "operator"}>
            Release
          </button>
          <button type="button" onClick={resumeRuntime} disabled={browserBusy || !runtimeCanDispatch}>
            Resume
          </button>
        </div>
        <div ref={browserRegionRef} className="embedded-browser-region" aria-label="Embedded browser region">
          <span>{browserSnapshot ? "Embedded browser active" : "Open a browser task"}</span>
        </div>
        {browserError ? <p className="browser-error">{browserError}</p> : null}
      </section>
      <section className="native-panel" aria-label="Browser state">
        <h2>Browser State</h2>
        <dl className="native-grid">
          <div>
            <dt>Mode</dt>
            <dd>{browserSnapshot?.projection.surfaceMode ?? "idle"}</dd>
          </div>
          <div>
            <dt>Transport</dt>
            <dd>{browserSnapshot?.projection.transport ?? "none"}</dd>
          </div>
          <div>
            <dt>Ownership</dt>
            <dd>{ownership}</dd>
          </div>
          <div>
            <dt>Evidence</dt>
            <dd>{browserSnapshot?.projection.evidenceCount ?? 0}</dd>
          </div>
          <div>
            <dt>Title</dt>
            <dd>{browserSnapshot?.projection.title ?? "No browser session"}</dd>
          </div>
          <div>
            <dt>Input</dt>
            <dd>{browserSnapshot?.observation.proofInputValue ?? ""}</dd>
          </div>
        </dl>
      </section>
      <ManagedAgentCockpitPanel
        cockpit={cockpit}
        onCancel={cockpitFrameState.connectionState === "open" ? cancelManagedAgent : undefined}
        selectedManagedInvocationId={
          cockpit.view.managedAgents.drilldown?.resolved
            ? cockpit.view.managedAgents.drilldown.item.managedInvocationId
            : undefined
        }
      />
      <NativeWorkItemsPanel items={workItems} />
      <section className="native-panel" aria-label="Surface capabilities">
        <h2>Capabilities</h2>
        <ul className="capability-list">
          {capabilities.capabilities.map((entry) => (
            <li key={entry.capability}>
              <span>{entry.capability}</span>
              <strong>{entry.status}</strong>
            </li>
          ))}
        </ul>
      </section>
      <section className="native-panel" aria-label="Projection telemetry">
        <h2>Projection</h2>
        <p>{projection.latestEvent?.title ?? "No event"}</p>
        <p>{projection.latestEvent?.summary ?? ""}</p>
        <dl className="native-grid">
          <div>
            <dt>First paint</dt>
            <dd>{Math.round(telemetry.firstPaintMs)}ms</dd>
          </div>
          <div>
            <dt>Projection</dt>
            <dd>{Math.round(telemetry.projectionUpdateMs)}ms</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
