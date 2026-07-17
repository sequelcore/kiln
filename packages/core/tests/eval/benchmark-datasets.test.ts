import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseDatasetJsonl } from "../../src/eval/dataset-loader.js";

const DATASET_DIR = join(process.cwd(), "evals", "benchmark");
const REQUIRED_DATASETS = [
  "kiln-tool-agent-v1.jsonl",
  "kiln-managed-child-agent-v1.jsonl",
  "kiln-managed-frontend-team-v1.jsonl",
  "kiln-managed-coding-agent-v1.jsonl",
  "kiln-safety-agent-v1.jsonl",
] as const;

describe("benchmark baseline datasets", () => {
  it("ships one parseable internal dataset per benchmark-facing profile", () => {
    const files = new Set(readdirSync(DATASET_DIR));

    for (const file of REQUIRED_DATASETS) {
      expect(files.has(file)).toBe(true);
      const dataset = parseDatasetJsonl(file.replace(/\.jsonl$/u, ""), readFileSync(join(DATASET_DIR, file), "utf-8"));
      expect(dataset.items.length).toBeGreaterThanOrEqual(2);
      for (const item of dataset.items) {
        expect(item.metadata?.expectedAgentId).toBeTypeOf("string");
        expect(item.metadata?.milestones).toBeInstanceOf(Array);
      }
    }
  });
});
