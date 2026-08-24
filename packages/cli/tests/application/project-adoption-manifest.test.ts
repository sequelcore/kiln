import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bootstrapProjectAdoption,
  captureProjectStateSourceDigests,
  type ProjectAdoptionManifest,
  readProjectAdoption,
  serializeProjectAdoptionManifest,
} from "../../src/application/project-adoption-manifest.js";
import { type ProjectStateBinding, resolveProjectStateBinding } from "../../src/application/project-state-root.js";

const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

describe("project adoption manifest", () => {
  it("captures stable private source digests while adoption remains identity-only", () => {
    const root = createProject("stable");
    const binding = resolveProjectStateBinding(root, { kilnHome: join(root, "kiln-home") });
    createPrivateSources(binding);
    const first = captureProjectStateSourceDigests(binding);
    writeFileSync(join(binding.agentsPath, "AGENTS.md"), "# Agents\n", "utf8");
    const second = captureProjectStateSourceDigests(binding);
    expect(second).toEqual(first);

    const result = bootstrapProjectAdoption(binding);
    const serialized = serializeProjectAdoptionManifest(result.manifest);
    expect(result.adoptionRevision).toBe(
      `sha256:${createHash("sha256").update(readFileSync(binding.adoptionManifestPath)).digest("hex")}`,
    );
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain("timestamp");
    expect(serialized).not.toContain("revision");
    expect(serialized).toMatch(/^\{"version":1,"projectRuntimeId":"krp_[a-f0-9]{64}"\}\n$/u);
    expect(readProjectAdoption(binding).status).toBe("adopted");
  });

  it("rejects a copied manifest whose identity does not match its private state root", () => {
    const sourceRoot = createProject("copied-source");
    const destinationRoot = createProject("copied-destination");
    const sourceBinding = resolveProjectStateBinding(sourceRoot, { kilnHome: join(sourceRoot, "kiln-home") });
    const destinationBinding = resolveProjectStateBinding(destinationRoot, {
      kilnHome: join(destinationRoot, "kiln-home"),
    });
    createPrivateSources(sourceBinding);
    const sourceManifest = bootstrapProjectAdoption(sourceBinding);
    mkdirSync(destinationBinding.projectStateRoot, { recursive: true });
    writeFileSync(
      destinationBinding.adoptionManifestPath,
      serializeProjectAdoptionManifest(sourceManifest.manifest),
      "utf8",
    );

    expect(readProjectAdoption(destinationBinding)).toEqual({ status: "unadopted", reason: "copied" });
  });

  it("rejects malformed and non-canonical manifests instead of normalizing them", () => {
    const root = createProject("malformed");
    const binding = resolveProjectStateBinding(root, { kilnHome: join(root, "kiln-home") });
    mkdirSync(binding.projectStateRoot, { recursive: true });

    writeFileSync(binding.adoptionManifestPath, "{}\n", "utf8");
    expect(readProjectAdoption(binding)).toEqual({ status: "unadopted", reason: "malformed" });

    const nonCanonical: ProjectAdoptionManifest = {
      version: 1,
      projectRuntimeId: binding.projectRuntimeId,
    };
    writeFileSync(
      binding.adoptionManifestPath,
      `${JSON.stringify({ projectRuntimeId: nonCanonical.projectRuntimeId, version: 1 })}\n`,
      "utf8",
    );
    expect(readProjectAdoption(binding)).toEqual({ status: "unadopted", reason: "non-canonical" });
  });

  it("leaves source drift to the runtime state revision and rejects unsafe source capture", () => {
    const root = createProject("source-change");
    const binding = resolveProjectStateBinding(root, { kilnHome: join(root, "kiln-home") });
    createPrivateSources(binding);
    const before = captureProjectStateSourceDigests(binding);
    bootstrapProjectAdoption(binding);
    writeFileSync(binding.configPath, "version: 2\n", "utf8");
    expect(readProjectAdoption(binding).status).toBe("adopted");
    expect(captureProjectStateSourceDigests(binding)).not.toEqual(before);

    const unsafeRoot = createProject("unsafe-link");
    const unsafeBinding = resolveProjectStateBinding(unsafeRoot, { kilnHome: join(unsafeRoot, "kiln-home") });
    createPrivateSources(unsafeBinding);
    bootstrapProjectAdoption(unsafeBinding);
    const external = join(unsafeRoot, "external-agents");
    mkdirSync(external, { recursive: true });
    try {
      rmSync(unsafeBinding.agentsPath, { recursive: true, force: true });
      symlinkSync(external, unsafeBinding.agentsPath, "junction");
    } catch {
      return;
    }
    expect(() => captureProjectStateSourceDigests(unsafeBinding)).toThrow();
  });
});

function createProject(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `kiln-adoption-${label}-`));
  fixtures.push(root);
  return root;
}

function createPrivateSources(binding: ProjectStateBinding): void {
  mkdirSync(binding.projectStateRoot, { recursive: true });
  mkdirSync(binding.agentsPath, { recursive: true });
  mkdirSync(binding.instructionsPath, { recursive: true });
  mkdirSync(binding.skillsPath, { recursive: true });
  writeFileSync(binding.configPath, "version: 1\n", "utf8");
  writeFileSync(binding.contextPath, "# Context\n", "utf8");
  writeFileSync(join(binding.agentsPath, "AGENTS.md"), "# Agents\n", "utf8");
  writeFileSync(join(binding.instructionsPath, "README.md"), "# Instructions\n", "utf8");
  writeFileSync(join(binding.skillsPath, "README.md"), "# Skills\n", "utf8");
}
