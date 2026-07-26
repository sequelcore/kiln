import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isAbsolute, relative, resolve } from "node:path";
import { TextDecoder } from "node:util";
import { describe, expect, it } from "vitest";
import {
  evaluateVerifiedEfficiencyPublicationReadiness,
  type VerifiedEfficiencyPublicationManifest,
} from "../../src/efficiency/index.js";

const TEST_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const REPOSITORY_ROOT = resolveRepositoryRoot();
const MANIFEST_PATH = "docs/benchmarks/verified-efficiency-v1/manifest.json";
const REPORT_PATH = "docs/benchmarks/verified-efficiency-v1/reports/reference-report.json";
const FIXTURE_PATH = "packages/core/evals/benchmark/kiln-verified-efficiency-surface-v1.json";

function resolveRepositoryRoot(): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: TEST_DIRECTORY,
      encoding: "utf8",
    }).trim();
  } catch {
    return undefined;
  }
}

function normalizeRepositoryRelativePath(path: string, repositoryRoot: string): string | undefined {
  if (path.trim().length === 0 || path.includes("\0")) return undefined;

  const normalizedPath = path.replaceAll("\\", "/");
  if (normalizedPath.startsWith("/") || /^[A-Za-z]:\//.test(normalizedPath)) return undefined;

  const segments = normalizedPath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return undefined;

  const resolvedPath = resolve(repositoryRoot, normalizedPath);
  const relativePath = relative(repositoryRoot, resolvedPath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    relativePath.startsWith("..\\") ||
    isAbsolute(relativePath)
  ) {
    return undefined;
  }

  return normalizedPath;
}

function readRepositoryArtifact(path: string): string | undefined {
  try {
    if (REPOSITORY_ROOT === undefined) return undefined;

    const repositoryRelativePath = normalizeRepositoryRelativePath(path, REPOSITORY_ROOT);
    if (repositoryRelativePath === undefined) return undefined;

    const content = execFileSync("git", ["show", `HEAD:${repositoryRelativePath}`], {
      cwd: REPOSITORY_ROOT,
      encoding: "buffer",
    });
    const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content);
    return Buffer.from(decoded, "utf8").equals(content) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function manifest(): VerifiedEfficiencyPublicationManifest {
  return JSON.parse(readRepositoryArtifact(MANIFEST_PATH) ?? "null") as VerifiedEfficiencyPublicationManifest;
}

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

describe("verified efficiency publication readiness", () => {
  it("fails closed for a malformed manifest instead of dereferencing missing fields", () => {
    expect(evaluateVerifiedEfficiencyPublicationReadiness({}, () => undefined)).toMatchObject({
      status: "blocked",
      publicClaimAllowed: false,
      issues: ["publication manifest shape is invalid"],
      benchmarkBaselinesSha256: "sha256:unknown",
    });
  });

  it("verifies the committed reference bundle while forbidding a public claim", () => {
    const readiness = evaluateVerifiedEfficiencyPublicationReadiness(manifest(), readRepositoryArtifact);

    expect(readiness).toMatchObject({
      schemaVersion: "verified-efficiency-publication-readiness-v1",
      status: "internal-evidence-only",
      publicClaimAllowed: false,
      issues: [],
    });
    expect(readiness.verifiedArtifacts.map((artifact) => artifact.kind).sort()).toEqual([
      "fixture",
      "limitations",
      "methodology",
      "report",
    ]);
  });

  it("blocks tampered or missing content instead of trusting artifact labels", () => {
    const readiness = evaluateVerifiedEfficiencyPublicationReadiness(manifest(), (path) => (
      path.endsWith("kiln-verified-efficiency-surface-v1.json")
        ? `${readRepositoryArtifact(path)}\ntampered`
        : readRepositoryArtifact(path)
    ));

    expect(readiness.status).toBe("blocked");
    expect(readiness.publicClaimAllowed).toBe(false);
    expect(readiness.issues).toContainEqual(expect.stringContaining("digest mismatch"));
  });

  it("blocks public claims without adequate samples or comparable cost evidence", () => {
    const reference = manifest();
    const publicCandidate: VerifiedEfficiencyPublicationManifest = {
      ...reference,
      claim: { kind: "cost-efficiency", statement: "Candidate costs less." },
      design: { ...reference.design, k: 4 },
    };
    const readiness = evaluateVerifiedEfficiencyPublicationReadiness(publicCandidate, readRepositoryArtifact);

    expect(readiness.status).toBe("blocked");
    expect(readiness.publicClaimAllowed).toBe(false);
    expect(readiness.issues).toEqual(expect.arrayContaining([
      "public claims require k >= 5",
      "cost-efficiency claims require comparable metered economics",
      "report claim kind does not match manifest",
    ]));
  });

  it("derives a public token claim from content-verified paired observations", () => {
    const reference = manifest();
    const fixture = JSON.parse(readRepositoryArtifact(FIXTURE_PATH)!) as Record<string, unknown>;
    const fixturePairs = fixture.pairs as Array<Record<string, unknown>>;
    fixturePairs[0]!.candidateTokens = 79;
    const fixtureContent = `${JSON.stringify(fixture, null, 2)}\n`;
    const fixtureHash = sha256(fixtureContent);
    const report = JSON.parse(readRepositoryArtifact(REPORT_PATH)!) as Record<string, unknown>;
    report.claimKind = "token-efficiency";
    report.claim = "The deterministic candidate fixture uses fewer provider-total tokens.";
    report.fixtureSha256 = fixtureHash;
    const reportPairs = report.pairs as Array<Record<string, unknown>>;
    const firstCandidate = reportPairs[0]!.candidate as Record<string, unknown>;
    firstCandidate.providerTotalTokens = 79;
    firstCandidate.estimatedTokens = 79;
    firstCandidate.avoidedTokens = 1;
    report.confidence = {
      ...(report.confidence as Record<string, unknown>),
      lowerBound: 0.01,
    };
    const reportContent = `${JSON.stringify(report, null, 2)}\n`;
    const publicCandidate: VerifiedEfficiencyPublicationManifest = {
      ...reference,
      claim: { kind: "token-efficiency", statement: report.claim as string },
      design: {
        ...reference.design,
        fixtureSetHash: fixtureHash,
        confidence: { ...reference.design.confidence, lowerBound: 0.01 },
      },
      artifacts: reference.artifacts.map((artifact) => {
        if (artifact.path === REPORT_PATH) return { ...artifact, sha256: sha256(reportContent) };
        if (artifact.path === FIXTURE_PATH) return { ...artifact, sha256: fixtureHash };
        return artifact;
      }),
    };
    const read = (path: string): string | undefined => path === REPORT_PATH
      ? reportContent
      : path === FIXTURE_PATH ? fixtureContent : readRepositoryArtifact(path);
    const readiness = evaluateVerifiedEfficiencyPublicationReadiness(publicCandidate, read, (path) => read(path));

    expect(readiness).toMatchObject({ status: "public-ready", publicClaimAllowed: true, issues: [] });
  });

  it("blocks forged public assertions and repository-external artifact paths", () => {
    const reference = manifest();
    const report = JSON.parse(readRepositoryArtifact(REPORT_PATH)!) as Record<string, unknown>;
    report.claimKind = "token-efficiency";
    report.claim = "A forged candidate claims fewer tokens.";
    report.confidence = {
      ...(report.confidence as Record<string, unknown>),
      lowerBound: 0.1,
    };
    const pairs = report.pairs as Array<Record<string, unknown>>;
    pairs[0]!.candidateInputHash = "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    (report.identity as Record<string, unknown>).harness = "relabeled harness";
    for (const pair of pairs) {
      const baseline = pair.baseline as Record<string, unknown>;
      const candidate = pair.candidate as Record<string, unknown>;
      candidate.providerTotalTokens = baseline.providerTotalTokens;
      candidate.estimatedTokens = baseline.estimatedTokens;
      candidate.avoidedTokens = 0;
    }
    const reportContent = `${JSON.stringify(report, null, 2)}\n`;
    const publicCandidate: VerifiedEfficiencyPublicationManifest = {
      ...reference,
      claim: { kind: "token-efficiency", statement: report.claim as string },
      design: {
        ...reference.design,
        confidence: { ...reference.design.confidence, lowerBound: 0.1 },
      },
      artifacts: reference.artifacts.map((artifact) => artifact.path === REPORT_PATH
        ? { ...artifact, sha256: sha256(reportContent) }
        : artifact.kind === "methodology"
          ? { ...artifact, path: "\\\\server\\share\\methodology.md" }
          : artifact),
    };
    const read = (path: string): string | undefined => path === REPORT_PATH ? reportContent : readRepositoryArtifact(path);
    const readiness = evaluateVerifiedEfficiencyPublicationReadiness(publicCandidate, read, (path) => read(path));

    expect(readiness.status).toBe("blocked");
    expect(readiness.publicClaimAllowed).toBe(false);
    expect(readiness.issues).toEqual(expect.arrayContaining([
      "token-efficiency claims require lower candidate provider-total tokens",
      "report execution identity does not match manifest",
      "manifest paired-identical assertion does not match report input hashes",
      "public claims require paired identical tasks",
      expect.stringContaining("not committed-relative"),
      expect.stringContaining("fixture observation does not match report pair"),
    ]));
  });
});
