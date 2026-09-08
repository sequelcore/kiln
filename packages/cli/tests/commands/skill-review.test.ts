import type { KilnSkillSourceCandidateSnapshot } from "@kilnai/gateway-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInterface } from "node:readline/promises";
import { readGlobalConfig } from "../../src/config/global-config.js";
import { readGlobalExternalSkillInventory } from "../../src/config/skill-catalog-status.js";
import { writeExternalSkillApproval } from "../../src/config/external-skill-approval-store.js";
import { reviewExternalSkill } from "../../src/commands/skill-review.js";

vi.mock("node:readline/promises", () => ({ createInterface: vi.fn() }));
vi.mock("../../src/config/global-config.js", () => ({ readGlobalConfig: vi.fn() }));
vi.mock("../../src/config/skill-catalog-status.js", () => ({ readGlobalExternalSkillInventory: vi.fn() }));
vi.mock("../../src/config/external-skill-approval-store.js", () => ({ writeExternalSkillApproval: vi.fn() }));

describe("external skill review", () => {
  const question = vi.fn();
  const close = vi.fn();
  const candidate: KilnSkillSourceCandidateSnapshot = {
    sourceId: "plugin:one",
    name: "one",
    relationship: "external",
    applicableHarnesses: ["codex"],
    exposureScope: "user",
    effectiveVisibility: "implicit",
    packageDigest: `sha256:${"a".repeat(64)}`,
    canonicalName: "one", sourceKind: "plugin", sourcePath: "one/SKILL.md", descriptionBytes: 3,
    trust: { level: "external-unverified", reason: "external" },
    freshness: { status: "current", reason: "current" },
    dependencies: { allowedTools: [], executableResources: 0 },
    health: { status: "healthy", fileCount: 1, packageBytes: 20, brokenResourceCount: 0, riskSignals: [], diagnostics: [] },
  };
  const snapshot = (items = [candidate], complete = true) => ({
    inventory: { complete, candidates: items, sources: [], identities: [], resolutions: [], harnesses: [], diagnostics: [] },
    absolutePathBySourceId: new Map(),
  });
  const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
    vi.mocked(readGlobalConfig).mockReturnValue({
      version: "7",
      skills: { externalCatalog: { version: 2, harnesses: { codex: { keepImplicit: [{ sourceId: candidate.sourceId }] } } } },
    });
    vi.mocked(readGlobalExternalSkillInventory).mockImplementation((options) => {
      options.onCandidateResolved?.(candidate.sourceId, "/one/SKILL.md", [
        { path: "SKILL.md", content: Buffer.from("Reviewed content\n") },
      ]);
      return snapshot();
    });
    question.mockResolvedValue("y");
    vi.mocked(createInterface).mockReturnValue({ question, close } as unknown as ReturnType<typeof createInterface>);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    if (stdinTTY) Object.defineProperty(process.stdin, "isTTY", stdinTTY);
    else Reflect.deleteProperty(process.stdin, "isTTY");
    if (stdoutTTY) Object.defineProperty(process.stdout, "isTTY", stdoutTTY);
    else Reflect.deleteProperty(process.stdout, "isTTY");
  });

  it("lists sources without creating approval", async () => {
    await reviewExternalSkill(undefined);
    expect(console.log).toHaveBeenCalledWith("one\n  plugin:one");
    expect(writeExternalSkillApproval).not.toHaveBeenCalled();
  });
  it("records only the inspected digest after confirmation and rechecking", async () => {
    await reviewExternalSkill("one");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Reviewed content\n"));
    expect(readGlobalExternalSkillInventory).toHaveBeenCalledTimes(2);
    expect(writeExternalSkillApproval).toHaveBeenCalledWith({
      version: 1,
      harness: "codex",
      sourceId: candidate.sourceId,
      packageDigest: candidate.packageDigest,
    });
    expect(close).toHaveBeenCalled();
  });
  it("does not approve when the operator declines", async () => {
    question.mockResolvedValue("n");
    await reviewExternalSkill("one");
    expect(writeExternalSkillApproval).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
  it("does not approve in a noninteractive process", async () => {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
    await expect(reviewExternalSkill("one")).rejects.toThrow("interactive terminal");
    expect(writeExternalSkillApproval).not.toHaveBeenCalled();
  });
  it("rejects contents changed while the operator was reading", async () => {
    question.mockImplementation(async () => {
      vi.mocked(readGlobalExternalSkillInventory).mockReturnValueOnce(
        snapshot([{ ...candidate, packageDigest: `sha256:${"b".repeat(64)}` }]) as ReturnType<
          typeof readGlobalExternalSkillInventory
        >,
      );
      return "y";
    });
    await expect(reviewExternalSkill("one")).rejects.toThrow("changed during review");
    expect(writeExternalSkillApproval).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
  it("rejects unselected, ambiguous, and incompletely discovered sources", async () => {
    vi.mocked(readGlobalConfig).mockReturnValue(null);
    await expect(reviewExternalSkill("one")).rejects.toThrow("Select plugin:one");
    vi.mocked(readGlobalExternalSkillInventory).mockReturnValueOnce(
      snapshot([candidate, { ...candidate, sourceId: "other:one" }]) as ReturnType<
        typeof readGlobalExternalSkillInventory
      >,
    );
    await expect(reviewExternalSkill("one")).rejects.toThrow("ambiguous");
    vi.mocked(readGlobalExternalSkillInventory).mockReturnValueOnce(
      snapshot([], false),
    );
    await expect(reviewExternalSkill("one")).rejects.toThrow("incomplete");
    expect(writeExternalSkillApproval).not.toHaveBeenCalled();
  });
});
