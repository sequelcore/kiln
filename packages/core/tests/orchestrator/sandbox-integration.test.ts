import { describe, it, expect } from "vitest";
import { Orchestrator } from "../../src/orchestrator/orchestrator.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Orchestrator sandbox integration", () => {
  const projectPath = join(tmpdir(), "test-project");

  it("sandboxEnabled returns false before initSandbox", () => {
    const orch = new Orchestrator();
    expect(orch.sandboxEnabled).toBe(false);
  });

  it("initSandbox creates policies for architect, worker, optimizer", () => {
    const orch = new Orchestrator();
    orch.initSandbox(projectPath);

    expect(orch.getSandboxPolicy("architect")).toBeDefined();
    expect(orch.getSandboxPolicy("worker")).toBeDefined();
    expect(orch.getSandboxPolicy("optimizer")).toBeDefined();
  });

  it("sandboxEnabled returns true after initSandbox", () => {
    const orch = new Orchestrator();
    orch.initSandbox(projectPath);
    expect(orch.sandboxEnabled).toBe(true);
  });

  it("getSandboxPolicy returns correct policy for each role", () => {
    const orch = new Orchestrator();
    orch.initSandbox(projectPath);

    const architect = orch.getSandboxPolicy("architect")!;
    expect(architect.config.fsPolicy).toBe("read-only");

    const worker = orch.getSandboxPolicy("worker")!;
    expect(worker.config.fsPolicy).toBe("read-write");

    const optimizer = orch.getSandboxPolicy("optimizer")!;
    expect(optimizer.config.fsPolicy).toBe("read-only");
    expect(optimizer.config.netPolicy).toBe("none");
  });

  it("worker policy allows write within project directory", () => {
    const orch = new Orchestrator();
    orch.initSandbox(projectPath);

    const worker = orch.getSandboxPolicy("worker")!;
    expect(worker.canWrite(join(projectPath, "src", "index.ts"))).toBe(true);
  });

  it("architect policy blocks write (read-only)", () => {
    const orch = new Orchestrator();
    orch.initSandbox(projectPath);

    const architect = orch.getSandboxPolicy("architect")!;
    expect(architect.canWrite(join(projectPath, "src", "index.ts"))).toBe(
      false,
    );
  });
});
