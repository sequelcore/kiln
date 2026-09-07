import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CodeIntelligenceEntry } from "../../packages/core/src/tools/domain/code-intelligence.js";
import { expectedKeys, fixtureDirectory, fixtureNames, referenceTasks } from "./corpus.js";
import { taskRequest } from "./corpus.js";
import { TypeScriptReferenceAdapter } from "./reference-adapter.js";
import { captureSources, digest, isCurrent, type SourceSnapshot } from "./snapshot.js";

export function locationKeys(entries: readonly CodeIntelligenceEntry[]): string[] {
  return entries
    .map((entry) => {
      if (!entry.path || !entry.range || entry.range.start.line !== entry.range.end.line) {
        throw new Error("invalid-location-evidence");
      }
      return `${entry.path}:${entry.range.start.line}:${entry.range.start.character}:${entry.range.end.character - entry.range.start.character}`;
    })
    .sort();
}

export function scoreLocations(
  actual: readonly string[],
  expected: readonly string[],
): {
  precision: number;
  recall: number;
  falsePositives: string[];
  falseNegatives: string[];
} {
  const observed = new Set(actual);
  const oracle = new Set(expected);
  const falsePositives = [...observed].filter((key) => !oracle.has(key));
  const falseNegatives = [...oracle].filter((key) => !observed.has(key));
  const correct = oracle.size - falseNegatives.length;
  return {
    precision: observed.size ? correct / observed.size : oracle.size ? 0 : 1,
    recall: oracle.size ? correct / oracle.size : 1,
    falsePositives,
    falseNegatives,
  };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid-rg-json");
  return value as Record<string, unknown>;
}

/** Parse UTF-8 byte offsets from rg into the same UTF-16 span coordinates as the compiler. */
export function lexicalKeys(output: string): string[] {
  const keys: string[] = [];
  for (const line of output.split("\n").filter(Boolean)) {
    const event = record(JSON.parse(line));
    if (event["type"] !== "match") continue;
    const data = record(event["data"]);
    const path = record(data["path"])["text"];
    const text = record(data["lines"])["text"];
    const lineNumber = data["line_number"];
    const matches = data["submatches"];
    if (
      typeof path !== "string" ||
      typeof text !== "string" ||
      typeof lineNumber !== "number" ||
      !Number.isInteger(lineNumber) ||
      lineNumber < 1 ||
      !Array.isArray(matches)
    )
      throw new Error("invalid-rg-match");
    const bytes = Buffer.from(text);
    for (const match of matches) {
      const fields = record(match);
      const start = fields["start"];
      const end = fields["end"];
      if (
        typeof start !== "number" ||
        typeof end !== "number" ||
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end < start ||
        end > bytes.length
      )
        throw new Error("invalid-rg-span");
      keys.push(
        `${path.replaceAll("\\", "/")}:${lineNumber - 1}:${bytes.subarray(0, start).toString("utf8").length}:${bytes.subarray(start, end).toString("utf8").length}`,
      );
    }
  }
  return [...new Set(keys)].sort();
}

export function lexicalObservation(
  snapshot: SourceSnapshot,
  symbol: string,
): {
  disposition: "complete" | "failed";
  reason?: string;
  keys: string[];
  outputBytes: number;
  elapsedMs: number;
} {
  const started = performance.now();
  if (!isCurrent(snapshot))
    return { disposition: "failed", reason: "stale-snapshot", keys: [], outputBytes: 0, elapsedMs: 0 };
  const result = spawnSync(
    "rg",
    [
      "--no-config",
      "--json",
      "--fixed-strings",
      "--word-regexp",
      "--",
      symbol,
      ...snapshot.sources.map((source) => source.path),
    ],
    { cwd: snapshot.root, encoding: "utf8", timeout: 15_000, maxBuffer: 1_048_576, windowsHide: true },
  );
  const outputBytes = Buffer.byteLength(result.stdout ?? "");
  if (result.error || (result.status !== 0 && result.status !== 1) || !isCurrent(snapshot)) {
    return {
      disposition: "failed",
      reason: "rg-failed-or-stale",
      keys: [],
      outputBytes,
      elapsedMs: performance.now() - started,
    };
  }
  try {
    return {
      disposition: "complete",
      keys: lexicalKeys(result.stdout),
      outputBytes,
      elapsedMs: performance.now() - started,
    };
  } catch {
    return {
      disposition: "failed",
      reason: "invalid-rg-output",
      keys: [],
      outputBytes,
      elapsedMs: performance.now() - started,
    };
  }
}

