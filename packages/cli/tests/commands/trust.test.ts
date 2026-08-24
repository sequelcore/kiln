import { basename } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: null as { identity?: { name?: string } } | null,
  acceptLimitation: vi.fn(),
  revokeLimitation: vi.fn(),
  createInterface: vi.fn(),
  projectRoot: process.cwd(),
}));

vi.mock("../../src/config/global-config.js", () => ({ readGlobalConfig: () => mocks.config }));
vi.mock("../../src/application/project-root-resolver.js", () => ({
  resolveProjectRoot: () => ({ rootPath: mocks.projectRoot }),
}));
vi.mock("@kilnai/core", () => ({
  resolveCoreKilnHome: () => "C:/kiln-test-home",
  OPENCODE_NO_FILESYSTEM_SANDBOX: {
    id: "opencode.no-filesystem-sandbox",
    reviewAfter: "2026-11-13T00:00:00.000Z",
  },
  acceptTrustedExecutionSemanticLimitation: mocks.acceptLimitation,
  revokeTrustedExecutionSemanticLimitation: mocks.revokeLimitation,
}));
vi.mock("node:readline", () => ({ default: { createInterface: mocks.createInterface } }));

import { trustCommand } from "../../src/commands/trust.js";

describe("trust command", () => {
  const setInteractive = (stdin: boolean, stdout: boolean) => {
    if (!Object.hasOwn(process.stdin, "isTTY")) {
      Object.defineProperty(process.stdin, "isTTY", { configurable: true, get: () => undefined });
    }
    if (!Object.hasOwn(process.stdout, "isTTY")) {
      Object.defineProperty(process.stdout, "isTTY", { configurable: true, get: () => undefined });
    }
    vi.spyOn(process.stdin, "isTTY", "get").mockReturnValue(stdin);
    vi.spyOn(process.stdout, "isTTY", "get").mockReturnValue(stdout);
  };

  beforeEach(() => {
    mocks.config = { identity: { name: "operator" } };
    mocks.projectRoot = process.cwd();
  });

  afterEach(() => {
    mocks.config = null;
    vi.clearAllMocks();
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it("exposes only semantic-limitation operations", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await trustCommand(["grant", "codex", "--full-access"]);

    expect(error).toHaveBeenCalledWith(expect.stringContaining("kiln trust <accept-limitation|revoke-limitation>"));
    expect(mocks.createInterface).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("requires explicit noninteractive limitation identity and typed basename", async () => {
    setInteractive(false, false);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await trustCommand([
      "accept-limitation",
      "--harness",
      "opencode",
      "--limitation",
      "opencode.no-filesystem-sandbox",
    ]);

    expect(error).toHaveBeenCalledWith(expect.stringContaining("requires --operator and --confirm"));
    expect(mocks.acceptLimitation).not.toHaveBeenCalled();
  });

  it("records an exact OpenCode limitation acceptance without creating a grant", async () => {
    setInteractive(false, false);
    mocks.acceptLimitation.mockReturnValue({
      acceptedBy: "operator",
      reviewAfter: "2026-11-13T00:00:00.000Z",
    });

    await trustCommand([
      "accept-limitation",
      "--harness",
      "opencode",
      "--limitation",
      "opencode.no-filesystem-sandbox",
      "--operator",
      "operator",
      "--confirm",
      basename(process.cwd()),
    ]);

    expect(mocks.acceptLimitation).toHaveBeenCalledOnce();
  });

  it("binds limitation acceptance to the canonical project root", async () => {
    setInteractive(false, false);
    mocks.projectRoot = `${process.cwd()}/canonical-root`;
    mocks.acceptLimitation.mockReturnValue({
      acceptedBy: "operator",
      reviewAfter: "2026-11-13T00:00:00.000Z",
    });

    await trustCommand([
      "accept-limitation",
      "--harness",
      "opencode",
      "--limitation",
      "opencode.no-filesystem-sandbox",
      "--operator",
      "operator",
      "--confirm",
      "canonical-root",
    ]);

    expect(mocks.acceptLimitation).toHaveBeenCalledWith(expect.objectContaining({ projectPath: mocks.projectRoot }));
  });
});
