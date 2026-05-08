import { describe, expect, it } from "vitest";
import {
  WINDOWS_UIA_COMPUTER_USE_MISSING_DEPENDENCY_MESSAGE,
  WindowsUiaComputerUseProvider,
  type WindowsUiaSidecarRequest,
  type WindowsUiaSidecarResponse,
} from "../../src/interactive/windows-uia-computer-use-provider.js";

describe("WindowsUiaComputerUseProvider", () => {
  it("returns a clear setup error when the Kiln Windows UIA sidecar is missing", async () => {
    const provider = new WindowsUiaComputerUseProvider({
      allowComputer: true,
      allowedApplications: ["Calculator"],
      sidecarPath: "C:\\does-not-exist\\kiln-windows-uia.exe",
    });

    await expect(provider.execute({
      toolName: "computer_observe",
      target: "computer",
      operation: "observe",
      input: { includeAccessibility: true },
    })).rejects.toThrow(WINDOWS_UIA_COMPUTER_USE_MISSING_DEPENDENCY_MESSAGE);
  });

  it("observes the trusted active window and accessibility tree", async () => {
    const calls: WindowsUiaSidecarRequest[] = [];
    const provider = new WindowsUiaComputerUseProvider({
      allowComputer: true,
      allowedApplications: ["Calculator"],
      runner: fakeRunner(calls, [
        { observation: { application: "Calculator", windowTitle: "Calculator" } },
        { observation: { application: "Calculator", windowTitle: "Calculator", visibleText: "button One" } },
      ]),
    });

    await expect(provider.execute({
      toolName: "computer_observe",
      target: "computer",
      operation: "observe",
      input: { application: "Notepad", includeAccessibility: true },
    })).resolves.toMatchObject({
      provider: "windows-uia",
      observation: {
        application: "Calculator",
        windowTitle: "Calculator",
        visibleText: expect.stringContaining("One"),
      },
    });
    expect(calls).toEqual([
      { operation: "observe", includeAccessibility: false, maxDepth: 1 },
      { operation: "observe", includeAccessibility: true, maxDepth: 4 },
    ]);
  });

  it("denies actions when the trusted active application is outside the allowlist", async () => {
    const calls: WindowsUiaSidecarRequest[] = [];
    const provider = new WindowsUiaComputerUseProvider({
      allowComputer: true,
      allowedApplications: ["Calculator"],
      runner: fakeRunner(calls, [
        { observation: { application: "Notepad", windowTitle: "Untitled - Notepad" } },
      ]),
    });

    await expect(provider.execute({
      toolName: "computer_click",
      target: "computer",
      operation: "click",
      input: {
        application: "Calculator",
        target: { selector: "type=button;title=One" },
      },
    })).rejects.toThrow("Computer automation denied for active application 'Notepad'");
    expect(calls).toEqual([
      { operation: "observe", includeAccessibility: false, maxDepth: 1 },
    ]);
  });

  it("clicks semantic UIA selectors and rejects coordinate-only pointer actions", async () => {
    const calls: WindowsUiaSidecarRequest[] = [];
    const provider = new WindowsUiaComputerUseProvider({
      allowComputer: true,
      allowedApplications: ["Calculator"],
      runner: fakeRunner(calls, [
        { observation: { application: "Calculator", windowTitle: "Calculator" } },
        { observation: { application: "Calculator", windowTitle: "Calculator", visibleText: "button One" } },
        { observation: { application: "Calculator", windowTitle: "Calculator" } },
      ]),
    });

    await provider.execute({
      toolName: "computer_click",
      target: "computer",
      operation: "click",
      input: {
        target: { type: "button", title: "One" },
      },
    });
    await expect(provider.execute({
      toolName: "computer_click",
      target: "computer",
      operation: "click",
      action: { type: "click", x: 20, y: 30, button: "right" },
      input: {
        target: { x: 20, y: 30 },
      },
    })).rejects.toThrow("requires a semantic selector/ref");

    expect(calls).toEqual([
      { operation: "observe", includeAccessibility: false, maxDepth: 1 },
      { operation: "click", selector: "type=button;title=One" },
      { operation: "observe", includeAccessibility: false, maxDepth: 1 },
    ]);
  });

  it("types text through semantic UIA value patterns", async () => {
    const calls: WindowsUiaSidecarRequest[] = [];
    const provider = new WindowsUiaComputerUseProvider({
      allowComputer: true,
      allowedApplications: ["Calculator"],
      runner: fakeRunner(calls, [
        { observation: { application: "Calculator", windowTitle: "Calculator" } },
        { observation: { application: "Calculator", windowTitle: "Calculator", visibleText: "edit Display" } },
      ]),
    });

    await provider.execute({
      toolName: "computer_type",
      target: "computer",
      operation: "type",
      input: {
        text: "123",
        target: { ref: "automationId=CalculatorResults" },
      },
    });

    expect(calls).toEqual([
      { operation: "observe", includeAccessibility: false, maxDepth: 1 },
      { operation: "type", selector: "automationId=CalculatorResults", text: "123" },
    ]);
  });
});

function fakeRunner(
  calls: WindowsUiaSidecarRequest[],
  responses: readonly WindowsUiaSidecarResponse[],
) {
  let index = 0;
  return async (request: WindowsUiaSidecarRequest): Promise<WindowsUiaSidecarResponse> => {
    calls.push(request);
    const response = responses[index];
    index += 1;
    if (!response) {
      throw new Error(`unexpected sidecar request: ${request.operation}`);
    }
    return response;
  };
}
