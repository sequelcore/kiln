import { publishExecutionTargetBinding } from "../../src/config/execution-target-binding-store.js";
import { writeExecutionTargetEvidenceSnapshot } from "../../src/config/execution-target-evidence-store.js";
import { resolveGlobalConfigPath } from "../../src/config/global-config/path.js";
import { syntheticExecutionTargetEvidence } from "./execution-target-evidence-fixture.js";
import { stringify } from "yaml";
import {
  commitGlobalConfigBytes,
  readGlobalConfig,
  readGlobalConfigSnapshot,
  type KilnGlobalConfig,
} from "../../src/config/global-config.js";

/** Test-only canonical seeding through the retained byte-commit primitive. */
export function persistGlobalConfigFixture(
  value: KilnGlobalConfig | ((current: KilnGlobalConfig | null) => KilnGlobalConfig),
) {
  const current = readGlobalConfig();
  const next = typeof value === "function" ? value(current) : value;
  return commitGlobalConfigBytes({
    content: stringify(next),
    expectedRevision: readGlobalConfigSnapshot().revision,
  });
}

/** Explicitly seed admitted synthetic target evidence for integration tests. */
export function persistAdmittedGlobalConfigFixture(value: KilnGlobalConfig | ((current: KilnGlobalConfig | null) => KilnGlobalConfig)) {
  const next = typeof value === "function" ? value(readGlobalConfig()) : value;
  if (next.targetCatalog) {
    const path = resolveGlobalConfigPath();
    const evidence = writeExecutionTargetEvidenceSnapshot({ globalConfigPath: path, snapshot: syntheticExecutionTargetEvidence(next.targetCatalog) });
    publishExecutionTargetBinding(path, next.targetCatalog, evidence.revision);
  }
  return persistGlobalConfigFixture(next);
}
