import { Type, type Static } from "@sinclair/typebox";
import type { DeepReadonly } from "../deep-readonly.js";

const nonEmptyString = Type.String({ minLength: 1, pattern: "\\S" });

export const DAFNY_SELECTION_SCHEMA = Type.Object(
  {
    executable: Type.Readonly(nonEmptyString),
    installationRoot: Type.Readonly(nonEmptyString),
    expectedVersion: Type.Readonly(nonEmptyString),
  },
  { additionalProperties: false },
);

export const GENTLE_AI_SELECTION_SCHEMA = Type.Object(
  {
    executable: Type.Readonly(nonEmptyString),
    expectedVersion: Type.Readonly(nonEmptyString),
  },
  { additionalProperties: false },
);

export const VERIFIER_SELECTION_SCHEMA = Type.Union([
  Type.Object({ verifier: Type.Literal("dafny"), config: DAFNY_SELECTION_SCHEMA }, { additionalProperties: false }),
  Type.Object(
    { verifier: Type.Literal("gentle-ai"), config: GENTLE_AI_SELECTION_SCHEMA },
    { additionalProperties: false },
  ),
]);

export type VerifierSelection = DeepReadonly<Static<typeof VERIFIER_SELECTION_SCHEMA>>;
