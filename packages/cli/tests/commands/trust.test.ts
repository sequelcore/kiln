import { basename } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: null as { identity?: { name?: string } } | null,
  plan: vi.fn(),
  finalize: vi.fn(),
  revoke: vi.fn(),
  acceptLimitation: vi.fn(),
  revokeLimitation: vi.fn(),
  createInterface: vi.fn(),
  answers: [] as Array<string | null>,
  projectRoot: process.cwd(),
}));
vi.mock("../../src/config/global-config.js", () => ({ readGlobalConfig: () => mocks.config }));
vi.mock("../../src/application/project-root-resolver.js", () => ({ resolveProjectRoot: () => ({ rootPath: mocks.projectRoot }) }));
vi.mock("@kilnai/core", () => ({
  resolveCoreKilnHome: () => "C:/kiln-test-home",
  OPENCODE_NO_FILESYSTEM_SANDBOX: {
    id: "opencode.no-filesystem-sandbox",
    reviewAfter: "2026-11-13T00:00:00.000Z",
  },
  acceptTrustedExecutionSemanticLimitation: mocks.acceptLimitation,
  finalizeTrustedExecutionGrant: mocks.finalize,
  planTrustedExecutionGrant: mocks.plan,
  revokeTrustedExecutionGrant: mocks.revoke,
  revokeTrustedExecutionSemanticLimitation: mocks.revokeLimitation,
}));
vi.mock("node:readline", () => ({ default: { createInterface: mocks.createInterface } }));

import { trustCommand } from "../../src/commands/trust.js";

