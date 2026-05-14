import type {
  GuiBrowserOperatorInput,
  GuiBrowserOperatorInputAckStatus,
  GuiBrowserSessionOwnership,
  GuiBrowserSessionState,
  OperatorSessionEvent,
} from "@kilnai/gateway-contracts";

export const NATIVE_BROWSER_HOST_TRANSPORT = "electron-webcontents" as const;

export interface NativeEmbeddedBrowserHostOptionsInput {
  readonly sessionId: string;
}

export interface NativeEmbeddedBrowserHostOptions {
  readonly transport: typeof NATIVE_BROWSER_HOST_TRANSPORT;
  readonly webPreferences: {
    readonly nodeIntegration: false;
    readonly contextIsolation: true;
    readonly sandbox: true;
    readonly webSecurity: true;
    readonly allowRunningInsecureContent: false;
    readonly partition: string;
    readonly preload?: string;
  };
}

export function createNativeEmbeddedBrowserHostOptions(
  input: NativeEmbeddedBrowserHostOptionsInput,
): NativeEmbeddedBrowserHostOptions {
  return {
    transport: NATIVE_BROWSER_HOST_TRANSPORT,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      partition: `kiln-embedded-browser-host:${input.sessionId}`,
    },
  };
}

export interface NativeBrowserHostPolicyInput {
  readonly allowedUrls: readonly string[];
}

export interface NativeBrowserHostPolicy {
  readonly allowedUrls: readonly string[];
}

export function createNativeBrowserHostPolicy(
  input: NativeBrowserHostPolicyInput,
): NativeBrowserHostPolicy {
  return {
    allowedUrls: [...new Set(input.allowedUrls)],
  };
}

export function isNativeBrowserHostNavigationAllowed(
  candidateUrl: string,
  policy: NativeBrowserHostPolicy,
): boolean {
  try {
    const parsed = new URL(candidateUrl);
    if (parsed.protocol !== "file:" && parsed.protocol !== "https:") {
      return false;
    }
    return policy.allowedUrls.includes(parsed.href);
  } catch {
    return false;
  }
}

export interface NativeBrowserHostViewport {
  readonly width: number;
  readonly height: number;
}

export interface NativeBrowserHostSessionStateInput {
  readonly sessionId: string;
  readonly kilnSessionId: string;
  readonly url: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly viewport: NativeBrowserHostViewport;
  readonly ownership: GuiBrowserSessionOwnership;
}

export function createNativeBrowserHostSessionState(
  input: NativeBrowserHostSessionStateInput,
): GuiBrowserSessionState {
  return {
    target: "browser",
    status: input.ownership === "released" ? "succeeded" : "running",
    updatedAt: input.updatedAt,
    kilnSessionId: input.kilnSessionId,
    provider: "native-electron",
    sessionId: input.sessionId,
    operation: "embedded_browser_host",
    url: input.url,
    title: input.title,
    ownership: input.ownership,
    viewMode: "live",
    stream: {
      status: input.ownership === "released" ? "ended" : "live",
    },
    latestCapture: {
      uri: `kiln://browser-host/${input.sessionId}/current`,
      relation: "embedded-browser-host",
      mimeType: "text/html",
      width: input.viewport.width,
      height: input.viewport.height,
      transport: NATIVE_BROWSER_HOST_TRANSPORT,
    },
  };
}

export interface NativeBrowserHostEvidenceEventInput {
  readonly eventId: string;
  readonly kilnSessionId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly sessionId: string;
  readonly action: "host_observed" | "operator_input" | "runtime_dispatch" | "takeover" | "release";
  readonly url?: string;
  readonly title?: string;
  readonly input?: SanitizedNativeBrowserHostInputSummary;
  readonly acknowledgement?: {
    readonly status: GuiBrowserOperatorInputAckStatus;
    readonly reason?: string;
  };
}

export type SanitizedNativeBrowserHostInputSummary =
  | {
      readonly kind: "pointer";
      readonly phase: Extract<GuiBrowserOperatorInput, { readonly kind: "pointer" }>["phase"];
      readonly x: number;
      readonly y: number;
      readonly button?: string;
    }
  | {
      readonly kind: "wheel";
      readonly x: number;
      readonly y: number;
      readonly deltaX: number;
      readonly deltaY: number;
    }
  | {
      readonly kind: "key";
      readonly phase: Extract<GuiBrowserOperatorInput, { readonly kind: "key" }>["phase"];
      readonly key: string;
      readonly code?: string;
    }
  | {
      readonly kind: "text";
      readonly textLength: number;
    };

export function createNativeBrowserHostEvidenceEvent(
  input: NativeBrowserHostEvidenceEventInput,
): OperatorSessionEvent {
  return {
    eventId: input.eventId,
    kilnSessionId: input.kilnSessionId,
    sequence: input.sequence,
    timestamp: input.timestamp,
    kind: "browser_operator_evidence",
    source: {
      actor: "runtime",
      surface: "native",
      component: "embedded-browser-host",
    },
    payload: {
      action: input.action,
      hostTransport: NATIVE_BROWSER_HOST_TRANSPORT,
      browserSessionId: input.sessionId,
      ...(input.url ? { url: input.url } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.input ? { input: input.input } : {}),
      ...(input.acknowledgement ? { acknowledgement: input.acknowledgement } : {}),
    },
  };
}

export interface NativeBrowserHostOwnershipInput {
  readonly ownership: GuiBrowserSessionOwnership;
}

export function nativeBrowserHostRuntimeActionAllowed(
  input: NativeBrowserHostOwnershipInput,
): boolean {
  return input.ownership === "agent";
}

export function nativeBrowserHostOperatorInputAllowed(
  input: NativeBrowserHostOwnershipInput,
): boolean {
  return input.ownership === "operator";
}

export function summarizeNativeBrowserHostInput(
  input: GuiBrowserOperatorInput,
): SanitizedNativeBrowserHostInputSummary {
  if (input.kind === "text") {
    return {
      kind: "text",
      textLength: input.text.length,
    };
  }
  if (input.kind === "key") {
    return {
      kind: "key",
      phase: input.phase,
      key: input.key,
      ...(input.code ? { code: input.code } : {}),
    };
  }
  if (input.kind === "wheel") {
    return {
      kind: "wheel",
      x: input.x,
      y: input.y,
      deltaX: input.deltaX,
      deltaY: input.deltaY,
    };
  }
  return {
    kind: "pointer",
    phase: input.phase,
    x: input.x,
    y: input.y,
    ...(input.button ? { button: input.button } : {}),
  };
}
