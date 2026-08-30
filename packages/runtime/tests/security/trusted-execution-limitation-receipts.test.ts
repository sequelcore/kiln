import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPENCODE_NO_FILESYSTEM_SANDBOX } from "@kilnai/core/security";
import { afterEach, describe, expect, it } from "vitest";
import {
  acceptTrustedExecutionSemanticLimitation,
  readTrustedExecutionSemanticLimitationAcceptance,
  revokeTrustedExecutionSemanticLimitation,
} from "../../src/security/trusted-execution-limitation-receipts.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("trusted execution semantic limitation receipts", () => {
  it("persists acceptance and revocation in the existing append-only JSONL format", () => {
    const path = createTemporaryDirectory();
    accept(path);
    expect(
      readTrustedExecutionSemanticLimitationAcceptance(
        path,
        OPENCODE_NO_FILESYSTEM_SANDBOX,
        "2026-09-01T00:00:00.000Z",
        path,
      ),
    ).toMatchObject({ revocable: true, acceptedBy: "operator:test" });
    expect(
      revokeTrustedExecutionSemanticLimitation({
        projectPath: path,
        baseDir: path,
        descriptor: OPENCODE_NO_FILESYSTEM_SANDBOX,
        revokedBy: "operator:test",
        revokedAt: "2026-09-02T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      readTrustedExecutionSemanticLimitationAcceptance(
        path,
        OPENCODE_NO_FILESYSTEM_SANDBOX,
        "2026-09-02T00:00:00.000Z",
        path,
      ),
    ).toBeUndefined();

    const receiptText = readReceiptText(path);
    expect(receiptText.trim().split("\n")).toHaveLength(2);
    expect(receiptText).not.toContain(path);
  });

  it("ignores invalid lines without hiding a valid receipt", () => {
    const path = createTemporaryDirectory();
    accept(path);
    const receiptName = readdirSync(path)[0];
    if (!receiptName) throw new Error("Expected a semantic-limitation receipt.");
    appendFileSync(join(path, receiptName), "not-json\n", "utf8");

    expect(
      readTrustedExecutionSemanticLimitationAcceptance(
        path,
        OPENCODE_NO_FILESYSTEM_SANDBOX,
        "2026-09-01T00:00:00.000Z",
        path,
      ),
    ).toMatchObject({ acceptedBy: "operator:test" });
  });
});

function createTemporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "kiln-limitation-"));
  temporaryDirectories.push(path);
  return path;
}

function accept(path: string): void {
  acceptTrustedExecutionSemanticLimitation({
    projectPath: path,
    baseDir: path,
    descriptor: OPENCODE_NO_FILESYSTEM_SANDBOX,
    acceptedBy: "operator:test",
    acceptedAt: "2026-08-13T01:00:00.000Z",
    reviewAfter: "2026-11-13T00:00:00.000Z",
  });
}

function readReceiptText(path: string): string {
  const receiptName = readdirSync(path)[0];
  if (!receiptName) throw new Error("Expected a semantic-limitation receipt.");
  return readFileSync(join(path, receiptName), "utf8");
}
