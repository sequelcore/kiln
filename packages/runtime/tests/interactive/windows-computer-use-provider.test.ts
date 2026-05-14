import { describe, expect, it, vi } from "vitest";
import { MemoryArtifactResourceStore } from "@kilnai/core";
import {
  WindowsComputerCaptureRecorder,
} from "../../src/interactive/windows-computer-capture-recorder.js";
import {
  NUT_JS_COMPUTER_USE_MISSING_DEPENDENCY_MESSAGE,
  WindowsComputerUseProvider,
} from "../../src/interactive/windows-computer-use-provider.js";

describe("WindowsComputerUseProvider", () => {
  it("returns a clear setup error when the optional nut.js dependency is missing", async () => {
    const provider = new WindowsComputerUseProvider({
      allowComputer: true,
      allowedApplications: ["Calculator"],
      activeApplicationResolver: () => "Calculator",
      loader: async () => {
        throw new Error(NUT_JS_COMPUTER_USE_MISSING_DEPENDENCY_MESSAGE);
      },
    });

    await expect(provider.execute({
      toolName: "computer_observe",
      target: "computer",
      operation: "observe",
      input: { application: "Calculator" },
    })).rejects.toThrow(NUT_JS_COMPUTER_USE_MISSING_DEPENDENCY_MESSAGE);
  });

  it("enforces explicit computer and application authority", async () => {
    const provider = new WindowsComputerUseProvider({
      allowComputer: false,
      allowedApplications: ["Calculator"],
      loader: async () => fakeNut(),
    });

    await expect(provider.execute({
      toolName: "computer_observe",
      target: "computer",
      operation: "observe",
      input: { application: "Calculator" },
    })).rejects.toThrow("Computer automation is disabled. Set interactiveUse.allowComputer=true before using computer tools.");

    const scopedProvider = new WindowsComputerUseProvider({
      allowComputer: true,
      allowedApplications: ["Calculator"],
      loader: async () => fakeNut(),
      activeApplicationResolver: () => "Notepad",
    });
    await expect(scopedProvider.execute({
      toolName: "computer_click",
      target: "computer",
      operation: "click",
      action: { type: "click", x: 10, y: 20 },
      input: { application: "Calculator", target: { x: 10, y: 20 } },
    })).rejects.toThrow("Computer automation denied for application 'Notepad'. Configure interactiveUse.allowedApplications to allow it.");

    const unresolvedProvider = new WindowsComputerUseProvider({
      allowComputer: true,
      allowedApplications: ["Calculator"],
      loader: async () => fakeNut(),
    });
    await expect(unresolvedProvider.execute({
      toolName: "computer_observe",
      target: "computer",
      operation: "observe",
      input: { application: "Calculator" },
    })).rejects.toThrow("Computer automation requires a trusted active application resolver before using Windows computer tools.");
  });

  it("denies requested applications and missing active-window authority before loading nut.js", async () => {
    const loader = vi.fn(async () => fakeNut());
    const disallowedRequestedProvider = new WindowsComputerUseProvider({
      allowComputer: true,
      allowedApplications: ["Calculator"],
      loader,
      activeApplicationResolver: () => "Calculator",
    });

    await expect(disallowedRequestedProvider.execute({
      toolName: "computer_observe",
      target: "computer",
      operation: "observe",
      input: { application: "Notepad" },
    })).rejects.toThrow("Computer automation denied for requested application 'Notepad'. Configure interactiveUse.allowedApplications to allow it.");
    expect(loader).not.toHaveBeenCalled();

    const unresolvedLoader = vi.fn(async () => fakeNut());
    const unresolvedProvider = new WindowsComputerUseProvider({
      allowComputer: true,
      allowedApplications: ["Calculator"],
      loader: unresolvedLoader,
    });

    await expect(unresolvedProvider.execute({
      toolName: "computer_observe",
      target: "computer",
      operation: "observe",
      input: { application: "Calculator" },
    })).rejects.toThrow("Computer automation requires a trusted active application resolver before using Windows computer tools.");
    expect(unresolvedLoader).not.toHaveBeenCalled();
  });

  it("does not write capture proof artifacts when application policy denies the session", async () => {
    const artifactStore = new MemoryArtifactResourceStore();
    const captureRecorder = new WindowsComputerCaptureRecorder({ artifactStore });
    const provider = new WindowsComputerUseProvider({
      allowComputer: true,
      allowedApplications: ["Calculator"],
      loader: async () => fakeNut(),
      activeApplicationResolver: () => "Notepad",
      captureRecorder,
    });

    await expect(provider.execute({
      toolName: "computer_observe",
      target: "computer",
      operation: "observe",
      sessionId: "computer-denied",
      input: { application: "Calculator", includeScreenshot: true },
    })).rejects.toThrow("Computer automation denied for application 'Notepad'. Configure interactiveUse.allowedApplications to allow it.");

    expect(() => captureRecorder.finalizeSession("computer-denied"))
      .toThrow("Cannot finalize Windows computer capture proof without raw capture frames.");
    expect(artifactStore.listNamespaces()
      .filter((summary) => summary.namespace.startsWith("recorder-computer-capture")))
      .toEqual([]);
  });

  it("enforces configured application aliases for active-window authority", async () => {
    const provider = new WindowsComputerUseProvider({
      allowComputer: true,
      allowedApplications: ["notepad"],
      applicationAliases: {
        notepad: ["Bloc de notas"],
      },
      loader: async () => fakeNut(),
      activeApplicationResolver: () => "Bloc de notas",
    });

    await expect(provider.execute({
      toolName: "computer_observe",
      target: "computer",
      operation: "observe",
      input: { application: "notepad" },
    })).resolves.toMatchObject({
      provider: "windows-nutjs",
      observation: {
        application: "Bloc de notas",
      },
    });
  });

  it("observes, clicks, types, and presses keys through nut.js", async () => {
    const events: string[] = [];
    const provider = new WindowsComputerUseProvider({
      allowComputer: true,
      allowedApplications: ["Calculator"],
      loader: async () => fakeNut(events),
      activeApplicationResolver: () => "Calculator",
    });

    await expect(provider.execute({
      toolName: "computer_observe",
      target: "computer",
      operation: "observe",
      input: { includeScreenshot: true },
    })).resolves.toMatchObject({
      provider: "windows-nutjs",
      observation: {
        application: "Calculator",
        screenshotDataUrl: "data:image/png;base64,abc",
      },
    });

    await provider.execute({
      toolName: "computer_click",
      target: "computer",
      operation: "click",
      action: { type: "click", x: 40, y: 50, button: "left" },
      input: { target: { x: 40, y: 50 } },
    });
    await provider.execute({
      toolName: "computer_type",
      target: "computer",
      operation: "type",
      action: { type: "type", textLength: 2 },
      input: { text: "42" },
    });
    await provider.execute({
      toolName: "computer_keypress",
      target: "computer",
      operation: "keypress",
      action: { type: "keypress", keys: ["Enter"] },
      input: { keys: ["Enter"] },
    });

    expect(events).toEqual([
      "screen.width",
      "screen.height",
      "screen.capture",
      "mouse.move:40,50",
      "mouse.click:left",
      "screen.width",
      "screen.height",
      "keyboard.type:42",
      "screen.width",
      "screen.height",
      "keyboard.type:Enter",
      "screen.width",
      "screen.height",
    ]);
  });

  it("records governed screenshot and action proof artifacts after policy-approved Windows computer use", async () => {
    const artifactStore = new MemoryArtifactResourceStore({ now: () => "2026-05-14T20:00:05.000Z" });
    const captureRecorder = new WindowsComputerCaptureRecorder({ artifactStore });
    const provider = new WindowsComputerUseProvider({
      allowComputer: true,
      allowedApplications: ["Calculator"],
      loader: async () => fakeNut(),
      activeApplicationResolver: () => "Calculator",
      captureRecorder,
      now: sequenceNow([
        "2026-05-14T20:00:00.000Z",
        "2026-05-14T20:00:00.100Z",
        "2026-05-14T20:00:00.250Z",
        "2026-05-14T20:00:00.400Z",
        "2026-05-14T20:00:00.500Z",
        "2026-05-14T20:00:00.700Z",
      ]),
    });

    await provider.execute({
      toolName: "computer_observe",
      target: "computer",
      operation: "observe",
      sessionId: "computer-proof",
      input: { application: "Calculator", windowTitle: "Calculator", includeScreenshot: true },
    });
    await provider.execute({
      toolName: "computer_click",
      target: "computer",
      operation: "click",
      sessionId: "computer-proof",
      action: { type: "click", x: 40, y: 50, button: "left" },
      input: { application: "Calculator", target: { x: 40, y: 50 } },
    });
    await provider.execute({
      toolName: "computer_type",
      target: "computer",
      operation: "type",
      sessionId: "computer-proof",
      action: { type: "type", textLength: 8, sensitive: true },
      input: { application: "Calculator", text: "secret42" },
      sensitive: true,
    });

    const proof = captureRecorder.finalizeSession("computer-proof", {
      completedAt: "2026-05-14T20:00:01.000Z",
      title: "Governed Windows computer proof",
    });

    expect(proof).toMatchObject({
      sessionId: "computer-proof",
      frameCount: 1,
      eventCount: 3,
    });

    const manifest = readJsonArtifact(artifactStore, proof.manifestUri);
    expect(manifest).toMatchObject({
      status: "captured",
      policy: {
        redaction: { status: "pending", sensitive: true },
      },
      tracks: {
        rawCapture: [{
          source: {
            kind: "computer_session",
            target: "computer",
            sessionId: "computer-proof",
            application: "Calculator",
            windowTitle: "Calculator",
          },
          capture: {
            transport: "desktop-capture",
            resource: {
              uri: proof.rawCaptureEvidenceUri,
            },
          },
        }],
      },
    });

    const eventTrack = readJsonArtifact(artifactStore, proof.eventTrackUri);
    expect(eventTrack).toMatchObject({
      events: [
        expect.objectContaining({ toolName: "computer_observe", operation: "observe", offsetMs: 0 }),
        expect.objectContaining({ toolName: "computer_click", operation: "click", offsetMs: 150, x: 40, y: 50 }),
        expect.objectContaining({ toolName: "computer_type", operation: "type", offsetMs: 400, textLength: 8, sensitive: true }),
      ],
    });
    expect(JSON.stringify(eventTrack)).not.toContain("secret42");
    expect(readArtifact(artifactStore, proof.frameArtifactUris[0]!).mimeType).toBe("image/png");
  });
});

