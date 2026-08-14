import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  OPENCODE_NO_FILESYSTEM_SANDBOX,
  acceptTrustedExecutionSemanticLimitation,
  readTrustedExecutionSemanticLimitationAcceptance,
  revokeTrustedExecutionSemanticLimitation,
} from "../../src/security/trusted-execution-semantic-limitation.js";

const dirs: string[] = [];
function project(): string { const path = mkdtempSync(join(tmpdir(), "kiln-limitation-")); dirs.push(path); return path; }
afterEach(() => { for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("trusted execution semantic limitation acceptance", () => {
  it("accepts only exact current evidence and remains revocable", () => {
    const path = project();
    acceptTrustedExecutionSemanticLimitation({ projectPath: path, baseDir: path, descriptor: OPENCODE_NO_FILESYSTEM_SANDBOX, acceptedBy: "operator:test", acceptedAt: "2026-08-13T01:00:00.000Z", reviewAfter: "2026-11-13T00:00:00.000Z" });
    expect(readTrustedExecutionSemanticLimitationAcceptance(path, OPENCODE_NO_FILESYSTEM_SANDBOX, "2026-09-01T00:00:00.000Z", path)).toMatchObject({ revocable: true, acceptedBy: "operator:test" });
    expect(revokeTrustedExecutionSemanticLimitation({ projectPath: path, baseDir: path, descriptor: OPENCODE_NO_FILESYSTEM_SANDBOX, revokedBy: "operator:test", revokedAt: "2026-09-02T00:00:00.000Z" })).toBe(true);
    expect(readTrustedExecutionSemanticLimitationAcceptance(path, OPENCODE_NO_FILESYSTEM_SANDBOX, "2026-09-02T00:00:00.000Z", path)).toBeUndefined();
  });
  it("rejects expiration and mismatched upstream evidence", () => {
    const path = project();
    acceptTrustedExecutionSemanticLimitation({ projectPath: path, baseDir: path, descriptor: OPENCODE_NO_FILESYSTEM_SANDBOX, acceptedBy: "operator:test", acceptedAt: "2026-08-13T01:00:00.000Z", reviewAfter: "2026-11-13T00:00:00.000Z" });
    expect(readTrustedExecutionSemanticLimitationAcceptance(path, OPENCODE_NO_FILESYSTEM_SANDBOX, "2026-11-14T00:00:00.000Z", path)).toBeUndefined();
    expect(readTrustedExecutionSemanticLimitationAcceptance(path, { ...OPENCODE_NO_FILESYSTEM_SANDBOX, upstreamRevision: "a".repeat(40) }, "2026-09-01T00:00:00.000Z", path)).toBeUndefined();
  });
  it("does not persist an absolute project path in append-only receipts", () => {
    const path = project();
    acceptTrustedExecutionSemanticLimitation({ projectPath: path, baseDir: path, descriptor: OPENCODE_NO_FILESYSTEM_SANDBOX, acceptedBy: "operator:test", acceptedAt: "2026-08-13T01:00:00.000Z", reviewAfter: "2026-11-13T00:00:00.000Z" });
    const text = require("node:fs").readFileSync(require("node:fs").readdirSync(path).map((name: string) => join(path, name))[0], "utf8");
    expect(text).not.toContain(path);
  });
});
