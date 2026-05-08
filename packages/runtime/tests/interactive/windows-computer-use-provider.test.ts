import { describe, expect, it, vi } from "vitest";
import {
  NUT_JS_COMPUTER_USE_MISSING_DEPENDENCY_MESSAGE,
  WindowsComputerUseProvider,
} from "../../src/interactive/windows-computer-use-provider.js";

describe("WindowsComputerUseProvider", () => {
  it("returns a clear setup error when the optional nut.js dependency is missing", async () => {
    const provider = new WindowsComputerUseProvider({
      allowComputer: true,
      allowedApplications: ["Calculator"],
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
