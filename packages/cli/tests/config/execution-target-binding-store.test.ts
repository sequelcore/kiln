import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  executionTargetBindingPath,
  publishExecutionTargetBinding,
  readExecutionTargetBinding,
} from "../../src/config/execution-target-binding-store.js";
import { writeExecutionTargetEvidenceSnapshot } from "../../src/config/execution-target-evidence-store.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const intent = { accounts: [], accountPolicies: [], targets: [] };

describe("target evidence bindings", () => {
  it("requires an exact binding even when immutable evidence exists", () => {
    const root = mkdtempSync(join(tmpdir(), "target-binding-"));
    roots.push(root);
    const path = join(root, "config.yaml");
    const published = writeExecutionTargetEvidenceSnapshot({
      globalConfigPath: path,
      snapshot: { version: 1, accounts: [], targets: [] },
    });
    expect(() => readExecutionTargetBinding(path, intent)).toThrow();
    publishExecutionTargetBinding(path, intent, published.revision);
    expect(readExecutionTargetBinding(path, intent).evidenceRevision).toBe(published.revision);
    expect(readExecutionTargetBinding(path, { targets: [], accounts: [], accountPolicies: [] }).evidenceRevision).toBe(
      published.revision,
    );
    publishExecutionTargetBinding(path, intent, published.revision);
  });

  it("rejects altered and misbound records without selecting another snapshot", () => {
    const root = mkdtempSync(join(tmpdir(), "target-binding-"));
    roots.push(root);
    const path = join(root, "config.yaml");
    const published = writeExecutionTargetEvidenceSnapshot({
      globalConfigPath: path,
      snapshot: { version: 1, accounts: [], targets: [] },
    });
    publishExecutionTargetBinding(path, intent, published.revision);
    const bindingPath = executionTargetBindingPath(path, intent);
    const original = JSON.parse(readFileSync(bindingPath, "utf8"));
    for (const raw of [
      "{",
      JSON.stringify({ ...original, intentRevision: `sha256:${"f".repeat(64)}` }),
      JSON.stringify({ ...original, evidenceRevision: "latest" }),
    ]) {
      writeFileSync(bindingPath, raw);
      expect(() => readExecutionTargetBinding(path, intent)).toThrow();
    }
  });
});
