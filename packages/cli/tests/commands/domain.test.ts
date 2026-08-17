import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { KilnAppConfig } from "../../src/config.js";

// Mock child_process.execFile to prevent real subprocess calls
vi.mock("node:child_process", () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
    cb(null, "", "");
  }),
}));

import { execFile } from "node:child_process";
import { domainCommand } from "../../src/commands/domain.js";

const mockExecFile = vi.mocked(execFile);

const VALID_DOMAIN_YAML = `
name: rust
displayName: Rust
detectPatterns:
  - Cargo.toml
  - Cargo.lock
toolTags:
  - rust
  - testing
qualityGates:
  - name: build
    command: cargo build
    description: Build Rust project
  - name: test
    command: cargo test
    description: Run Rust tests
version: "1.2.0"
author: "test-author"
skills:
  - cargo-check
`;

const VALID_DOMAIN_YAML_2 = `
name: elixir
displayName: Elixir
detectPatterns:
  - mix.exs
toolTags:
  - elixir
qualityGates:
  - name: test
    command: mix test
    description: Run Elixir tests
version: "0.5.0"
`;

const MOCK_APP_CONFIG: KilnAppConfig = {
  createRegistry: () => {
    throw new Error("createRegistry not called in domain tests");
  },
  buildSystemPrompt: () => "",
};

function mockExecSuccess(stdout = "", stderr = "") {
  mockExecFile.mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as Function)(null, stdout, stderr);
      return undefined as any;
    },
  );
}

function mockExecFailure(stderr = "error") {
  mockExecFile.mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      const err = Object.assign(new Error(stderr), { code: 1 });
      (cb as Function)(err, "", stderr);
      return undefined as any;
    },
  );
}

