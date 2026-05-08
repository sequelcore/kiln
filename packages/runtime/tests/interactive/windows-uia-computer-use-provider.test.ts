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
      input: { includeAccessibility: true },
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

  it("normalizes accessibility-tree automation id refs before sending them to the UIA sidecar", async () => {
    const calls: WindowsUiaSidecarRequest[] = [];
    const provider = new WindowsUiaComputerUseProvider({
      allowComputer: true,
      allowedApplications: ["Calculator"],
      runner: fakeRunner(calls, [
        { observation: { application: "Calculator", windowTitle: "Calculator" } },
        { observation: { application: "Calculator", windowTitle: "Calculator" } },
      ]),
    });

    await provider.execute({
      toolName: "computer_click",
      target: "computer",
      operation: "click",
      input: {
        target: { selector: "#plusButton" },
      },
    });

    expect(calls).toEqual([
      { operation: "observe", includeAccessibility: false, maxDepth: 1, timeoutMs: undefined },
      { operation: "click", selector: "automationId=plusButton", timeoutMs: undefined },
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

  it("focuses a requested allowed application before observation instead of requiring it to be active", async () => {
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
      input: { application: "Calculator", includeAccessibility: true },
    })).resolves.toMatchObject({
      provider: "windows-uia",
      observation: {
        application: "Calculator",
        windowTitle: "Calculator",
      },
    });

    expect(calls).toEqual([
      { operation: "focus_application", application: "Calculator" },
      { operation: "observe", includeAccessibility: true, maxDepth: 4 },
    ]);
  });

  it("opens, minimizes, and closes only requested applications allowed by policy", async () => {
    const calls: WindowsUiaSidecarRequest[] = [];
    const provider = new WindowsUiaComputerUseProvider({
      allowComputer: true,
      allowedApplications: ["Calculator"],
      runner: fakeRunner(calls, [
        { observation: { application: "Calculator", windowTitle: "Calculator" } },
        { observation: { application: "Calculator", windowTitle: "Calculator" } },
        { observation: { application: "Calculator", windowTitle: "Calculator" } },
      ]),
    });

    await provider.execute({
      toolName: "computer_open_application",
      target: "computer",
      operation: "open_application",
      input: { application: "Calculator" },
    });
    await provider.execute({
      toolName: "computer_minimize_application",
      target: "computer",
      operation: "minimize_application",
      input: { application: "Calculator" },
    });
    await provider.execute({
      toolName: "computer_close_application",
      target: "computer",
      operation: "close_application",
      input: { application: "Calculator" },
    });
    await expect(provider.execute({
      toolName: "computer_close_application",
      target: "computer",
      operation: "close_application",
      input: { application: "Notepad" },
    })).rejects.toThrow("Computer automation denied for requested application 'Notepad'");

    expect(calls).toEqual([
      { operation: "open_application", application: "Calculator" },
      { operation: "minimize_application", application: "Calculator" },
      { operation: "close_application", application: "Calculator" },
    ]);
  });

  it("allows focusing the Kiln operator surface as self-authority without widening app automation policy", async () => {
    const calls: WindowsUiaSidecarRequest[] = [];
    const provider = new WindowsUiaComputerUseProvider({
      allowComputer: true,
      allowedApplications: [],
      runner: fakeRunner(calls, [
        { observation: { application: "msedge", windowTitle: "Kiln" } },
      ]),
    });

    await provider.execute({
      toolName: "computer_focus_application",
      target: "computer",
      operation: "focus_application",
      input: { application: "Kiln" },
    });
    await expect(provider.execute({
      toolName: "computer_close_application",
      target: "computer",
      operation: "close_application",
      input: { application: "Kiln" },
    })).rejects.toThrow("Computer automation application policy is missing");

    expect(calls).toEqual([
      { operation: "focus_application", application: "Kiln", windowTitle: undefined, timeoutMs: undefined },
    ]);
  });

  it("treats localized Calculator identities as the same governed application", async () => {
    const calls: WindowsUiaSidecarRequest[] = [];
    const provider = new WindowsUiaComputerUseProvider({
      allowComputer: true,
      allowedApplications: ["Calculator"],
      runner: fakeRunner(calls, [
        { observation: { application: "CalculatorApp", windowTitle: "Calculadora" } },
        { observation: { application: "CalculatorApp", windowTitle: "Calculadora" } },
        { observation: { application: "CalculatorApp", windowTitle: "Calculadora" } },
      ]),
    });

    await provider.execute({
      toolName: "computer_observe",
      target: "computer",
      operation: "observe",
      input: {},
    });
    await provider.execute({
      toolName: "computer_minimize_application",
      target: "computer",
      operation: "minimize_application",
      input: { application: "CalculatorApp", windowTitle: "Calculadora" },
    });

    expect(calls).toEqual([
      { operation: "observe", includeAccessibility: false, maxDepth: 1 },
      { operation: "observe", includeAccessibility: false, maxDepth: 4 },
      { operation: "minimize_application", application: "CalculatorApp", windowTitle: "Calculadora" },
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
