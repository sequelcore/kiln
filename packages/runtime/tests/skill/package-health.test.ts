import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectSkillPackage } from "../../src/skill/package-health.js";

describe("skill package health", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("reports complete package evidence and resolves local Markdown resources", () => {
    const root = packageRoot();
    mkdirSync(join(root, "references"));
    writeFileSync(join(root, "references", "guide.md"), "# Guide\n", "utf8");
    writeFileSync(join(root, "SKILL.md"), skill("Read [the guide](references/guide.md)."), "utf8");

    expect(inspectSkillPackage(root)).toMatchObject({
      status: "healthy",
      fileCount: 2,
      brokenResources: [],
      riskSignals: [],
      version: "1.0.0",
      compatibility: "Agent Skills compatible host",
    });
  });

  it("fails closed for broken, escaping, and oversized resources", () => {
    const root = packageRoot();
    writeFileSync(join(root, "large.txt"), "x".repeat(513), "utf8");
    writeFileSync(
      join(root, "SKILL.md"),
      skill("Use [missing](references/missing.md) and [outside](../secret.md)."),
      "utf8",
    );

    const health = inspectSkillPackage(root, { maxFileBytes: 512, maxPackageBytes: 2_048 });
    expect(health.status).toBe("blocked");
    expect(health.brokenResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "missing" }),
        expect.objectContaining({ reason: "outside-package" }),
      ]),
    );
    expect(health.diagnostics).toContainEqual(expect.objectContaining({ code: "oversized-file" }));
  });

  it("blocks Windows drive and UNC resources on every host platform", () => {
    const root = packageRoot();
    writeFileSync(
      join(root, "SKILL.md"),
      skill("Read [drive](C:\\secrets\\guide.md) and [share](\\\\server\\share\\guide.md)."),
      "utf8",
    );

    expect(inspectSkillPackage(root).brokenResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: "C:\\secrets\\guide.md", reason: "outside-package" }),
        expect.objectContaining({ target: "\\\\server\\share\\guide.md", reason: "outside-package" }),
      ]),
    );
  });

  it("classifies executable, network, secret, and broad filesystem risk signals", () => {
    const root = packageRoot();
    mkdirSync(join(root, "scripts"));
    writeFileSync(
      join(root, "scripts", "run.sh"),
      "curl https://example.invalid -H 'Authorization: Bearer token'\ncat ../../private\n",
      "utf8",
    );
    writeFileSync(join(root, "SKILL.md"), skill("Run `scripts/run.sh`."), "utf8");

    expect(inspectSkillPackage(root).riskSignals.map((signal) => signal.kind)).toEqual(
      expect.arrayContaining(["code-execution", "network-access", "credential-pattern", "outside-filesystem-access"]),
    );
  });

  it("blocks non-portable skill identities", () => {
    const root = packageRoot();
    writeFileSync(
      join(root, "SKILL.md"),
      "---\nname: NonPortable\ndescription: Valid description\n---\n\nBody.\n",
      "utf8",
    );
    expect(inspectSkillPackage(root)).toMatchObject({
      status: "blocked",
      diagnostics: [expect.objectContaining({ code: "portable-spec-invalid" })],
    });
  });

  function packageRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "kiln-skill-health-"));
    roots.push(root);
    return root;
  }
});

function skill(body: string): string {
  return `---\nname: healthy-skill\ndescription: Validates complete skill packages. Use before governed admission.\nlicense: Apache-2.0\ncompatibility: Agent Skills compatible host\nmetadata:\n  version: "1.0.0"\n---\n\n${body}\n`;
}
