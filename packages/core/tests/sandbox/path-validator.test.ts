import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { createPolicy } from "../../src/sandbox/policies.js";
import { PathValidator, isSubPath } from "../../src/sandbox/path-validator.js";

const PROJECT = resolve("/tmp/test-project");

describe("PathValidator", () => {
  it("allows read within project for worker", () => {
    const policy = createPolicy("worker", PROJECT);
    const validator = new PathValidator({ policy });
    const result = validator.validateRead(`${PROJECT}/src/index.ts`);
    expect(result.allowed).toBe(true);
  });

  it("blocks read for none fsPolicy", () => {
    const policy = createPolicy("optimizer", PROJECT, { fsPolicy: "none" });
    const validator = new PathValidator({ policy });
    const result = validator.validateRead(`${PROJECT}/src/index.ts`);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Read access denied");
  });

  it("allows write within project for worker", () => {
    const policy = createPolicy("worker", PROJECT);
    const validator = new PathValidator({ policy });
    const result = validator.validateWrite(`${PROJECT}/src/new-file.ts`);
    expect(result.allowed).toBe(true);
  });

  it("blocks write outside project for worker", () => {
    const policy = createPolicy("worker", PROJECT);
    const validator = new PathValidator({ policy });
    const result = validator.validateWrite("/other/directory/file.ts");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Write access denied");
  });

  it("blocks write for read-only policy (architect)", () => {
    const policy = createPolicy("architect", PROJECT);
    const validator = new PathValidator({ policy });
    const result = validator.validateWrite(`${PROJECT}/src/index.ts`);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Write access denied");
  });

  it("blocks write to denied paths", () => {
    const policy = createPolicy("worker", PROJECT, {
      deniedPaths: [`${PROJECT}/secrets`],
    });
    const validator = new PathValidator({ policy });
    const result = validator.validateWrite(`${PROJECT}/secrets/key.pem`);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Write access denied");
  });

  it("blocks rm -rf /", () => {
    const policy = createPolicy("worker", PROJECT);
    const validator = new PathValidator({ policy });
    const result = validator.validateExecute("rm -rf /", PROJECT);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Dangerous command blocked");
  });

  it("blocks sudo commands", () => {
    const policy = createPolicy("worker", PROJECT);
    const validator = new PathValidator({ policy });
    const result = validator.validateExecute("sudo apt install foo", PROJECT);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Dangerous command blocked");
  });

  it("allows safe commands", () => {
    const policy = createPolicy("worker", PROJECT);
    const validator = new PathValidator({ policy });
    const result = validator.validateExecute("bun test", PROJECT);
    expect(result.allowed).toBe(true);
  });

  it("path normalization resolves ../", () => {
    const policy = createPolicy("worker", PROJECT);
    const validator = new PathValidator({ policy });
    const result = validator.validateRead(`${PROJECT}/src/../src/index.ts`);
    expect(result.allowed).toBe(true);
  });
});

describe("isSubPath", () => {
  it("returns true for child path", () => {
    expect(isSubPath(`${PROJECT}/src/index.ts`, PROJECT)).toBe(true);
  });

  it("returns false for unrelated path", () => {
    expect(isSubPath("/other/directory", PROJECT)).toBe(false);
  });
});
