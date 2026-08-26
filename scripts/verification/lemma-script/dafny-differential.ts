import {
  type AccessDecision,
  DAFNY_OBSERVATION_SCHEMA,
  LEMMA_SCRIPT_CASE_KEYS,
  type LemmaScriptCaseKey,
} from "./differential-oracle.js";

export const DAFNY_DIFFERENTIAL_OUTPUT_SCHEMA = DAFNY_OBSERVATION_SCHEMA;

export interface DafnyObservation {
  readonly key: LemmaScriptCaseKey;
  readonly authenticated: boolean;
  readonly canRead: boolean;
  readonly result: AccessDecision;
  readonly line: string;
}

export type DafnyDifferentialDiagnosticCode =
  | "input-shape"
  | "generated-empty"
  | "generated-function-missing"
  | "generated-main-conflict"
  | "stdout-shape"
  | "stdout-unknown-line"
  | "stdout-row-malformed"
  | "stdout-result-unknown"
  | "stdout-duplicate"
  | "stdout-missing"
  | "mutation-input"
  | "mutation-occurrence-count"
  | "mutation-occurrence";

export interface DafnyDifferentialDiagnostic {
  readonly code: DafnyDifferentialDiagnosticCode;
  readonly message: string;
}

export interface DafnyDifferentialProgramFacts {
  readonly callCount: 4;
  readonly expectedValuesEmbedded: false;
  readonly caseKeys: readonly LemmaScriptCaseKey[];
}

export type DafnyDifferentialProgramResult =
  | {
      readonly status: "valid";
      readonly program: string;
      readonly derivedMain: string;
      readonly facts: DafnyDifferentialProgramFacts;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: "invalid";
      readonly program: "";
      readonly derivedMain: "";
      readonly facts: {
        readonly callCount: 0;
        readonly expectedValuesEmbedded: false;
        readonly caseKeys: readonly [];
      };
      readonly diagnostics: readonly DafnyDifferentialDiagnostic[];
    };

export interface DafnyObservationLineParseValidResult {
  readonly status: "valid";
  readonly observations: readonly DafnyObservation[];
  readonly diagnostics: readonly [];
}

export interface DafnyObservationLineParseInvalidResult {
  readonly status: "invalid";
  readonly observations: readonly [];
  readonly diagnostics: readonly DafnyDifferentialDiagnostic[];
}

export type DafnyObservationLineParseResult =
  | DafnyObservationLineParseValidResult
  | DafnyObservationLineParseInvalidResult;

export type DafnyMutationResult =
  | {
      readonly status: "mutated";
      readonly source: string;
      readonly facts: { readonly executableOccurrences: 1 };
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: "invalid";
      readonly source: "";
      readonly facts: { readonly executableOccurrences: number };
      readonly diagnostics: readonly DafnyDifferentialDiagnostic[];
    };

const KNOWN_DAFNY_NOISE = [
  /^Dafny program verifier finished with \d+ verified, \d+ errors$/u,
  /^Dafny program verifier finished with \d+ verified, \d+ errors\.$/u,
  /^Dafny program verifier did not attempt verification$/u,
] as const;
const CANONICAL_ROW_PATTERN =
  /^kiln\.lemma-script-dafny-evaluator\/v1\|authenticated=(true|false)\|canRead=(true|false)\|result=([^|]*)$/u;
const EXECUTABLE_MUTATION_PATTERN = "if (authenticated && canRead) then";
const MUTATED_CONDITION = "if (authenticated || canRead) then";
const DERIVED_MAIN_PREFIX = "method Main()\n{\n";

function addDiagnostic(
  diagnostics: DafnyDifferentialDiagnostic[],
  code: DafnyDifferentialDiagnosticCode,
  message: string,
): void {
  diagnostics.push({ code, message });
}

function domainKey(authenticated: boolean, canRead: boolean): LemmaScriptCaseKey {
  if (authenticated) return canRead ? "true,true" : "true,false";
  return canRead ? "false,true" : "false,false";
}

function parseDecision(value: string): AccessDecision | undefined {
  if (value === "AccessDecision.allow") return "allow";
  if (value === "AccessDecision.deny") return "deny";
  return undefined;
}

function normalizedLine(authenticated: boolean, canRead: boolean, result: AccessDecision): string {
  return `${DAFNY_DIFFERENTIAL_OUTPUT_SCHEMA}|authenticated=${authenticated}|canRead=${canRead}|result=${result}`;
}

