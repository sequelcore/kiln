import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { accessPolicy } from "./fixtures/qualification-v1/access-policy.js";

type AccessDecision = "allow" | "deny";

interface CaseRow {
  readonly authenticated: boolean;
  readonly canRead: boolean;
  readonly expected: AccessDecision;
}

interface CaseManifest {
  readonly schema: string;
  readonly function: string;
  readonly inputs: readonly CaseRow[];
}

const EXPECTED_CASES = new Map<string, AccessDecision>([
  ["false,false", "deny"],
  ["false,true", "deny"],
  ["true,false", "deny"],
  ["true,true", "allow"],
]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCaseManifest(): CaseManifest {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL("./fixtures/qualification-v1/cases.json", import.meta.url), "utf8"),
  );
  if (
    !isRecord(parsed) ||
    typeof parsed.schema !== "string" ||
    typeof parsed.function !== "string" ||
    !Array.isArray(parsed.inputs)
  ) {
    throw new Error("qualification case manifest has an invalid shape");
  }

  const inputs = parsed.inputs.map((entry, index): CaseRow => {
    if (
      !isRecord(entry) ||
      typeof entry.authenticated !== "boolean" ||
      typeof entry.canRead !== "boolean" ||
      (entry.expected !== "allow" && entry.expected !== "deny")
    ) {
      throw new Error(`qualification case ${index} has an invalid shape`);
    }
    return {
      authenticated: entry.authenticated,
      canRead: entry.canRead,
      expected: entry.expected,
    };
  });

  return { schema: parsed.schema, function: parsed.function, inputs };
}

describe("LemmaScript qualification fixture", () => {
  it("matches the complete default-deny authorization truth table", () => {
    const manifest = readCaseManifest();

    expect(manifest.schema).toBe("kiln.lemma-script-qualification-v1");
    expect(manifest.function).toBe("accessPolicy");
    expect(manifest.inputs).toHaveLength(EXPECTED_CASES.size);

    const keys = manifest.inputs.map(({ authenticated, canRead }) => `${authenticated},${canRead}`);
    expect(new Set(keys).size).toBe(EXPECTED_CASES.size);
    expect([...keys].sort()).toEqual([...EXPECTED_CASES.keys()].sort());

    for (const row of manifest.inputs) {
      const key = `${row.authenticated},${row.canRead}`;
      const expected = EXPECTED_CASES.get(key);
      expect(expected).toBeDefined();
      expect(row.expected).toBe(expected);
      expect(accessPolicy(row.authenticated, row.canRead)).toBe(row.expected);
    }
  });
});