describe("trust command", () => {
  const setInteractive = (stdin = true, stdout = true) => {
    if (!Object.hasOwn(process.stdin, "isTTY"))
      Object.defineProperty(process.stdin, "isTTY", { configurable: true, get: () => undefined });
    if (!Object.hasOwn(process.stdout, "isTTY"))
      Object.defineProperty(process.stdout, "isTTY", { configurable: true, get: () => undefined });
    vi.spyOn(process.stdin, "isTTY", "get").mockReturnValue(stdin);
    vi.spyOn(process.stdout, "isTTY", "get").mockReturnValue(stdout);
  };

  const setPromptAnswers = (...answers: Array<string | null>) => {
    mocks.answers.push(...answers);
    mocks.createInterface.mockImplementation(() => {
      const handlers = new Map<string, (value?: string) => void>();
      const readline = {
        once: (event: string, handler: (value?: string) => void) => {
          handlers.set(event, handler);
          if (event === "close" || event === "line") {
            queueMicrotask(() => {
              const answer = mocks.answers.shift() ?? "";
              if (answer === null) handlers.get("close")?.();
              else handlers.get("line")?.(answer);
            });
          }
          return readline;
        },
        close: vi.fn(),
      };
      return readline;
    });
  };

  beforeEach(() => {
    mocks.config = { identity: { name: "operator" } };
    mocks.projectRoot = process.cwd();
    setInteractive();
  });

  afterEach(() => {
    mocks.config = null;
    mocks.answers.length = 0;
    vi.clearAllMocks();
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it("refuses before prompting when operator identity is absent", async () => {
    mocks.config = null;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await trustCommand(["grant", "codex"]);
    expect(error).toHaveBeenCalledWith(
      "Set your operator identity first: kiln config set --global identity.name <name>",
    );
    expect(process.exitCode).toBe(1);
  });
  it("rejects unsupported action and harness combinations", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await trustCommand(["grant", "unknown"]);
    expect(error).toHaveBeenCalledWith("Usage: kiln trust <grant|revoke> <codex|claude-code|opencode> [--full-access]");
    expect(process.exitCode).toBe(1);
  });

  it.each([
    [false, true],
    [true, false],
  ])("refuses non-interactive terminals without prompting (stdin=%s, stdout=%s)", async (stdin, stdout) => {
    vi.spyOn(process.stdin, "isTTY", "get").mockReturnValue(stdin);
    vi.spyOn(process.stdout, "isTTY", "get").mockReturnValue(stdout);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await trustCommand(["grant", "codex"]);

    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^Run manually in an interactive terminal:/));
    expect(mocks.createInterface).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("records a default-profile grant after binary confirmation", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.plan.mockReturnValue({
      harness: "codex",
      projectPath: process.cwd(),
      currentProfile: "restricted",
      requestedProfile: "workspace-write",
      enforcement: {
        approvalControl: "operator",
        filesystemSandbox: "workspace",
        networkBoundary: "restricted",
        strength: "strong",
      },
      confirmationKind: "binary",
    });
    mocks.finalize.mockReturnValue({ status: "authorized", authorizedBy: "operator", authorizedAt: "now" });
    setPromptAnswers("y");

    await trustCommand(["grant", "codex"]);

    expect(mocks.finalize).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Trusted-execution grant recorded"));
    expect(process.exitCode).toBeUndefined();
  });

  it.each(["", "n"])("denies a default-profile grant for binary answer %j", async (answer) => {
    mocks.plan.mockReturnValue({ confirmationKind: "binary", enforcement: {} });
    setPromptAnswers(answer);

    await trustCommand(["grant", "codex"]);

    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("records a full-access grant after exact basename confirmation", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const projectPath = process.cwd();
    mocks.plan.mockReturnValue({
      harness: "codex",
      projectPath,
      currentProfile: "restricted",
      requestedProfile: "trusted-full-access",
      enforcement: {
        approvalControl: "operator",
        filesystemSandbox: "none",
        networkBoundary: "open",
        strength: "strong",
      },
      confirmationKind: "typed-basename",
      basename: basename(projectPath),
    });
    mocks.finalize.mockReturnValue({ status: "authorized", authorizedBy: "operator", authorizedAt: "now" });
    setPromptAnswers(basename(projectPath));

    await trustCommand(["grant", "codex", "--full-access"]);

    expect(mocks.finalize).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Trusted-execution grant recorded"));
  });

  it("denies full-access after three wrong basename attempts", async () => {
    mocks.plan.mockReturnValue({
      confirmationKind: "typed-basename",
      basename: basename(process.cwd()),
      enforcement: {},
    });
    setPromptAnswers("wrong", "wrong", "wrong");

    await trustCommand(["grant", "codex", "--full-access"]);

    expect(mocks.createInterface).toHaveBeenCalledTimes(3);
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("reports when revoking a grant that does not exist", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.revoke.mockReturnValue({ hadExistingGrant: false });

    await trustCommand(["revoke", "codex"]);

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^No trusted-execution grant exists for/));
    expect(process.exitCode).toBeUndefined();
  });

  it("reports when revoking an existing grant", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.revoke.mockReturnValue({ hadExistingGrant: true });

    await trustCommand(["revoke", "codex"]);

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^Trusted-execution grant revoked for/));
  });

  it("requires explicit noninteractive limitation identity and typed basename", async () => {
    setInteractive(false, false);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await trustCommand(["accept-limitation", "--harness", "opencode", "--limitation", "opencode.no-filesystem-sandbox"]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("requires --operator and --confirm"));
    expect(mocks.acceptLimitation).not.toHaveBeenCalled();
  });

  it("records an exact OpenCode limitation acceptance without changing grants", async () => {
    setInteractive(false, false);
    mocks.acceptLimitation.mockReturnValue({ acceptedBy: "operator", reviewAfter: "2026-11-13T00:00:00.000Z" });
    await trustCommand(["accept-limitation", "--harness", "opencode", "--limitation", "opencode.no-filesystem-sandbox", "--operator", "operator", "--confirm", basename(process.cwd())]);
    expect(mocks.acceptLimitation).toHaveBeenCalledOnce();
    expect(mocks.finalize).not.toHaveBeenCalled();
  });

  it("binds limitation acceptance to the canonical project root, not a working subdirectory", async () => {
    setInteractive(false, false);
    mocks.projectRoot = `${process.cwd()}/canonical-root`;
    mocks.acceptLimitation.mockReturnValue({ acceptedBy: "operator", reviewAfter: "2026-11-13T00:00:00.000Z" });
    await trustCommand(["accept-limitation", "--harness", "opencode", "--limitation", "opencode.no-filesystem-sandbox", "--operator", "operator", "--confirm", "canonical-root"]);
    expect(mocks.acceptLimitation).toHaveBeenCalledWith(expect.objectContaining({ projectPath: mocks.projectRoot }));
  });
});