function emptyProgramFacts(): {
  readonly callCount: 0;
  readonly expectedValuesEmbedded: false;
  readonly caseKeys: readonly [];
} {
  return { callCount: 0, expectedValuesEmbedded: false, caseKeys: [] };
}

function derivedMain(): string {
  const rows = LEMMA_SCRIPT_CASE_KEYS.map((key) => {
    const [authenticated, canRead] = key.split(",");
    return `  print "${DAFNY_DIFFERENTIAL_OUTPUT_SCHEMA}|authenticated=${authenticated}|canRead=${canRead}|result=", accessPolicy(${authenticated}, ${canRead}), "\\n";`;
  });
  return `${DERIVED_MAIN_PREFIX}${rows.join("\n")}\n}\n`;
}

/** Build a derived Dafny program without importing expected values. */
export function buildDafnyDifferentialProgram(value: unknown): DafnyDifferentialProgramResult {
  const diagnostics: DafnyDifferentialDiagnostic[] = [];
  if (typeof value !== "string") {
    addDiagnostic(diagnostics, "input-shape", "generated Dafny must be a string.");
    return {
      status: "invalid",
      program: "",
      derivedMain: "",
      facts: emptyProgramFacts(),
      diagnostics,
    };
  }
  if (value.trim().length === 0) {
    addDiagnostic(diagnostics, "generated-empty", "generated Dafny must not be empty.");
  }
  if (!/\bfunction\s+accessPolicy\s*\(/u.test(value)) {
    addDiagnostic(diagnostics, "generated-function-missing", "generated Dafny must define accessPolicy.");
  }
  if (/\bmethod\s+Main\s*\(/u.test(value)) {
    addDiagnostic(diagnostics, "generated-main-conflict", "generated Dafny must not already define Main.");
  }
  if (diagnostics.length > 0) {
    return {
      status: "invalid",
      program: "",
      derivedMain: "",
      facts: emptyProgramFacts(),
      diagnostics,
    };
  }

  const main = derivedMain();
  const separator = value.endsWith("\n") ? "" : "\n";
  return {
    status: "valid",
    program: `${value}${separator}${main}`,
    derivedMain: main,
    facts: { callCount: 4, expectedValuesEmbedded: false, caseKeys: [...LEMMA_SCRIPT_CASE_KEYS] },
    diagnostics: [],
  };
}

function isKnownNoise(line: string): boolean {
  return line.trim().length === 0 || KNOWN_DAFNY_NOISE.some((pattern) => pattern.test(line));
}

function parseCanonicalRow(
  line: string,
  lineNumber: number,
  diagnostics: DafnyDifferentialDiagnostic[],
): DafnyObservation | undefined {
  const match = CANONICAL_ROW_PATTERN.exec(line);
  if (match === null) {
    if (line.startsWith(`${DAFNY_DIFFERENTIAL_OUTPUT_SCHEMA}|`)) {
      addDiagnostic(diagnostics, "stdout-row-malformed", `stdout line ${lineNumber} is a malformed canonical row.`);
    } else {
      addDiagnostic(
        diagnostics,
        "stdout-unknown-line",
        `stdout line ${lineNumber} is not known Dafny noise or a canonical row.`,
      );
    }
    return undefined;
  }
  const authenticatedText = match[1];
  const canReadText = match[2];
  const resultText = match[3];
  if (authenticatedText === undefined || canReadText === undefined || resultText === undefined) {
    addDiagnostic(diagnostics, "stdout-row-malformed", `stdout line ${lineNumber} has missing canonical fields.`);
    return undefined;
  }
  const result = parseDecision(resultText);
  if (result === undefined) {
    addDiagnostic(
      diagnostics,
      "stdout-result-unknown",
      `stdout line ${lineNumber} has an unknown result '${resultText}'.`,
    );
    return undefined;
  }
  return {
    key: domainKey(authenticatedText === "true", canReadText === "true"),
    authenticated: authenticatedText === "true",
    canRead: canReadText === "true",
    result,
    line: normalizedLine(authenticatedText === "true", canReadText === "true", result),
  };
}

/** Parse real Dafny stdout while admitting only the documented noise lines. */
export function parseLemmaScriptObservationLines(value: unknown): DafnyObservationLineParseResult {
  const diagnostics: DafnyDifferentialDiagnostic[] = [];
  if (typeof value !== "string") {
    addDiagnostic(diagnostics, "stdout-shape", "Dafny stdout must be a string.");
    return { status: "invalid", observations: [], diagnostics };
  }

  const byKey = new Map<LemmaScriptCaseKey, DafnyObservation>();
  const lines = value.split(/\r?\n/u);
  lines.forEach((line, index) => {
    if (isKnownNoise(line)) return;
    const observation = parseCanonicalRow(line, index + 1, diagnostics);
    if (observation === undefined) return;
    if (byKey.has(observation.key)) {
      addDiagnostic(diagnostics, "stdout-duplicate", `stdout contains duplicate case key '${observation.key}'.`);
      return;
    }
    byKey.set(observation.key, observation);
  });
  for (const key of LEMMA_SCRIPT_CASE_KEYS) {
    if (!byKey.has(key)) addDiagnostic(diagnostics, "stdout-missing", `stdout is missing case key '${key}'.`);
  }
  if (diagnostics.length > 0) return { status: "invalid", observations: [], diagnostics };

  const observations = LEMMA_SCRIPT_CASE_KEYS.map((key) => byKey.get(key) as DafnyObservation);
  return { status: "valid", observations, diagnostics: [] };
}

function maskNonExecutableText(source: string): string {
  const characters = [...source];
  let state: "code" | "line-comment" | "block-comment" | "string" = "code";
  for (let index = 0; index < characters.length; index += 1) {
    const current = characters[index];
    const next = characters[index + 1];
    if (state === "code") {
      if (current === "/" && next === "/") {
        characters[index] = " ";
        characters[index + 1] = " ";
        state = "line-comment";
      } else if (current === "/" && next === "*") {
        characters[index] = " ";
        characters[index + 1] = " ";
        state = "block-comment";
      } else if (current === '"') {
        characters[index] = " ";
        state = "string";
      }
    } else if (state === "line-comment") {
      if (current === "\n" || current === "\r") state = "code";
      else characters[index] = " ";
    } else if (state === "block-comment") {
      if (current === "*" && next === "/") {
        characters[index] = " ";
        characters[index + 1] = " ";
        index += 1;
        state = "code";
      } else if (current !== "\n" && current !== "\r") {
        characters[index] = " ";
      }
    } else if (state === "string") {
      if (current === "\\") {
        characters[index] = " ";
        if (index + 1 < characters.length) {
          characters[index + 1] = " ";
          index += 1;
        }
      } else if (current === '"') {
        characters[index] = " ";
        state = "code";
      } else if (current !== "\n" && current !== "\r") {
        characters[index] = " ";
      }
    }
  }
  return characters.join("");
}

/** Apply exactly one calibrated executable mutation; never infer a near match. */
export function mutateDafnyTranslation(value: unknown): DafnyMutationResult {
  const diagnostics: DafnyDifferentialDiagnostic[] = [];
  if (typeof value !== "string" || value.length === 0) {
    addDiagnostic(diagnostics, "mutation-input", "Dafny translation to mutate must be a non-empty string.");
    return {
      status: "invalid",
      source: "",
      facts: { executableOccurrences: 0 },
      diagnostics,
    };
  }
  const masked = maskNonExecutableText(value);
  const occurrences: number[] = [];
  let offset = masked.indexOf(EXECUTABLE_MUTATION_PATTERN);
  while (offset >= 0) {
    occurrences.push(offset);
    offset = masked.indexOf(EXECUTABLE_MUTATION_PATTERN, offset + EXECUTABLE_MUTATION_PATTERN.length);
  }
  if (occurrences.length !== 1) {
    addDiagnostic(
      diagnostics,
      "mutation-occurrence-count",
      `expected exactly one executable '${EXECUTABLE_MUTATION_PATTERN}' occurrence, found ${occurrences.length}.`,
    );
    return {
      status: "invalid",
      source: "",
      facts: { executableOccurrences: occurrences.length },
      diagnostics,
    };
  }
  const occurrence = occurrences[0];
  if (occurrence === undefined) {
    addDiagnostic(diagnostics, "mutation-occurrence", "the executable mutation occurrence could not be located.");
    return {
      status: "invalid",
      source: "",
      facts: { executableOccurrences: 0 },
      diagnostics,
    };
  }
  const mutatedSource = `${value.slice(0, occurrence)}${MUTATED_CONDITION}${value.slice(occurrence + EXECUTABLE_MUTATION_PATTERN.length)}`;
  return {
    status: "mutated",
    source: mutatedSource,
    facts: { executableOccurrences: 1 },
    diagnostics: [],
  };
}
