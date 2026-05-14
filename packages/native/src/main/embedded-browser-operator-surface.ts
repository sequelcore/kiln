import type {
  BrowserWindow,
  Rectangle,
} from "electron";
import { pathToFileURL } from "node:url";
import type {
  GuiBrowserOperatorInput,
  GuiBrowserSessionState,
  OperatorSessionEvent,
} from "@kilnai/gateway-contracts";
import {
  createNativeBrowserHostEvidenceEvent,
  createNativeBrowserHostPolicy,
  summarizeNativeBrowserHostInput,
} from "../shared/native-browser-host.js";
import type {
  NativeBrowserHostEvidenceEventInput,
} from "../shared/native-browser-host.js";
import {
  createNativeBrowserOperatorSurfaceProjection,
  nativeBrowserOperatorActionAllowed,
} from "../shared/native-browser-operator-surface.js";
import type {
  NativeBrowserOperatorSurfaceProjection,
} from "../shared/native-browser-operator-surface.js";
import {
  createNativeEmbeddedBrowserHost,
} from "./embedded-browser-host.js";
import type {
  NativeEmbeddedBrowserHost,
  NativeEmbeddedBrowserHostObservation,
} from "./embedded-browser-host.js";

export interface EmbeddedBrowserOperatorSurfaceInput {
  readonly parentWindow: BrowserWindow;
  readonly proofFilePath: string;
  readonly sessionId: string;
  readonly kilnSessionId: string;
}

export interface EmbeddedBrowserOperatorSurfaceSnapshot {
  readonly state: GuiBrowserSessionState;
  readonly projection: NativeBrowserOperatorSurfaceProjection;
  readonly observation: NativeEmbeddedBrowserHostObservation;
  readonly evidence: readonly Pick<OperatorSessionEvent, "kind" | "payload" | "timestamp">[];
}

export interface EmbeddedBrowserOperatorSurface {
  open(bounds: Rectangle): Promise<EmbeddedBrowserOperatorSurfaceSnapshot>;
  resize(bounds: Rectangle): Promise<EmbeddedBrowserOperatorSurfaceSnapshot | null>;
  takeover(): Promise<EmbeddedBrowserOperatorSurfaceSnapshot>;
  dispatchOperatorInput(input: GuiBrowserOperatorInput): Promise<EmbeddedBrowserOperatorSurfaceSnapshot>;
  release(): Promise<EmbeddedBrowserOperatorSurfaceSnapshot>;
  dispatchRuntimeResume(): Promise<EmbeddedBrowserOperatorSurfaceSnapshot>;
  close(): void;
}

