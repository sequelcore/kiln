import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readTrustedExecutionAuthorization,
  writeTrustedExecutionAuthorization,
} from "../../src/security/trusted-execution-authorization-store.js";

const dirs: string[] = [];
function baseDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kiln-trust-store-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("trusted execution authorization store", () => {
  it("round-trips a record at the harness and project key", () => {
    const base = baseDir();
    const project = join(base, "project");
    const record = {
      profile: "trusted-full-access" as const,
      authorization: {
        status: "authorized" as const,
        scope: "operator-local" as const,
        revocable: true,
        authorizedBy: "operator:test",
        authorizedAt: "2026-08-06T00:00:00.000Z",
      },
    };
    writeTrustedExecutionAuthorization("codex", project, record, base);
    expect(readTrustedExecutionAuthorization("codex", project, base)).toEqual(record);
  });
  it("returns undefined for a missing store", () =>
    expect(readTrustedExecutionAuthorization("opencode", "C:/project", baseDir())).toBeUndefined());
  it("keeps records isolated by harness and absolute project path", () => {
    const base = baseDir();
    const record = {
      profile: "workspace-write" as const,
      authorization: { status: "narrowed" as const, scope: "operator-local" as const, revocable: true },
    };
    writeTrustedExecutionAuthorization("codex", "C:/one", record, base);
    expect(readTrustedExecutionAuthorization("claude-code", "C:/one", base)).toBeUndefined();
    expect(readTrustedExecutionAuthorization("codex", "C:/two", base)).toBeUndefined();
  });
});
