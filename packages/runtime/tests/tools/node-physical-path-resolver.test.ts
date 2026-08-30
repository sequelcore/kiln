import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PathValidator, SandboxPolicy } from "@kilnai/core/sandbox";
import {
  NodePhysicalPathResolver,
  nodePhysicalPathResolver,
} from "../../src/tools/node-physical-path-resolver.js";

const linkType = process.platform === "win32" ? "junction" : "dir";

describe("NodePhysicalPathResolver", () => {
  it("canonicalizes existing targets and missing write targets from the nearest existing ancestor", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-physical-path-"));
    const workspace = join(root, "workspace");
    mkdirSync(workspace);
    writeFileSync(join(workspace, "inside.txt"), "inside");
    const resolver = new NodePhysicalPathResolver();

    try {
      expect(resolver.resolve(join(workspace, "inside.txt"))).toBe(join(workspace, "inside.txt"));
      expect(resolver.resolve(join(workspace, "new", "file.txt"))).toBe(join(workspace, "new", "file.txt"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves internal links while rejecting external, broken, and missing-target links", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-physical-path-"));
    const workspace = join(root, "workspace");
    const internal = join(workspace, "internal");
    const outside = join(root, "outside");
    const missing = join(root, "missing");
    mkdirSync(workspace);
    mkdirSync(internal, { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(internal, "inside.txt"), "inside");
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(internal, join(workspace, "internal-link"), linkType);
    symlinkSync(outside, join(workspace, "external-link"), linkType);
    symlinkSync(missing, join(workspace, "broken-link"), linkType);
    const resolver = nodePhysicalPathResolver;
    const policy = new SandboxPolicy({
      projectPath: workspace,
      config: {
        fsPolicy: "read-write",
        netPolicy: "none",
        allowedPaths: [workspace],
        deniedPaths: [],
        allowedDomains: [],
      },
    });
    const validator = new PathValidator({ policy, physicalPathResolver: resolver });

    try {
      expect(validator.validateRead(join(workspace, "internal-link", "inside.txt"))).toEqual({ allowed: true });
      expect(validator.validateWrite(join(workspace, "internal-link", "new.txt"))).toEqual({ allowed: true });
      expect(validator.validateRead(join(workspace, "external-link", "secret.txt"))).toMatchObject({ allowed: false });
      expect(validator.validateWrite(join(workspace, "external-link", "new.txt"))).toMatchObject({ allowed: false });
      expect(validator.validateRead(join(workspace, "broken-link", "secret.txt"))).toMatchObject({ allowed: false });
      expect(validator.validateWrite(join(workspace, "broken-link", "new.txt"))).toMatchObject({ allowed: false });
      expect(resolver.resolve(join(workspace, "broken-link"))).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