export function createEmbeddedBrowserOperatorSurface(
  input: EmbeddedBrowserOperatorSurfaceInput,
): EmbeddedBrowserOperatorSurface {
  const proofUrl = pathToFileURL(input.proofFilePath).toString();
  let host: NativeEmbeddedBrowserHost | null = null;
  const evidence: OperatorSessionEvent[] = [];

  async function snapshot(lastObservation?: NativeEmbeddedBrowserHostObservation): Promise<EmbeddedBrowserOperatorSurfaceSnapshot> {
    const activeHost = requireHost(host);
    const observation = lastObservation ?? await activeHost.observe();
    const state = await activeHost.projectState(new Date().toISOString());
    const lastEvent = evidence[evidence.length - 1];

    return {
      state,
      projection: createNativeBrowserOperatorSurfaceProjection({
        state,
        evidenceCount: evidence.length,
        lastEvidenceAction: readEvidenceAction(lastEvent),
        lastObservation: {
          url: observation.url,
          title: observation.title,
          proofInputValue: observation.proofInputValue,
          scrollY: observation.scrollY,
        },
      }),
      observation,
      evidence: evidence.map((event) => ({
        kind: event.kind,
        payload: event.payload,
        timestamp: event.timestamp,
      })),
    };
  }

  function recordEvidence(
    inputEvent: Omit<NativeBrowserHostEvidenceEventInput, "eventId" | "kilnSessionId" | "sequence" | "timestamp" | "sessionId">,
  ): void {
    const event = createNativeBrowserHostEvidenceEvent({
      eventId: `${input.kilnSessionId}:embedded-browser:${evidence.length + 1}`,
      kilnSessionId: input.kilnSessionId,
      sequence: evidence.length + 1,
      timestamp: new Date().toISOString(),
      sessionId: input.sessionId,
      ...inputEvent,
    });
    evidence.push(event);
  }

  return {
    async open(bounds: Rectangle): Promise<EmbeddedBrowserOperatorSurfaceSnapshot> {
      if (!host) {
        host = createNativeEmbeddedBrowserHost({
          parentWindow: input.parentWindow,
          sessionId: input.sessionId,
          kilnSessionId: input.kilnSessionId,
          bounds,
          policy: createNativeBrowserHostPolicy({
            allowedUrls: [proofUrl],
          }),
        });
        await host.navigate(proofUrl);
      } else {
        host.setBounds(bounds);
      }
      const observation = await host.observe();
      recordEvidence({
        action: "host_observed",
        url: observation.url,
        title: observation.title,
      });
      return snapshot(observation);
    },
    async resize(bounds: Rectangle): Promise<EmbeddedBrowserOperatorSurfaceSnapshot | null> {
      if (!host) return null;
      host.setBounds(bounds);
      return snapshot();
    },
    async takeover(): Promise<EmbeddedBrowserOperatorSurfaceSnapshot> {
      const activeHost = requireHost(host);
      const state = await activeHost.projectState(new Date().toISOString());
      if (!nativeBrowserOperatorActionAllowed({ action: "takeover", ownership: state.ownership })) {
        throw new Error("Embedded browser takeover requires agent ownership.");
      }
      activeHost.setOwnership("operator");
      const observation = await activeHost.observe();
      recordEvidence({
        action: "takeover",
        url: observation.url,
        title: observation.title,
      });
      return snapshot(observation);
    },
    async dispatchOperatorInput(inputEvent: GuiBrowserOperatorInput): Promise<EmbeddedBrowserOperatorSurfaceSnapshot> {
      const activeHost = requireHost(host);
      await activeHost.dispatchOperatorInput(inputEvent);
      await waitForSurfaceSettle();
      const observation = await activeHost.observe();
      recordEvidence({
        action: "operator_input",
        url: observation.url,
        title: observation.title,
        input: summarizeNativeBrowserHostInput(inputEvent),
        acknowledgement: {
          status: "accepted",
        },
      });
      return snapshot(observation);
    },
    async release(): Promise<EmbeddedBrowserOperatorSurfaceSnapshot> {
      const activeHost = requireHost(host);
      const state = await activeHost.projectState(new Date().toISOString());
      if (!nativeBrowserOperatorActionAllowed({ action: "release", ownership: state.ownership })) {
        throw new Error("Embedded browser release requires operator ownership.");
      }
      activeHost.setOwnership("agent");
      const observation = await activeHost.observe();
      recordEvidence({
        action: "release",
        url: observation.url,
        title: observation.title,
      });
      return snapshot(observation);
    },
    async dispatchRuntimeResume(): Promise<EmbeddedBrowserOperatorSurfaceSnapshot> {
      const activeHost = requireHost(host);
      await activeHost.dispatchRuntimeInput({
        kind: "text",
        text: "!",
      });
      await waitForSurfaceSettle();
      const observation = await activeHost.observe();
      recordEvidence({
        action: "runtime_dispatch",
        url: observation.url,
        title: observation.title,
        input: {
          kind: "text",
          textLength: 1,
        },
        acknowledgement: {
          status: "accepted",
        },
      });
      return snapshot(observation);
    },
    close(): void {
      host?.close();
      host = null;
    },
  };
}

function requireHost(
  host: NativeEmbeddedBrowserHost | null,
): NativeEmbeddedBrowserHost {
  if (!host) {
    throw new Error("Embedded browser operator surface has not opened a host.");
  }
  return host;
}

function readEvidenceAction(
  event: OperatorSessionEvent | undefined,
): string | undefined {
  const payload = event?.payload;
  if (typeof payload === "object" && payload !== null && "action" in payload) {
    const action = (payload as { readonly action?: unknown }).action;
    return typeof action === "string" ? action : undefined;
  }
  return undefined;
}

function waitForSurfaceSettle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 50);
  });
}
