import type {
  OperatorSessionEvent,
  OperatorSurfaceCapabilitySnapshot,
} from "@kilnai/gateway-contracts";
import {
  presentOperatorSessionEvent,
} from "@kilnai/gateway-contracts";

export interface NativeBrowserWindowOptions {
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
  readonly title: string;
  readonly backgroundColor: string;
  readonly show: boolean;
  readonly webPreferences: {
    readonly nodeIntegration: false;
    readonly contextIsolation: true;
    readonly sandbox: true;
    readonly webSecurity: true;
    readonly preload?: string;
  };
}

export interface NativeSurfaceCapabilityInput {
  readonly surfaceId: string;
  readonly generatedAt?: string;
}

export function createNativeSurfaceCapabilitySnapshot(
  input: NativeSurfaceCapabilityInput,
): OperatorSurfaceCapabilitySnapshot {
  return {
    surface: "native",
    surfaceId: input.surfaceId,
    ...(input.generatedAt ? { generatedAt: input.generatedAt } : {}),
    capabilities: [
      {
        capability: "gateway-attach",
        status: "available",
      },
      {
        capability: "session-projection",
        status: "available",
      },
      {
        capability: "theme-projection",
        status: "available",
      },
      {
        capability: "native-window-lifecycle",
        status: "available",
      },
      {
        capability: "surface-performance-telemetry",
        status: "available",
      },
      {
        capability: "native-cockpit-contract",
        status: "available",
        reason: "Contract-only target, precondition, and benchmark fixture definitions are available for roadmap 05.",
      },
      {
        capability: "embedded-browser-host",
        status: "available",
        reason: "Electron WebContentsView host proof is available behind the native host adapter.",
      },
    ],
  };
}

export interface NativeBrowserWindowOptionsInput {
  readonly preload?: string;
}

export function createNativeBrowserWindowOptions(
  input: NativeBrowserWindowOptionsInput = {},
): NativeBrowserWindowOptions {
  return {
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "Kiln Native",
    backgroundColor: "#08090b",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      ...(input.preload ? { preload: input.preload } : {}),
    },
  };
}

export interface NativeSurfaceProjectionInput {
  readonly connected: boolean;
  readonly gatewayUrl: string;
  readonly sessionId?: string;
  readonly authority?: string;
  readonly providerRoute?: string;
  readonly theme?: string;
  readonly latestEvent?: OperatorSessionEvent;
}

export interface NativeSurfaceEventProjection {
  readonly eventId: string;
  readonly title: string;
  readonly summary: string;
  readonly compactText: string;
  readonly tone: string;
}

export interface NativeSurfaceProjection {
  readonly connected: boolean;
  readonly gatewayUrl: string;
  readonly sessionId: string | null;
  readonly authority: string;
  readonly providerRoute: string;
  readonly theme: string;
  readonly latestEvent?: NativeSurfaceEventProjection;
}

export function createNativeSurfaceProjection(
  input: NativeSurfaceProjectionInput,
): NativeSurfaceProjection {
  const latestEvent = input.latestEvent
    ? presentOperatorSessionEvent(input.latestEvent)
    : undefined;

  return {
    connected: input.connected,
    gatewayUrl: input.gatewayUrl,
    sessionId: input.sessionId ?? null,
    authority: input.authority ?? "unknown",
    providerRoute: input.providerRoute ?? "unrouted",
    theme: input.theme ?? "kiln-dark",
    ...(latestEvent && input.latestEvent
      ? {
          latestEvent: {
            eventId: input.latestEvent.eventId,
            title: latestEvent.title,
            summary: latestEvent.summary ?? "",
            compactText: latestEvent.compactText ?? latestEvent.title,
            tone: latestEvent.tone,
          },
        }
      : {}),
  };
}

export interface NativeSurfaceTelemetryInput {
  readonly startedAtMs: number;
  readonly firstPaintAtMs: number;
  readonly frameHandledAtMs: number;
  readonly projectedAtMs: number;
  readonly memoryUsageBytes?: number;
  readonly droppedFrames: number;
}

export interface NativeSurfaceTelemetry {
  readonly firstPaintMs: number;
  readonly frameHandlingMs: number;
  readonly projectionUpdateMs: number;
  readonly memoryUsageBytes?: number;
  readonly droppedFrames: number;
}

export function createNativeSurfaceTelemetry(
  input: NativeSurfaceTelemetryInput,
): NativeSurfaceTelemetry {
  return {
    firstPaintMs: Math.max(0, input.firstPaintAtMs - input.startedAtMs),
    frameHandlingMs: Math.max(0, input.frameHandledAtMs - input.startedAtMs),
    projectionUpdateMs: Math.max(0, input.projectedAtMs - input.startedAtMs),
    ...(input.memoryUsageBytes !== undefined ? { memoryUsageBytes: input.memoryUsageBytes } : {}),
    droppedFrames: input.droppedFrames,
  };
}