describe("domainCommand", () => {
  let tempDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-domain-"));
    mkdirSync(join(tempDir, ".kiln"), { recursive: true });
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExecSuccess();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.clearAllMocks();
  });

  function getOutput() {
    return logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
  }

  function getErrors() {
    return errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
  }

  // --- Help ---

  it("prints help when no subcommand given", async () => {
    await domainCommand(MOCK_APP_CONFIG, "", [], tempDir);
    const output = getOutput();
    expect(output).toContain("Usage: kiln domain");
    expect(output).toContain("install");
    expect(output).toContain("list");
    expect(output).toContain("search");
    expect(output).toContain("info");
    expect(output).toContain("remove");
  });

  it("prints help for unknown subcommand", async () => {
    await domainCommand(MOCK_APP_CONFIG, "foobar", [], tempDir);
    const output = getOutput();
    expect(output).toContain("Usage: kiln domain");
  });

  // --- List ---

  it("list prints 'no domains installed' when .kiln/domains does not exist", async () => {
    await domainCommand(MOCK_APP_CONFIG, "list", [], tempDir);
    expect(getOutput()).toContain("No domains installed.");
  });

  it("list prints 'no domains installed' when .kiln/domains is empty", async () => {
    mkdirSync(join(tempDir, ".kiln", "domains"), { recursive: true });
    await domainCommand(MOCK_APP_CONFIG, "list", [], tempDir);
    expect(getOutput()).toContain("No domains installed.");
  });

  it("list shows installed domains", async () => {
    const domainsDir = join(tempDir, ".kiln", "domains");
    mkdirSync(domainsDir, { recursive: true });
    writeFileSync(join(domainsDir, "rust.yaml"), VALID_DOMAIN_YAML);
    writeFileSync(join(domainsDir, "elixir.yaml"), VALID_DOMAIN_YAML_2);

    await domainCommand(MOCK_APP_CONFIG, "list", [], tempDir);
    const output = getOutput();
    expect(output).toContain("Rust");
    expect(output).toContain("1.2.0");
    expect(output).toContain("Cargo.toml");
    expect(output).toContain("Elixir");
    expect(output).toContain("mix.exs");
  });

  it("list skips invalid YAML files gracefully", async () => {
    const domainsDir = join(tempDir, ".kiln", "domains");
    mkdirSync(domainsDir, { recursive: true });
    writeFileSync(join(domainsDir, "broken.yaml"), "{}");
    writeFileSync(join(domainsDir, "rust.yaml"), VALID_DOMAIN_YAML);

    await domainCommand(MOCK_APP_CONFIG, "list", [], tempDir);
    const output = getOutput();
    expect(output).toContain("Warning: Could not parse broken.yaml");
    expect(output).toContain("Rust");
  });

  // --- Search ---

  it("search prints usage when no query given", async () => {
    await domainCommand(MOCK_APP_CONFIG, "search", [], tempDir);
    expect(getOutput()).toContain("Usage: domain search");
  });

  it("search displays results from npm", async () => {
    const body = {
      objects: [
        { package: { name: "@kilnai/domain-rust", description: "Rust domain", version: "1.0.0" } },
        { package: { name: "@kilnai/domain-rust-wasm", description: "Rust WASM domain", version: "0.2.0" } },
      ],
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => body,
    }) as unknown as typeof fetch;

    await domainCommand(MOCK_APP_CONFIG, "search", ["rust"], tempDir);
    globalThis.fetch = originalFetch;

    const output = getOutput();
    expect(output).toContain("@kilnai/domain-rust");
    expect(output).toContain("Rust domain");
    expect(output).toContain("1.0.0");
    expect(output).toContain("@kilnai/domain-rust-wasm");
  });

  it("search shows 'no packages found' for empty results", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ objects: [] }),
    }) as unknown as typeof fetch;

    await domainCommand(MOCK_APP_CONFIG, "search", ["nonexistent"], tempDir);
    globalThis.fetch = originalFetch;

    expect(getOutput()).toContain("No packages found.");
  });

  it("search handles npm failure", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error")) as unknown as typeof fetch;

    await domainCommand(MOCK_APP_CONFIG, "search", ["rust"], tempDir);
    globalThis.fetch = originalFetch;

    expect(getErrors()).toContain("Failed to reach npm registry.");
  });

  // --- Install ---

  it("install prints usage when no package given", async () => {
    await domainCommand(MOCK_APP_CONFIG, "install", [], tempDir);
    expect(getOutput()).toContain("Usage: kiln domain install");
  });

  it("install rejects non-scoped package names", async () => {
    await domainCommand(MOCK_APP_CONFIG, "install", ["invalid-pkg"], tempDir);
    expect(getErrors()).toContain("Invalid package name");
  });

  it("install succeeds with valid package", async () => {
    const pkgName = "@kiln-domains/rust";
    const pkgDir = join(tempDir, "node_modules", "@kiln-domains", "rust");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "domain.yaml"), VALID_DOMAIN_YAML);
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: pkgName }));

    mockExecSuccess();

    await domainCommand(MOCK_APP_CONFIG, "install", [pkgName], tempDir);
    const output = getOutput();
    expect(output).toContain("Installed Rust v1.2.0");
    expect(existsSync(join(tempDir, ".kiln", "domains", "rust.yaml"))).toBe(true);
  });

  it("install fails when bun add fails", async () => {
    mockExecFailure("not found");

    await domainCommand(MOCK_APP_CONFIG, "install", ["@kiln-domains/missing"], tempDir);
    expect(getErrors()).toContain("Failed to install");
  });

  it("install fails when no domain.yaml in package", async () => {
    const pkgDir = join(tempDir, "node_modules", "@kiln-domains", "empty");
    mkdirSync(pkgDir, { recursive: true });
    mockExecSuccess();

    await domainCommand(MOCK_APP_CONFIG, "install", ["@kiln-domains/empty"], tempDir);
    expect(getErrors()).toContain("No domain.yaml found");
  });

  it("install fails when security validation fails", async () => {
    const pkgName = "@kiln-domains/evil";
    const pkgDir = join(tempDir, "node_modules", "@kiln-domains", "evil");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "domain.yaml"), VALID_DOMAIN_YAML);
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: pkgName, scripts: { postinstall: "rm -rf /" } }),
    );

    mockExecSuccess();

    await domainCommand(MOCK_APP_CONFIG, "install", [pkgName], tempDir);
    expect(getErrors()).toContain("Security validation failed");
    expect(getErrors()).toContain("postinstall");
  });

  // --- Info ---

  it("info prints usage when no package given", async () => {
    await domainCommand(MOCK_APP_CONFIG, "info", [], tempDir);
    expect(getOutput()).toContain("Usage: kiln domain info");
  });

  it("info shows details for installed domain", async () => {
    const domainsDir = join(tempDir, ".kiln", "domains");
    mkdirSync(domainsDir, { recursive: true });
    writeFileSync(join(domainsDir, "rust.yaml"), VALID_DOMAIN_YAML);

    await domainCommand(MOCK_APP_CONFIG, "info", ["rust"], tempDir);
    const output = getOutput();
    expect(output).toContain("Rust");
    expect(output).toContain("1.2.0");
    expect(output).toContain("test-author");
    expect(output).toContain("Cargo.toml");
    expect(output).toContain("cargo-check");
    expect(output).toContain("build, test");
  });

  it("info falls back to node_modules when not in .kiln/domains", async () => {
    const pkgDir = join(tempDir, "node_modules", "@kiln-domains", "rust");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "domain.yaml"), VALID_DOMAIN_YAML);

    await domainCommand(MOCK_APP_CONFIG, "info", ["@kiln-domains/rust"], tempDir);
    const output = getOutput();
    expect(output).toContain("Rust");
    expect(output).toContain("1.2.0");
  });

  it("info shows 'not found' for unknown package", async () => {
    await domainCommand(MOCK_APP_CONFIG, "info", ["nonexistent"], tempDir);
    expect(getOutput()).toContain('Domain "nonexistent" not found.');
  });

  // --- Remove ---

  it("remove prints usage when no package given", async () => {
    await domainCommand(MOCK_APP_CONFIG, "remove", [], tempDir);
    expect(getOutput()).toContain("Usage: kiln domain remove");
  });

  it("remove deletes domain YAML and runs bun remove", async () => {
    const domainsDir = join(tempDir, ".kiln", "domains");
    mkdirSync(domainsDir, { recursive: true });
    writeFileSync(join(domainsDir, "rust.yaml"), VALID_DOMAIN_YAML);

    mockExecSuccess();

    await domainCommand(MOCK_APP_CONFIG, "remove", ["rust"], tempDir);
    const output = getOutput();
    expect(output).toContain("Removed Rust");
    expect(existsSync(join(domainsDir, "rust.yaml"))).toBe(false);
  });

  it("remove shows 'not found' for unknown package", async () => {
    mockExecSuccess();

    await domainCommand(MOCK_APP_CONFIG, "remove", ["nonexistent"], tempDir);
    expect(getOutput()).toContain('Domain "nonexistent" not found.');
  });
});
