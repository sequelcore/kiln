import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodePhysicalPathResolver } from "@kilnai/runtime";
import { describe, expect, it } from "vitest";
import { evaluateWorkspaceFileAdmission } from "../../src/config/workspace-file-admission.js";
import { createPermissionEvaluator } from "../../src/wrapper/permission-evaluator.js";

const linkType = process.platform === "win32" ? "junction" : "dir";

describe("workspace file admission", () => {
  it("matches an absolute grant when the tool supplies a relative path", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-workspace-file-admission-"));
    const workspace = join(root, "workspace");
    const source = join(workspace, "src", "allowed.ts");
    mkdirSync(join(workspace, "src"), { recursive: true });
    writeFileSync(source, "export {};\n");

    try {
      const result = admit({
        workspace,
        filePath: "src/allowed.ts",
        allowGlobs: [`${join(workspace, "src")}/*`],
      });

      expect(result).toMatchObject({ kind: "decision", decision: { action: "allow" } });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps an unmatched concrete file at the policy approval default", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-workspace-file-admission-"));
    const workspace = join(root, "workspace");
    mkdirSync(workspace);
    writeFileSync(join(workspace, "src.ts"), "export {};\n");

    try {
      const result = admit({ workspace, filePath: "src.ts" });

      expect(result).toMatchObject({ kind: "decision", decision: { action: "ask", source: "default" } });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves a deny matched through a dot-dot escape", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-workspace-file-admission-"));
    const workspace = join(root, "workspace");
    const outside = join(root, "outside");
    mkdirSync(workspace);
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.ts"), "secret\n");

    try {
      const result = admit({
        workspace,
        filePath: "../outside/secret.ts",
        denyGlobs: [`${outside}/*`],
        allowGlobs: [`${workspace}/*`],
      });

      expect(result).toMatchObject({ kind: "decision", decision: { action: "deny", source: "file-governance.deny" } });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves a relative deny that only matches the normalized input spelling", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-workspace-file-admission-"));
    const workspace = join(root, "workspace");
    mkdirSync(join(workspace, "secrets"), { recursive: true });
    writeFileSync(join(workspace, "secrets", "config.ts"), "secret\n");

    try {
      const result = admit({
        workspace,
        filePath: "src/../secrets/config.ts",
        denyGlobs: ["secrets/*"],
      });

      expect(result).toMatchObject({ kind: "decision", decision: { action: "deny", source: "file-governance.deny" } });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves an ask matched through a symlink even when its lexical alias is allowed", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-workspace-file-admission-"));
    const workspace = join(root, "workspace");
    const outside = join(root, "outside");
    mkdirSync(workspace);
    mkdirSync(outside);
    writeFileSync(join(outside, "review.ts"), "review\n");
    symlinkSync(outside, join(workspace, "linked"), linkType);

    try {
      const result = admit({
        workspace,
        filePath: "linked/review.ts",
        allowGlobs: [`${join(workspace, "linked")}/*`],
        askGlobs: [`${outside}/*`],
      });

      expect(result).toMatchObject({ kind: "decision", decision: { action: "ask", source: "file-governance.ask" } });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("requires an independently granted physical target when a symlink changes the target", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-workspace-file-admission-"));
    const workspace = join(root, "workspace");
    const sibling = join(workspace, "sibling");
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, "target.ts"), "target\n");
    symlinkSync(sibling, join(workspace, "linked"), linkType);

    try {
      const lexicalOnly = admit({
        workspace,
        filePath: "linked/target.ts",
        allowGlobs: [`${join(workspace, "linked")}/*`],
      });
      expect(lexicalOnly).toMatchObject({ kind: "decision", decision: { action: "ask", source: "default" } });

      const physicallyGranted = admit({
        workspace,
        filePath: "linked/target.ts",
        allowGlobs: [
          `${join(workspace, "linked")}/*`,
          `${join(workspace, "sibling")}/*`,
        ],
      });
      expect(physicallyGranted).toMatchObject({ kind: "decision", decision: { action: "allow" } });

      const physicalOnly = admit({
        workspace,
        filePath: "linked/target.ts",
        allowGlobs: [`${join(workspace, "sibling")}/*`],
      });
      expect(physicalOnly).toMatchObject({ kind: "decision", decision: { action: "ask", source: "default" } });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed without an authoritative absolute execution workspace", () => {
    const result = evaluateWorkspaceFileAdmission({
      evaluator: createPermissionEvaluator({ approval: "on-request" }),
      physicalPathResolver: nodePhysicalPathResolver,
      workingDirectory: undefined,
      filePath: "src.ts",
    });

    expect(result).toEqual({
      kind: "denied",
      reason: "Configured file admission requires an absolute execution workspace.",
    });
  });
});

function admit(input: {
  readonly workspace: string;
  readonly filePath: string;
  readonly allowGlobs?: readonly string[];
  readonly askGlobs?: readonly string[];
  readonly denyGlobs?: readonly string[];
}) {
  return evaluateWorkspaceFileAdmission({
    evaluator: createPermissionEvaluator({
      approval: "on-request",
      fileGovernance: {
        ...(input.allowGlobs ? { allowGlobs: input.allowGlobs } : {}),
        ...(input.askGlobs ? { askGlobs: input.askGlobs } : {}),
        ...(input.denyGlobs ? { denyGlobs: input.denyGlobs } : {}),
      },
    }),
    physicalPathResolver: nodePhysicalPathResolver,
    workingDirectory: input.workspace,
    filePath: input.filePath,
  });
}
