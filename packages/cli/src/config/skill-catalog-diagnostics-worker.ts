import { parentPort, workerData } from "node:worker_threads";
import { readSkillCatalogStatus } from "./skill-catalog-status.js";
import type { SkillCatalogDiagnosticScanOptions } from "./skill-catalog-diagnostics.js";

if (!parentPort) {
  throw new Error("Skill catalog diagnostic worker requires a parent port.");
}

try {
  const catalog = readSkillCatalogStatus(workerData as SkillCatalogDiagnosticScanOptions);
  parentPort.postMessage({ ok: true, catalog });
} catch (error: unknown) {
  parentPort.postMessage({
    ok: false,
    reason: error instanceof Error ? error.message : "Skill diagnostic inventory failed.",
  });
}
