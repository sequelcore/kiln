import type {
  BrowserWindow,
  Rectangle,
  WebContents,
} from "electron";
import {
  WebContentsView,
} from "electron";
import type {
  GuiBrowserOperatorInput,
  GuiBrowserSessionState,
} from "@kilnai/gateway-contracts";
import {
  createNativeBrowserHostEvidenceEvent,
  createNativeBrowserHostSessionState,
  createNativeEmbeddedBrowserHostOptions,
  isNativeBrowserHostNavigationAllowed,
  nativeBrowserHostOperatorInputAllowed,
  NATIVE_BROWSER_HOST_TRANSPORT,
  summarizeNativeBrowserHostInput,
} from "../shared/native-browser-host.js";
import type {
  NativeBrowserHostPolicy,
} from "../shared/native-browser-host.js";

export interface NativeEmbeddedBrowserHostInput {
  readonly parentWindow: BrowserWindow;
  readonly sessionId: string;
  readonly kilnSessionId: string;
  readonly bounds: Rectangle;
  readonly policy: NativeBrowserHostPolicy;
}

export interface NativeEmbeddedBrowserHostObservation {
  readonly url: string;
  readonly title: string;
  readonly viewport: {
    readonly width: number;
    readonly height: number;
  };
  readonly scrollY: number;
  readonly proofInputValue?: string;
}

export interface NativeEmbeddedBrowserHost {
  readonly transport: typeof NATIVE_BROWSER_HOST_TRANSPORT;
  readonly sessionId: string;
  readonly kilnSessionId: string;
  readonly view: WebContentsView;
  navigate(url: string): Promise<void>;
  observe(): Promise<NativeEmbeddedBrowserHostObservation>;
  dispatchOperatorInput(input: GuiBrowserOperatorInput): Promise<void>;
  projectState(updatedAt: string): Promise<GuiBrowserSessionState>;
  close(): void;
}

export function createNativeEmbeddedBrowserHost(
  input: NativeEmbeddedBrowserHostInput,
): NativeEmbeddedBrowserHost {
  const options = createNativeEmbeddedBrowserHostOptions({
    sessionId: input.sessionId,
  });
  const view = new WebContentsView({
    webPreferences: options.webPreferences,
  });

  input.parentWindow.contentView.addChildView(view);
  view.setBounds(input.bounds);
  configureHostWebContents(view.webContents, input.policy);

  return {
    transport: NATIVE_BROWSER_HOST_TRANSPORT,
    sessionId: input.sessionId,
    kilnSessionId: input.kilnSessionId,
    view,
    async navigate(url: string): Promise<void> {
      if (!isNativeBrowserHostNavigationAllowed(url, input.policy)) {
        throw new Error(`Blocked embedded browser navigation: ${url}`);
      }
      await view.webContents.loadURL(url);
    },
    async observe(): Promise<NativeEmbeddedBrowserHostObservation> {
      return observeNativeEmbeddedBrowserHost(view.webContents);
    },
    async dispatchOperatorInput(operatorInput: GuiBrowserOperatorInput): Promise<void> {
      if (!nativeBrowserHostOperatorInputAllowed({ ownership: "operator" })) {
        throw new Error("Embedded browser host input requires operator ownership.");
      }
      input.parentWindow.focus();
      view.webContents.focus();
      await dispatchNativeBrowserHostInput(view.webContents, operatorInput);
    },
    async projectState(updatedAt: string): Promise<GuiBrowserSessionState> {
      const observation = await observeNativeEmbeddedBrowserHost(view.webContents);
      return createNativeBrowserHostSessionState({
        sessionId: input.sessionId,
        kilnSessionId: input.kilnSessionId,
        url: observation.url,
        title: observation.title,
        updatedAt,
        viewport: observation.viewport,
        ownership: "operator",
      });
    },
    close(): void {
      if (!view.webContents.isDestroyed() && view.webContents.debugger.isAttached()) {
        view.webContents.debugger.detach();
      }
      input.parentWindow.contentView.removeChildView(view);
      if (!view.webContents.isDestroyed()) {
        view.webContents.close();
      }
    },
  };
}

function configureHostWebContents(
  contents: WebContents,
  policy: NativeBrowserHostPolicy,
): void {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  contents.session.on("will-download", (event) => {
    event.preventDefault();
  });
  contents.on("will-navigate", (event, url) => {
    if (!isNativeBrowserHostNavigationAllowed(url, policy)) {
      event.preventDefault();
    }
  });
}

async function observeNativeEmbeddedBrowserHost(
  contents: WebContents,
): Promise<NativeEmbeddedBrowserHostObservation> {
  await ensureDebuggerAttached(contents);
  const response = await contents.debugger.sendCommand("Runtime.evaluate", {
    expression: `({
      url: globalThis.location.href,
      title: globalThis.document.title,
      viewport: {
        width: globalThis.innerWidth,
        height: globalThis.innerHeight
      },
      scrollY: globalThis.scrollY,
      proofInputValue: globalThis.document.getElementById("proof-input")?.value
    })`,
    returnByValue: true,
  }) as {
    readonly result?: {
      readonly value?: unknown;
    };
  };

  return parseObservation(response.result?.value);
}

async function ensureDebuggerAttached(contents: WebContents): Promise<void> {
  if (!contents.debugger.isAttached()) {
    contents.debugger.attach("1.3");
    await contents.debugger.sendCommand("Page.enable");
    await contents.debugger.sendCommand("Runtime.enable");
  }
}

