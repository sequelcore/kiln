import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFilesystemDomainRegistry } from "../../src/domain/filesystem-domain-registry.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("createFilesystemDomainRegistry", () => {
  it("loads installed YAML and detects it from project files", () => {
    const root = createTemporaryDirectory();
    const domainsDirectory = join(root, "domains");
    const projectDirectory = join(root, "project");
    mkdirSync(domainsDirectory);
    mkdirSync(projectDirectory);
    writeFileSync(join(domainsDirectory, "rust.yaml"), domainYaml("rust", "Cargo.toml"), "utf8");
    writeFileSync(join(projectDirectory, "Cargo.toml"), '[package]\nname = "fixture"\n', "utf8");

    const registry = createFilesystemDomainRegistry({ domainsDir: domainsDirectory });
    expect(registry.loadInstalledDomains()).toBe(1);
    expect(registry.detectAndMerge(projectDirectory).name).toBe("rust");
  });

  it("ignores missing directories, non-YAML files, invalid YAML, and duplicate names", () => {
    const root = createTemporaryDirectory();
    const domainsDirectory = join(root, "domains");
    mkdirSync(domainsDirectory);
    writeFileSync(join(domainsDirectory, "readme.md"), "ignored", "utf8");
    writeFileSync(join(domainsDirectory, "invalid.yaml"), "name: invalid", "utf8");
    writeFileSync(join(domainsDirectory, "first.yaml"), domainYaml("rust", "Cargo.toml"), "utf8");
    writeFileSync(join(domainsDirectory, "duplicate.yml"), domainYaml("rust", "Cargo.lock"), "utf8");

    expect(createFilesystemDomainRegistry({ domainsDir: join(root, "missing") }).loadInstalledDomains()).toBe(0);
    const registry = createFilesystemDomainRegistry({ domainsDir: domainsDirectory });
    expect(registry.loadInstalledDomains()).toBe(1);
    expect(registry.all().map((domain) => domain.name)).toEqual(["rust"]);
  });
});

function createTemporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "kiln-domains-"));
  temporaryDirectories.push(path);
  return path;
}

function domainYaml(name: string, detectPattern: string): string {
  return [
    `name: ${name}`,
    `displayName: ${name}`,
    "detectPatterns:",
    `  - ${detectPattern}`,
    "toolTags:",
    `  - ${name}`,
    "qualityGates: []",
    "",
  ].join("\n");
}
