import type { DeepReadonly } from "./deep-readonly.js";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { resolveKilnHomePath } from "./global-config/path.js";

const approvalSchema = Type.Object(
  {
    version: Type.Literal(1),
    harness: Type.Literal("codex"),
    sourceId: Type.String({ minLength: 1 }),
    packageDigest: Type.String({ pattern: "^sha256:[a-f0-9]{64}$" }),
  },
  { additionalProperties: false },
);

export type ExternalSkillApproval = DeepReadonly<Static<typeof approvalSchema>>;

function approvalPath(sourceId: string, userHome?: string): string {
  const kilnHome = userHome ? join(userHome, ".kiln") : resolveKilnHomePath();
  const key = createHash("sha256").update(sourceId).digest("hex");
  return join(kilnHome, "evidence", "external-skills", "codex", `${key}.json`);
}

export function readExternalSkillApprovals(
  sourceIds: readonly string[],
  userHome?: string,
): readonly ExternalSkillApproval[] {
  return sourceIds.flatMap((sourceId) => {
    const path = approvalPath(sourceId, userHome);
    if (!existsSync(path)) return [];
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!Value.Check(approvalSchema, value) || value.sourceId !== sourceId) {
      throw new Error(`Invalid approval evidence for ${sourceId}; review this skill again.`);
    }
    return [value];
  });
}

/** Publish only the exact contents explicitly reviewed by the operator. */
export function writeExternalSkillApproval(approval: ExternalSkillApproval, userHome?: string): void {
  if (!Value.Check(approvalSchema, approval)) throw new Error("Invalid external skill approval.");
  const path = approvalPath(approval.sourceId, userHome);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(approval, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
