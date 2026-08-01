import { describe, it, expect } from "vitest";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import {
  ROLE_PRESETS,
  SandboxPolicy,
  createPolicy,
} from "../../src/sandbox/policies.js";

const PROJECT = resolve(join(tmpdir(), "kiln-test-project"));

describe("SandboxPolicy", () => {
  // 1. Architect: can read
  it("architect preset allows reading", () => {
    const policy = createPolicy("architect", PROJECT);
    expect(policy.canRead(join(PROJECT, "src/index.ts"))).toBe(true);
  });

  // 2. Architect: cannot write
  it("architect preset denies writing", () => {
    const policy = createPolicy("architect", PROJECT);
    expect(policy.canWrite(join(PROJECT, "src/index.ts"))).toBe(false);
  });

  // 3. Worker: can read within project
  it("worker preset allows reading within project", () => {
    const policy = createPolicy("worker", PROJECT);
    expect(policy.canRead(join(PROJECT, "src/main.ts"))).toBe(true);
  });

  // 4. Worker: can write within project
  it("worker preset allows writing within project", () => {
    const policy = createPolicy("worker", PROJECT);
    expect(policy.canWrite(join(PROJECT, "src/main.ts"))).toBe(true);
  });

  // 5. Worker: cannot write outside project
  it("worker preset denies writing outside project", () => {
    const policy = createPolicy("worker", PROJECT);
    const outside = resolve(join(tmpdir(), "other-project", "file.ts"));
    expect(policy.canWrite(outside)).toBe(false);
  });

  it("does not treat a sibling path with the same prefix as inside the project", () => {
    const policy = createPolicy("worker", PROJECT);

    expect(policy.canRead(`${PROJECT}-escape/file.ts`)).toBe(false);
    expect(policy.canWrite(`${PROJECT}-escape/file.ts`)).toBe(false);
  });

  it("does not apply a denied directory to a sibling with the same prefix", () => {
    const policy = createPolicy("worker", PROJECT, {
      deniedPaths: [join(PROJECT, "secret")],
    });

    expect(policy.canWrite(join(PROJECT, "secret", "key.txt"))).toBe(false);
    expect(policy.canWrite(join(PROJECT, "secret-safe", "notes.txt"))).toBe(true);
  });

  // 6. Worker: cannot write to denied path
  it("worker preset denies writing to denied paths", () => {
    const policy = createPolicy("worker", PROJECT);
    expect(policy.canWrite("/etc/passwd")).toBe(false);
  });

  // 7. Optimizer: can read, cannot write
  it("optimizer preset allows reading but denies writing", () => {
    const policy = createPolicy("optimizer", PROJECT);
    expect(policy.canRead(join(PROJECT, "src/index.ts"))).toBe(true);
    expect(policy.canWrite(join(PROJECT, "src/index.ts"))).toBe(false);
  });

  // 8. Optimizer: no network access
  it("optimizer preset denies all network access", () => {
    const policy = createPolicy("optimizer", PROJECT);
    expect(policy.canAccess("registry.npmjs.org")).toBe(false);
    expect(policy.canAccess("example.com")).toBe(false);
  });

  // 9. Researcher: can read, full network
  it("researcher preset allows reading and full network", () => {
    const policy = createPolicy("researcher", PROJECT);
    expect(policy.canRead(join(PROJECT, "data.csv"))).toBe(true);
    expect(policy.canAccess("any-domain.example.com")).toBe(true);
  });

  // 10. Worker: canAccess allows package manager domains
  it("worker preset allows package manager domains", () => {
    const policy = createPolicy("worker", PROJECT);
    expect(policy.canAccess("registry.npmjs.org")).toBe(true);
    expect(policy.canAccess("pypi.org")).toBe(true);
    expect(policy.canAccess("proxy.golang.org")).toBe(true);
  });

  // 11. Worker: canAccess blocks non-allowed domains
  it("worker preset blocks non-allowed domains", () => {
    const policy = createPolicy("worker", PROJECT);
    expect(policy.canAccess("evil.com")).toBe(false);
    expect(policy.canAccess("example.org")).toBe(false);
  });

  // 12. createPolicy merges overrides
  it("createPolicy merges overrides with preset", () => {
    const policy = createPolicy("architect", PROJECT, {
      fsPolicy: "read-write",
      netPolicy: "none",
    });
    expect(policy.config.fsPolicy).toBe("read-write");
    expect(policy.config.netPolicy).toBe("none");
    // Non-overridden fields stay from preset
    expect(policy.config.allowedDomains).toEqual(["*"]);
  });

  // 13. createPolicy falls back to worker for unknown role
  it("createPolicy falls back to worker for unknown role", () => {
    const policy = createPolicy("unknown-role", PROJECT);
    expect(policy.config.fsPolicy).toBe(
      ROLE_PRESETS["worker"]!.fsPolicy,
    );
    expect(policy.config.netPolicy).toBe(
      ROLE_PRESETS["worker"]!.netPolicy,
    );
    expect(policy.config.deniedPaths).toEqual(
      ROLE_PRESETS["worker"]!.deniedPaths,
    );
  });
});

describe("SandboxPolicy.toJSON", () => {
  it("serializes config and resolved paths", () => {
    const policy = createPolicy("worker", PROJECT);
    const json = policy.toJSON();
    expect(json.config).toEqual(policy.config);
    expect(json.projectPath).toBe(PROJECT);
    expect(json.resolvedAllowedPaths).toContain(resolve(PROJECT));
    expect(json.resolvedDeniedPaths.length).toBeGreaterThan(0);
  });
});
