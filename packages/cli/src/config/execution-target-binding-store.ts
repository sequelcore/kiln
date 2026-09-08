import { randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  executionTargetIntentRevision,
  projectExecutionTargetCatalogFromIntent,
  readExecutionTargetEvidenceSnapshot,
  type ExecutionTargetCatalogIntent,
  type ExecutionTargetEvidenceRevision,
} from "./execution-target-evidence-store.js";

const digest = Type.String({ pattern: "^sha256:[a-f0-9]{64}$" });
const bindingSchema = Type.Object(
  { version: Type.Literal(1), intentRevision: digest, evidenceRevision: digest },
  { additionalProperties: false },
);
export type ExecutionTargetBinding = Readonly<Static<typeof bindingSchema>>;

export function executionTargetBindingPath(globalConfigPath: string, intent: ExecutionTargetCatalogIntent): string {
  return join(
    dirname(globalConfigPath),
    "evidence",
    "execution-target-bindings",
    `${executionTargetIntentRevision(intent).slice(7)}.json`,
  );
}

export function serializeExecutionTargetBinding(
  intent: ExecutionTargetCatalogIntent,
  evidenceRevision: ExecutionTargetEvidenceRevision,
): string {
  return `${JSON.stringify({ version: 1, intentRevision: executionTargetIntentRevision(intent), evidenceRevision }, null, 2)}\n`;
}

export function readExecutionTargetBinding(
  globalConfigPath: string,
  intent: ExecutionTargetCatalogIntent,
): ExecutionTargetBinding {
  return parseExecutionTargetBinding(readFileSync(executionTargetBindingPath(globalConfigPath, intent), "utf8"), intent);
}

export function parseExecutionTargetBinding(raw: string, intent: ExecutionTargetCatalogIntent): ExecutionTargetBinding {
  const value: unknown = JSON.parse(raw);
  if (!Value.Check(bindingSchema, value) || value.intentRevision !== executionTargetIntentRevision(intent)) {
    throw new Error("Execution-target binding is invalid or belongs to different operator intent.");
  }
  return value;
}

/** Initial publication never replaces a prior binding. Renewal belongs to mutation authority. */
export function publishExecutionTargetBinding(
  globalConfigPath: string,
  intent: ExecutionTargetCatalogIntent,
  evidenceRevision: ExecutionTargetEvidenceRevision,
): void {
  const evidence = readExecutionTargetEvidenceSnapshot({ globalConfigPath, revision: evidenceRevision });
  projectExecutionTargetCatalogFromIntent(intent, evidence, evidenceRevision);
  const path = executionTargetBindingPath(globalConfigPath, intent);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, serializeExecutionTargetBinding(intent, evidenceRevision), { flag: "wx", mode: 0o600 });
      // Atomic create without replacing a concurrent binding.
      linkSync(temporary, path);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  if (readExecutionTargetBinding(globalConfigPath, intent).evidenceRevision !== evidenceRevision) {
    throw new Error("Execution-target intent is already bound to different evidence; use governed renewal.");
  }
}
