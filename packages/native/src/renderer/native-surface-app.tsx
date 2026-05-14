import { useMemo } from "react";
import type { ReactElement } from "react";
import type { OperatorSessionEvent } from "@kilnai/gateway-contracts";
import {
  createNativeSurfaceCapabilitySnapshot,
  createNativeSurfaceProjection,
  createNativeSurfaceTelemetry,
} from "../shared/native-surface";
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
  payload: {},
};

export function NativeSurfaceApp(): ReactElement {
  const startedAt = performance.timeOrigin;
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

  return (
    <main className="native-shell">
      <section className="native-panel" aria-label="Native operator surface">
        <p className="eyebrow">Kiln Native</p>
        <h1>Operator Surface Foundation</h1>
        <dl className="native-grid">
          <div>
            <dt>Gateway</dt>
            <dd>{projection.gatewayUrl}</dd>
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
      </section>
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