function fakeNut(events: string[] = []) {
  class Point {
    constructor(readonly x: number, readonly y: number) {}
  }
  return {
    Button: {
      LEFT: "left",
      MIDDLE: "middle",
      RIGHT: "right",
    },
    Key: {
      Enter: "Enter",
    },
    Point,
    straightTo(point: { readonly x: number; readonly y: number }) {
      return point;
    },
    mouse: {
      async move(point: { readonly x: number; readonly y: number }) {
        events.push(`mouse.move:${point.x},${point.y}`);
      },
      async click(button: string) {
        events.push(`mouse.click:${button}`);
      },
    },
    keyboard: {
      type: vi.fn(async (...keys: readonly string[]) => {
        events.push(`keyboard.type:${keys.join("+")}`);
      }),
    },
    screen: {
      async width() {
        events.push("screen.width");
        return 1920;
      },
      async height() {
        events.push("screen.height");
        return 1080;
      },
      async capture() {
        events.push("screen.capture");
        return {
          width: 1920,
          height: 1080,
          toDataURL: () => "data:image/png;base64,abc",
        };
      },
    },
  };
}

function sequenceNow(values: readonly string[]): () => Date {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)]!;
    index += 1;
    return new Date(value);
  };
}

function readArtifact(artifactStore: MemoryArtifactResourceStore, uri: string) {
  const match = /^kiln:\/\/artifacts\/([^/]+)\/([^/]+)\/content$/u.exec(uri);
  if (!match) {
    throw new Error(`Unexpected artifact URI: ${uri}`);
  }
  const artifact = artifactStore.get(match[1]!, match[2]!);
  if (!artifact) {
    throw new Error(`Missing artifact: ${uri}`);
  }
  return artifact;
}

function readJsonArtifact(artifactStore: MemoryArtifactResourceStore, uri: string): Record<string, unknown> {
  const artifact = readArtifact(artifactStore, uri);
  if (artifact.content.type !== "json") {
    throw new Error(`Expected JSON artifact: ${uri}`);
  }
  return artifact.content.value as Record<string, unknown>;
}