export async function evaluateReferences(root: string): Promise<unknown> {
  const protocolPath = "docs/research/active/repository-analysis-reference-protocol.md";
  const implementationPaths = ["snapshot.ts", "reference-adapter.ts", "corpus.ts", "evaluate.ts"];
  const protocolDigest = digest(readFileSync(resolve(root, protocolPath), "utf8"));
  const implementationDigest = digest(
    JSON.stringify(
      implementationPaths.map((path) => [
        path,
        digest(readFileSync(resolve(root, "scripts/repository-analysis", path), "utf8")),
      ]),
    ),
  );
  const started = performance.now();
  const snapshot = captureSources(
    root,
    fixtureNames.map((name) => `${fixtureDirectory}/${name}.ts`),
  );
  const captureMs = performance.now() - started;
  const observations = [];
  let allExact = true;
  for (const task of referenceTasks) {
    const expected = expectedKeys(task);
    for (let repetition = 0; repetition < 3; repetition++) {
      const lexical = lexicalObservation(snapshot, task.query.symbol);
      const coldStarted = performance.now();
      const adapter = new TypeScriptReferenceAdapter(snapshot);
      try {
        const cold = await adapter.query(taskRequest(root, task));
        const coldTotalMs = performance.now() - coldStarted;
        const warm = await adapter.query(taskRequest(root, task));
        const coldKeys = locationKeys(cold.entries);
        const warmKeys = locationKeys(warm.entries);
        const coldScore = scoreLocations(coldKeys, expected);
        const warmScore = scoreLocations(warmKeys, expected);
        const sameLocations = JSON.stringify(coldKeys) === JSON.stringify(warmKeys);
        allExact &&=
          cold.disposition === "complete" &&
          warm.disposition === "complete" &&
          coldScore.precision === 1 &&
          coldScore.recall === 1 &&
          warmScore.precision === 1 &&
          warmScore.recall === 1 &&
          sameLocations;
        observations.push({
          task: task.id,
          repetition,
          expected,
          lexicalCandidates: { ...lexical, ...scoreLocations(lexical.keys, expected) },
          cold: {
            ...cold,
            ...coldScore,
            totalMsIncludingConstruction: coldTotalMs,
            locationBytes: Buffer.byteLength(JSON.stringify(cold.entries)),
            evidenceBytes: Buffer.byteLength(JSON.stringify(cold)),
          },
          warm: {
            ...warm,
            ...warmScore,
            locationBytes: Buffer.byteLength(JSON.stringify(warm.entries)),
            evidenceBytes: Buffer.byteLength(JSON.stringify(warm)),
          },
          sameLocations,
          parentRssBytes: process.memoryUsage().rss,
        });
      } finally {
        await adapter.close();
      }
    }
  }
  return {
    schema: "repository-analysis-reference-development-v1",
    verdict: "diagnostic-only",
    createdAt: new Date().toISOString(),
    protocolDigest,
    implementationDigest,
    runtime: process.versions,
    platform: process.platform,
    architecture: process.arch,
    rgVersion: spawnSync("rg", ["--version"], { encoding: "utf8", windowsHide: true, timeout: 5000 }).stdout?.split(
      "\n",
    )[0],
    captureMs,
    workspaceId: snapshot.workspaceId,
    revision: snapshot.revision,
    dirtyStateDigest: snapshot.dirtyStateDigest,
    sourceDigest: snapshot.sourceDigest,
    sources: snapshot.sources.map(({ path, hash }) => ({ path, hash })),
    allReferenceOraclesPassed: allExact,
    observations,
    limitations: [
      "development corpus, not held out",
      "selected files and fixed compiler options only",
      "rg candidate stage excludes targeted-read reasoning",
      "parent RSS excludes native compiler process",
      "no model task, provider token, cost, or production promotion evidence",
    ],
  };
}

if (import.meta.main) {
  console.log(JSON.stringify(await evaluateReferences(resolve(import.meta.dirname, "../..")), null, 2));
}
