// parseDatasetJsonl: loads a JSONL file into a Dataset

import type { Dataset, DatasetItem } from "./types.js";
import { KilnError } from "../engine/errors.js";

export function parseDatasetJsonl(name: string, content: string): Dataset {
  if (!content || content.trim().length === 0) {
    throw new KilnError("EVAL_DATASET_NOT_FOUND", `Dataset "${name}" is empty`, {
      context: { name },
    });
  }

  const lines = content.split("\n");
  const items: DatasetItem[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "" || line.startsWith("//") || line.startsWith("#")) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new KilnError("EVAL_DATASET_NOT_FOUND", `Invalid JSON at line ${i + 1} in dataset "${name}"`, {
        context: { name, line: i + 1 },
      });
    }

    if (typeof parsed !== "object" || parsed === null) {
      throw new KilnError("EVAL_DATASET_NOT_FOUND", `Line ${i + 1} is not a JSON object in dataset "${name}"`, {
        context: { name, line: i + 1 },
      });
    }

    const obj = parsed as Record<string, unknown>;

    if (!obj.id || typeof obj.id !== "string") {
      throw new KilnError("EVAL_DATASET_NOT_FOUND", `Missing or invalid "id" at line ${i + 1} in dataset "${name}"`, {
        context: { name, line: i + 1 },
      });
    }

    if (!obj.input || typeof obj.input !== "string") {
      throw new KilnError("EVAL_DATASET_NOT_FOUND", `Missing or invalid "input" at line ${i + 1} in dataset "${name}"`, {
        context: { name, line: i + 1 },
      });
    }

    if (seenIds.has(obj.id)) {
      throw new KilnError("EVAL_DATASET_NOT_FOUND", `Duplicate id "${obj.id}" at line ${i + 1} in dataset "${name}"`, {
        context: { name, line: i + 1, id: obj.id },
      });
    }
    seenIds.add(obj.id);

    items.push({
      id: obj.id,
      input: obj.input,
      expected: typeof obj.expected === "string" ? obj.expected : undefined,
      context: Array.isArray(obj.context) ? obj.context.filter((c): c is string => typeof c === "string") : undefined,
      metadata: typeof obj.metadata === "object" && obj.metadata !== null ? obj.metadata as Record<string, unknown> : undefined,
    });
  }

  return { name, items };
}
