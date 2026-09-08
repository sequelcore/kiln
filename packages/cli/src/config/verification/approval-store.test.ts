import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readVerifierApproval, writeVerifierApproval, type VerifierApproval } from "./approval-store.js";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
const approval: VerifierApproval = {
  version: 1,
  selection: {
    verifier: "dafny",
    config: { executable: "C:/tools/Dafny.exe", installationRoot: "C:/tools", expectedVersion: "4.11.0" },
  },
  digest: `sha256:${"ab".repeat(32)}`,
};

describe("verifier approval evidence", () => {
  it("binds approval to the exact path, version, installation root, and verifier", () => {
    const home = mkdtempSync(join(tmpdir(), "verifier-approval-"));
    homes.push(home);
    expect(readVerifierApproval(approval.selection, home)).toBeUndefined();
    writeVerifierApproval(approval, home);
    expect(readVerifierApproval(approval.selection, home)).toEqual(approval);
    for (const config of [
      { ...approval.selection.config, executable: "C:/other/Dafny.exe" },
      { ...approval.selection.config, expectedVersion: "4.12.0" },
      { ...approval.selection.config, installationRoot: "C:/other" },
    ])
      expect(readVerifierApproval({ verifier: "dafny", config }, home)).toBeUndefined();
    expect(
      readVerifierApproval(
        { verifier: "gentle-ai", config: { executable: "C:/tools/Dafny.exe", expectedVersion: "4.11.0" } },
        home,
      ),
    ).toBeUndefined();
  });

  it("rejects corrupt and misbound stored evidence", () => {
    const home = mkdtempSync(join(tmpdir(), "verifier-approval-"));
    homes.push(home);
    writeVerifierApproval(approval, home);
    const directory = join(home, "evidence", "verifiers");
    const path = join(directory, readdirSync(directory)[0]!);
    for (const raw of [
      "{",
      JSON.stringify({ ...approval, digest: "unverified" }),
      JSON.stringify({
        ...approval,
        selection: { ...approval.selection, config: { ...approval.selection.config, expectedVersion: "0.0.0" } },
      }),
    ]) {
      writeFileSync(path, raw);
      expect(() => readVerifierApproval(approval.selection, home)).toThrow();
    }
  });
});
