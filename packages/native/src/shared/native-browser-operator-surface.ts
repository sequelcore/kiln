import type {
  GuiBrowserSessionOwnership,
  GuiBrowserSessionState,
} from "@kilnai/gateway-contracts";
import {
  NATIVE_BROWSER_HOST_TRANSPORT,
} from "./native-browser-host.js";

export type NativeBrowserOperatorAction =
  | "open"
  | "takeover"
  | "operator_input"
  | "release"
  | "runtime_dispatch";

export interface NativeBrowserRegionBoundsInput {
  readonly windowWidth: number;
  readonly windowHeight: number;
}

export interface NativeBrowserRegionBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function createNativeBrowserRegionBounds(
  input: NativeBrowserRegionBoundsInput,
): NativeBrowserRegionBounds {
  const sideRailWidth = 388;
  const gap = 16;
  const margin = 24;
  const headerHeight = 208;
  const width = Math.max(320, input.windowWidth - sideRailWidth - gap - (margin * 2));
  const height = Math.max(240, input.windowHeight - headerHeight - 40);

  return {
    x: margin,
    y: headerHeight + margin,
    width,
    height,
  };
}

export interface NativeBrowserOperatorSurfaceProjectionInput {
  readonly state: GuiBrowserSessionState;
  readonly evidenceCount: number;
  readonly lastEvidenceAction?: string;
  readonly lastObservation?: {
    readonly url?: string;
    readonly title?: string;
    readonly proofInputValue?: string;
    readonly scrollY?: number;
  };
}

export interface NativeBrowserOperatorSurfaceProjection {
  readonly surfaceMode: "embedded-browser";
  readonly transport: typeof NATIVE_BROWSER_HOST_TRANSPORT;
  readonly sessionId: string;
  readonly kilnSessionId: string | null;
  readonly title: string;
  readonly url: string;
  readonly ownership: GuiBrowserSessionOwnership;
  readonly operatorCanInput: boolean;
  readonly runtimeCanDispatch: boolean;
  readonly evidenceCount: number;
  readonly lastEvidenceAction: string | null;
  readonly lastObservation?: NativeBrowserOperatorSurfaceProjectionInput["lastObservation"];
}

export function createNativeBrowserOperatorSurfaceProjection(
  input: NativeBrowserOperatorSurfaceProjectionInput,
): NativeBrowserOperatorSurfaceProjection {
  return {
    surfaceMode: "embedded-browser",
    transport: NATIVE_BROWSER_HOST_TRANSPORT,
    sessionId: input.state.sessionId ?? "unknown-browser-session",
    kilnSessionId: input.state.kilnSessionId ?? null,
    title: input.state.title ?? "Untitled browser",
    url: input.state.url ?? "",
    ownership: input.state.ownership,
    operatorCanInput: nativeBrowserOperatorActionAllowed({
      action: "operator_input",
      ownership: input.state.ownership,
    }),
    runtimeCanDispatch: nativeBrowserOperatorActionAllowed({
      action: "runtime_dispatch",
      ownership: input.state.ownership,
    }),
    evidenceCount: input.evidenceCount,
    lastEvidenceAction: input.lastEvidenceAction ?? null,
    ...(input.lastObservation ? { lastObservation: input.lastObservation } : {}),
  };
}

export interface NativeBrowserOperatorActionInput {
  readonly action: NativeBrowserOperatorAction;
  readonly ownership?: GuiBrowserSessionOwnership;
}

export function nativeBrowserOperatorActionAllowed(
  input: NativeBrowserOperatorActionInput,
): boolean {
  if (input.action === "open") return true;
  if (input.action === "takeover") return input.ownership === "agent";
  if (input.action === "operator_input") return input.ownership === "operator";
  if (input.action === "release") return input.ownership === "operator";
  if (input.action === "runtime_dispatch") return input.ownership === "agent";
  return false;
}
