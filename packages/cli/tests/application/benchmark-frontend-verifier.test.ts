import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  FRONTEND_VERIFIER_IMAGE,
  FRONTEND_VERIFIER_IMAGE_ID,
  FRONTEND_VERIFIER_SOURCE_DIGEST,
  verifyFrontendBenchmarkLease,
  type FrontendVerifierRunner,
} from "../../src/application/benchmark-frontend-verifier.js";
import { createBenchmarkWriteWorkspaceLease } from "../../src/application/benchmark-write-workspace.js";
import { resolveProjectRoot } from "../../src/application/project-root-resolver.js";

const FIXTURE = "packages/core/evals/fixtures/model-roster-frontend-render-v2";
const CASE_ID = "modal-focus";
const IMAGE_ID = FRONTEND_VERIFIER_IMAGE_ID;

describe("verifyFrontendBenchmarkLease", () => {
  it("keeps the admitted image source digest synchronized with the locked verifier inputs", async () => {
    const root = resolveProjectRoot().rootPath;
    const hash = createHash("sha256");
    for (const relativePath of [
      "packages/cli/verifiers/frontend/package-lock.json",
      "packages/cli/verifiers/frontend/verify.mjs",
    ]) {
      hash.update(relativePath);
      hash.update("\0");
      hash.update(await readFile(join(root, relativePath)));
      hash.update("\0");
    }
    expect(`sha256:${hash.digest("hex")}`).toBe(FRONTEND_VERIFIER_SOURCE_DIGEST);
    expect(await readFile(join(root, "packages/cli/verifiers/frontend/Dockerfile"), "utf8"))
      .toContain(`io.kiln.verifier-source=\"${FRONTEND_VERIFIER_SOURCE_DIGEST}\"`);
  });

  it("accepts only complete isolated render, interaction, axe, and screenshot evidence", async () => {
    const lease = createBenchmarkWriteWorkspaceLease(resolveProjectRoot().rootPath, FIXTURE);
    await writeFile(join(lease.rootPath, "src", "Challenge.jsx"), "export function Challenge() { return null; }\n", "utf8");
    const runner = passingRunner();
    try {
      const result = await verifyFrontendBenchmarkLease({ lease, runner, benchmarkCaseId: CASE_ID });
      expect(result).toMatchObject({
        status: "passed",
        benchmarkCaseId: CASE_ID,
        violations: [],
        runner: {
          kind: "docker-playwright",
          image: FRONTEND_VERIFIER_IMAGE,
          imageId: IMAGE_ID,
          sourceDigest: FRONTEND_VERIFIER_SOURCE_DIGEST,
          network: "none",
          rootFilesystem: "read-only",
        },
        changes: { changed: [expect.objectContaining({ path: "src/Challenge.jsx" })], added: [], deleted: [] },
        screenshot: { sha256: expect.stringMatching(/^sha256:/u), bytes: expect.any(Number), base64: expect.any(String) },
      });
      const args = vi.mocked(runner.run).mock.calls[0]?.[1] ?? [];
      expect(args).toContain("--network");
      expect(args).toContain("none");
      expect(args).toContain("--read-only");
      expect(args).toContain("no-new-privileges");
      expect(args).toContain(`KILN_BENCHMARK_CASE=${CASE_ID}`);
      expect(args.at(-1)).toBe(FRONTEND_VERIFIER_IMAGE_ID);
      expect(args.some((arg) => arg.endsWith(":/workspace:ro"))).toBe(true);
      expect(args.some((arg) => arg.endsWith(":/output:rw"))).toBe(true);
    } finally {
      lease.cleanup();
    }
  });

  it("fails without launching the browser when the candidate changes a trusted fixture file", async () => {
    const lease = createBenchmarkWriteWorkspaceLease(resolveProjectRoot().rootPath, FIXTURE);
    await writeFile(join(lease.rootPath, "styles.css"), "tampered", "utf8");
    const runner = passingRunner();
    try {
      await expect(verifyFrontendBenchmarkLease({ lease, runner, benchmarkCaseId: CASE_ID })).resolves.toMatchObject({
        status: "failed",
        violations: [expect.stringContaining("outside the admitted scope: styles.css")],
      });
      expect(runner.run).not.toHaveBeenCalled();
    } finally {
      lease.cleanup();
    }
  });

  it("rejects a mutable or stale verifier image identity", async () => {
    const lease = createBenchmarkWriteWorkspaceLease(resolveProjectRoot().rootPath, FIXTURE);
    await writeFile(join(lease.rootPath, "src", "Challenge.jsx"), "export function Challenge() { return null; }\n", "utf8");
    const runner = passingRunner();
    vi.mocked(runner.inspectImage).mockResolvedValueOnce({
      imageId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sourceDigest: FRONTEND_VERIFIER_SOURCE_DIGEST,
      version: "2",
    });
    try {
      await expect(verifyFrontendBenchmarkLease({ lease, runner, benchmarkCaseId: CASE_ID })).rejects.toThrow("exact admitted image ID");
      expect(runner.run).not.toHaveBeenCalled();
    } finally {
      lease.cleanup();
    }
  });
});

function passingRunner(): FrontendVerifierRunner {
  return {
    inspectImage: vi.fn(async () => ({ imageId: IMAGE_ID, sourceDigest: FRONTEND_VERIFIER_SOURCE_DIGEST, version: "2" })),
    run: vi.fn(async (_containerName, args) => {
      const outputMount = args.find((arg) => arg.endsWith(":/output:rw"));
      if (!outputMount) throw new Error("missing output mount");
      const outputRoot = outputMount.slice(0, -":/output:rw".length);
      const screenshot = Buffer.from("synthetic-png");
      const sha256 = `sha256:${createHash("sha256").update(screenshot).digest("hex")}`;
      await writeFile(join(outputRoot, "screenshot.png"), screenshot);
      await writeFile(join(outputRoot, "report.json"), JSON.stringify({
        status: "passed",
        benchmarkCaseId: CASE_ID,
        browserVersion: "Chrome/140",
        assertions: {
          heading: true,
          tableAccessibleName: true,
          keyboardActivation: true,
          dialogAccessibleName: true,
          dialogInitialFocus: true,
          dialogFocusTrap: true,
          escapeCloses: true,
          focusRestored: true,
        },
        accessibility: { engine: "axe-core", version: "4.12.1", violationCount: 0 },
        screenshot: { sha256, bytes: screenshot.byteLength },
      }), "utf8");
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    }),
    cleanup: vi.fn(async () => undefined),
  };
}
