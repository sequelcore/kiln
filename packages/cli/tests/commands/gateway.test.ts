import { describe, it, expect, vi } from "vitest";

// Test the gateway command module.
// The gateway-server module is not tested here (it may not exist yet).
// We test: help output, argument parsing, and missing config errors.

describe("gatewayCommand", () => {
  it("prints help with --help flag", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { gatewayCommand } = await import("../../src/commands/gateway.js");
    await gatewayCommand(["--help"]);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Usage: gateway [options]"));
    consoleSpy.mockRestore();
  });

  it("prints help with -h flag", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { gatewayCommand } = await import("../../src/commands/gateway.js");
    await gatewayCommand(["-h"]);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Usage: gateway [options]"));
    consoleSpy.mockRestore();
  });

  it("help output includes --config and --port options", async () => {
    const lines: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((msg: unknown) => {
      lines.push(String(msg));
    });
    const { gatewayCommand } = await import("../../src/commands/gateway.js");
    await gatewayCommand(["--help"]);
    const output = lines.join("\n");
    expect(output).toContain("--config");
    expect(output).toContain("--port");
    expect(output).toContain("--help");
    consoleSpy.mockRestore();
  });

  it("errors when gateway.yaml not found in cwd", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    const { gatewayCommand } = await import("../../src/commands/gateway.js");

    await expect(gatewayCommand([])).rejects.toThrow("process.exit called");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Gateway config not found"));

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("errors when specified --config path not found", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    const { gatewayCommand } = await import("../../src/commands/gateway.js");

    await expect(
      gatewayCommand(["--config", "/nonexistent/path/gateway.yaml"]),
    ).rejects.toThrow("process.exit called");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Gateway config not found"),
    );

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("error message includes the missing config path", async () => {
    const errorMessages: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((msg: unknown) => {
      errorMessages.push(String(msg));
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    const { gatewayCommand } = await import("../../src/commands/gateway.js");

    await expect(
      gatewayCommand(["--config", "/nonexistent/gateway.yaml"]),
    ).rejects.toThrow("process.exit called");

    const output = errorMessages.join("\n");
    expect(output).toContain("/nonexistent/gateway.yaml");
    expect(output).toContain("gateway.yaml");

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("error message suggests creating gateway.yaml", async () => {
    const errorMessages: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((msg: unknown) => {
      errorMessages.push(String(msg));
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    const { gatewayCommand } = await import("../../src/commands/gateway.js");

    await expect(gatewayCommand([])).rejects.toThrow("process.exit called");

    const output = errorMessages.join("\n");
    expect(output).toContain("gateway.yaml");

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