function parseObservation(value: unknown): NativeEmbeddedBrowserHostObservation {
  if (!isRecord(value)) {
    throw new Error("Embedded browser observation did not return an object.");
  }
  const viewport = value.viewport;
  if (!isRecord(viewport)) {
    throw new Error("Embedded browser observation did not include viewport data.");
  }
  const url = typeof value.url === "string" ? value.url : "";
  const title = typeof value.title === "string" ? value.title : "";
  const width = typeof viewport.width === "number" ? viewport.width : 0;
  const height = typeof viewport.height === "number" ? viewport.height : 0;
  const scrollY = typeof value.scrollY === "number" ? value.scrollY : 0;
  const proofInputValue = typeof value.proofInputValue === "string"
    ? value.proofInputValue
    : undefined;

  return {
    url,
    title,
    viewport: {
      width,
      height,
    },
    scrollY,
    ...(proofInputValue !== undefined ? { proofInputValue } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function dispatchNativeBrowserHostInput(
  contents: WebContents,
  input: GuiBrowserOperatorInput,
): Promise<void> {
  if (input.kind === "pointer") {
    if (input.phase === "move") {
      contents.sendInputEvent({
        type: "mouseMove",
        x: input.x,
        y: input.y,
        ...(electronMouseButton(input.button) ? { button: electronMouseButton(input.button) } : {}),
      });
      return;
    }
    if (input.phase === "down" || input.phase === "click") {
      contents.sendInputEvent({
        type: "mouseDown",
        x: input.x,
        y: input.y,
        button: electronMouseButton(input.button) ?? "left",
        clickCount: input.clickCount ?? 1,
      });
    }
    if (input.phase === "up" || input.phase === "click") {
      contents.sendInputEvent({
        type: "mouseUp",
        x: input.x,
        y: input.y,
        button: electronMouseButton(input.button) ?? "left",
        clickCount: input.clickCount ?? 1,
      });
    }
    return;
  }

  if (input.kind === "wheel") {
    await ensureDebuggerAttached(contents);
    await contents.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: input.x,
      y: input.y,
      deltaX: input.deltaX,
      deltaY: input.deltaY,
    });
    return;
  }

  if (input.kind === "key") {
    if (input.phase === "down" || input.phase === "press") {
      contents.sendInputEvent({
        type: "keyDown",
        keyCode: input.code ?? input.key,
      });
    }
    if (input.text && input.phase === "press") {
      contents.sendInputEvent({
        type: "char",
        keyCode: input.text,
      });
    }
    if (input.phase === "up" || input.phase === "press") {
      contents.sendInputEvent({
        type: "keyUp",
        keyCode: input.code ?? input.key,
      });
    }
    return;
  }

  for (const character of input.text) {
    contents.sendInputEvent({
      type: "char",
      keyCode: character,
    });
  }
}

function electronMouseButton(
  button: Extract<GuiBrowserOperatorInput, { readonly kind: "pointer" }>["button"],
): "left" | "middle" | "right" | undefined {
  if (button === "left" || button === "middle" || button === "right") {
    return button;
  }
  return undefined;
}

export interface NativeEmbeddedBrowserHostSmokeResult {
  readonly ok: true;
  readonly surface: "native";
  readonly hostTransport: typeof NATIVE_BROWSER_HOST_TRANSPORT;
  readonly sessionState: GuiBrowserSessionState;
  readonly observation: NativeEmbeddedBrowserHostObservation;
  readonly evidence: {
    readonly kind: string;
    readonly payload: unknown;
  };
}

export async function runNativeEmbeddedBrowserHostSmoke(
  host: NativeEmbeddedBrowserHost,
  proofUrl: string,
): Promise<NativeEmbeddedBrowserHostSmokeResult> {
  await host.navigate(proofUrl);
  await host.dispatchOperatorInput({
    kind: "pointer",
    phase: "click",
    x: 48,
    y: 48,
    button: "left",
  });
  await host.dispatchOperatorInput({
    kind: "text",
    text: "kiln",
  });
  await host.dispatchOperatorInput({
    kind: "wheel",
    x: 500,
    y: 500,
    deltaX: 0,
    deltaY: 480,
  });
  await waitForHostInputSettle();

  const observation = await host.observe();
  const sessionState = await host.projectState(new Date().toISOString());
  const evidenceEvent = createNativeBrowserHostEvidenceEvent({
    eventId: `${host.kilnSessionId}:browser-host:1`,
    kilnSessionId: host.kilnSessionId,
    sequence: 1,
    timestamp: new Date().toISOString(),
    sessionId: host.sessionId,
    action: "operator_input",
    url: observation.url,
    title: observation.title,
    input: summarizeNativeBrowserHostInput({
      kind: "text",
      text: observation.proofInputValue ?? "",
    }),
    acknowledgement: {
      status: observation.proofInputValue === "kiln" && observation.scrollY > 0 ? "accepted" : "failed",
      ...(observation.proofInputValue === "kiln" && observation.scrollY > 0
        ? {}
        : { reason: "Proof input or scroll did not reach the embedded browser page." }),
    },
  });

  if (observation.proofInputValue !== "kiln") {
    throw new Error("Embedded browser host smoke failed to dispatch text input.");
  }
  if (observation.scrollY <= 0) {
    throw new Error("Embedded browser host smoke failed to dispatch wheel input.");
  }

  return {
    ok: true,
    surface: "native",
    hostTransport: NATIVE_BROWSER_HOST_TRANSPORT,
    sessionState,
    observation,
    evidence: {
      kind: evidenceEvent.kind,
      payload: evidenceEvent.payload,
    },
  };
}

function waitForHostInputSettle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 50);
  });
}
