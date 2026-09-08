import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { resolveKilnHomePath } from "../global-config/path.js";
import type { DeepReadonly } from "../deep-readonly.js";
import { VERIFIER_SELECTION_SCHEMA, type VerifierSelection } from "./selection-schema.js";

const approvalSchema = Type.Object(
  {
    version: Type.Literal(1),
    selection: VERIFIER_SELECTION_SCHEMA,
    digest: Type.String({ pattern: "^sha256:[a-f0-9]{64}$" }),
  },
  { additionalProperties: false },
);

export type VerifierApproval = DeepReadonly<Static<typeof approvalSchema>>;

function selectionKey(selection: VerifierSelection): string {
  return JSON.stringify([
    selection.verifier,
    selection.config.executable,
    selection.config.expectedVersion,
    selection.verifier === "dafny" ? selection.config.installationRoot : null,
  ]);
}

function approvalPath(selection: VerifierSelection, kilnHome?: string): string {
  const key = createHash("sha256").update(selectionKey(selection)).digest("hex");
  return join(resolveKilnHomePath(kilnHome), "evidence", "verifiers", `${key}.json`);
}

/** Absence never grants approval; malformed or mismatched records fail closed. */
export function readVerifierApproval(selection: VerifierSelection, kilnHome?: string): VerifierApproval | undefined {
  let raw: string;
  try {
    raw = readFileSync(approvalPath(selection, kilnHome), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  const value: unknown = JSON.parse(raw);
  if (!Value.Check(approvalSchema, value) || selectionKey(value.selection) !== selectionKey(selection)) {
    throw new Error(`Invalid ${selection.verifier} approval evidence; review this verifier again.`);
  }
  return value;
}

/** Publish only a reviewed digest, or an exact pre-existing approval during migration. */
export function writeVerifierApproval(approval: VerifierApproval, kilnHome?: string): void {
  if (!Value.Check(approvalSchema, approval)) throw new Error("Invalid verifier approval.");
  const path = approvalPath(approval.selection, kilnHome);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(approval, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
    if (readVerifierApproval(approval.selection, kilnHome)?.digest !== approval.digest) {
      throw new Error("Verifier approval readback failed.");
    }
  } finally {
    rmSync(temporary, { force: true });
  }
}
