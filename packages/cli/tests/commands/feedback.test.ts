import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi, afterEach } from "vitest";
import { feedbackCommand } from "../../src/commands/feedback.js";
import { resolveProjectStateBinding } from "../../src/application/project-state-root.js";

const tempRoots: string[] = [];

describe("feedback command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes a local-only redacted feedback bundle and issue draft", async () => {
    const root = createTempRoot();
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await feedbackCommand({} as never, "draft", [
      "--project",
      root,
      "--session",
      "session-123",
      "--mode",
      "quick",
      "--description",
      "The run leaked sk-ant-secret123 in output.",
      "--expected",
      "The command should redact secrets.",
      "--actual",
      "The command printed a provider key.",
      "--git-status-text",
      " M packages/cli/src/commands/feedback.ts",
      "--created-at",
      "2026-05-18T10:00:00.000Z",
    ]);

    const outputDir = join(resolveProjectStateBinding(root).projectStateRoot, "feedback");
    const bundlePath = join(outputDir, "feedback-2026-05-18T10-00-00-000Z.json");
    const issuePath = join(outputDir, "feedback-2026-05-18T10-00-00-000Z.md");
    expect(existsSync(bundlePath)).toBe(true);
    expect(existsSync(issuePath)).toBe(true);

    const bundle = JSON.parse(readFileSync(bundlePath, "utf-8")) as {
      readonly status: string;
      readonly publication: { readonly allowed: boolean };
      readonly report: { readonly description: string };
      readonly evidence: readonly { readonly kind: string; readonly content: string }[];
    };
    expect(bundle.status).toBe("local-draft");
    expect(bundle.publication.allowed).toBe(false);
    expect(bundle.report.description).not.toContain("sk-ant-secret123");
    expect(bundle.report.description).toContain("[REDACTED:credential]");
    expect(bundle.evidence).toEqual([
      {
        kind: "git-status",
        title: "CLI git status",
        content: " M packages/cli/src/commands/feedback.ts",
        redactionApplied: false,
      },
    ]);

    const issue = readFileSync(issuePath, "utf-8");
    expect(issue).toContain("# Feedback: feedback-2026-05-18T10-00-00-000Z");
    expect(issue).not.toContain("sk-ant-secret123");
    expect(consoleLog.mock.calls.map((call) => call.join(" ")).join("\n")).toContain("Local feedback bundle:");
  });

  it("fails closed when required reporter fields are missing", async () => {
    const root = createTempRoot();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as never);

    await expect(feedbackCommand({} as never, "draft", [
      "--project",
      root,
      "--session",
      "session-123",
      "--description",
      "Something failed.",
    ])).rejects.toThrow("process.exit");

    expect(consoleError.mock.calls.map((call) => call.join(" ")).join("\n")).toContain("Missing required option: --actual");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("fails closed when the private feedback owner is redirected by a junction", async () => {
    const root = createTempRoot();
    const binding = resolveProjectStateBinding(root);
    const outside = join(root, "redirect-target");
    mkdirSync(outside, { recursive: true });
    mkdirSync(binding.projectStateRoot, { recursive: true });
    try {
      symlinkSync(outside, binding.feedbackPath, "junction");
    } catch {
      return;
    }

    await expect(feedbackCommand({} as never, "draft", [
      "--project",
      root,
      "--session",
      "session-123",
      "--description",
      "Something failed.",
      "--actual",
      "The command failed.",
    ])).rejects.toThrow(/unsafe/iu);
    expect(readdirSync(outside)).toHaveLength(0);
  });

  it("fails closed when an option value is missing", async () => {
    const root = createTempRoot();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as never);

    await expect(feedbackCommand({} as never, "draft", [
      "--project",
      root,
      "--session",
      "--description",
      "Something failed.",
      "--actual",
      "The command failed.",
    ])).rejects.toThrow("process.exit");

    expect(consoleError.mock.calls.map((call) => call.join(" ")).join("\n")).toContain("Missing value for option: --session");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("allows reporter text that starts with an option prefix", async () => {
    const root = createTempRoot();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await feedbackCommand({} as never, "draft", [
      "--project",
      root,
      "--session",
      "session-123",
      "--description",
      "--leading text is valid feedback",
      "--actual",
      "--leading actual output",
      "--created-at",
      "2026-05-18T10:00:00.000Z",
    ]);

    const bundlePath = join(
      resolveProjectStateBinding(root).projectStateRoot,
      "feedback",
      "feedback-2026-05-18T10-00-00-000Z.json",
    );
    const bundle = JSON.parse(readFileSync(bundlePath, "utf-8")) as {
      readonly report: { readonly description: string; readonly actualBehavior: string };
    };
    expect(bundle.report.description).toBe("--leading text is valid feedback");
    expect(bundle.report.actualBehavior).toBe("--leading actual output");
  });

  it("prints draft help without requiring reporter fields", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await feedbackCommand({} as never, "draft", ["--help"]);

    expect(consoleLog.mock.calls.map((call) => call.join(" ")).join("\n")).toContain("Usage: kiln feedback draft [options]");
  });
});

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "kiln-feedback-command-"));
  mkdirSync(join(root, ".git"));
  tempRoots.push(root);
  return root;
}
