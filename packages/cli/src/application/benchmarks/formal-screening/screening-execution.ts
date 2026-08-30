import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BenchmarkItemExecutionContext } from "@kilnai/core/eval";
import { BACKEND_BENCHMARK_CASES } from "../../benchmark-backend-cases.js";
import type { BackendVerifierCasePayload } from "./backend-verifier.js";
import type { PrivateFormalScreeningCaseFacts, PrivateFormalScreeningPackageFacts } from "./package-loader.js";

/** Formal-screening-only execution policy kept out of the generic benchmark dispatcher. */
export function resolveFormalScreeningCase(
  formalPackage: PrivateFormalScreeningPackageFacts | undefined,
  formalConfig: unknown,
  context: BenchmarkItemExecutionContext,
): PrivateFormalScreeningCaseFacts {
  if (!formalPackage || !formalConfig)
    throw new Error("Formal screening requires formalScreeningPackage and formalScreeningConfig.");
  const screeningCase = formalPackage.cases.find((candidate) => candidate.id === context.item.id);
  if (!screeningCase)
    throw new Error(`Formal screening case '${context.item.id}' is not present in the private package.`);
  const arm = context.item.metadata?.formalScreeningArm;
  if (arm !== "C0" && arm !== "T")
    throw new Error("Formal screening items require an exact C0 or T formalScreeningArm.");
  if (arm !== screeningCase.arm)
    throw new Error(`Formal screening arm '${arm}' does not match private case arm '${screeningCase.arm}'.`);
  return screeningCase;
}

export function omitFormalVerificationCapability<
  T extends { readonly verificationTools?: readonly { readonly name: string }[] },
>(options: T): T {
  if (!options.verificationTools?.some((tool) => tool.name === "formal_verify")) return options;
  return {
    ...options,
    verificationTools: options.verificationTools.filter((tool) => tool.name !== "formal_verify"),
  } as T;
}
export function toBackendVerifierCasePayload(value: PrivateFormalScreeningCaseFacts): BackendVerifierCasePayload {
  return {
    id: value.id,
    hiddenTestSource: value.hiddenTestSource,
    hiddenTestDigest: value.hiddenTestDigest,
    hiddenTestCount: value.hiddenTestCount,
  };
}
export function toPublicBackendVerifierCasePayload(value: unknown): BackendVerifierCasePayload {
  if (typeof value !== "string") throw new Error("Backend benchmark verification requires a benchmark case id.");
  const benchmarkCase = BACKEND_BENCHMARK_CASES[value as keyof typeof BACKEND_BENCHMARK_CASES];
  if (!benchmarkCase || benchmarkCase.id !== value)
    throw new Error(`Backend benchmark case '${value}' is not admitted.`);
  return {
    id: benchmarkCase.id,
    hiddenTestSource: benchmarkCase.hiddenTestSource,
    hiddenTestDigest: benchmarkCase.testDigest,
    hiddenTestCount: benchmarkCase.testCount,
  };
}
export function computeFormalVerifierHash(value: PrivateFormalScreeningCaseFacts): string {
  return digest({
    verifierId: "kiln.backend-write.v2",
    verifierVersion: "2",
    benchmarkCaseId: value.pairId,
    testDigest: value.hiddenTestDigest,
    hiddenTestCount: value.hiddenTestCount,
    allowedChangedPaths: value.allowedChangedPaths,
  });
}
export function parseLemmaCheckObservation(value: unknown): readonly [Record<string, unknown>] | readonly [] {
  if (
    !isRecord(value) ||
    typeof value.kind !== "string" ||
    typeof value.status !== "string" ||
    typeof value.stage !== "string" ||
    value.semanticEquivalence !== "unresolved" ||
    value.benchmarkReady !== false ||
    !isRecord(value.digests)
  )
    return [];
  return [value];
}
export function readLemmaCheckDependencyBinding(value: unknown): readonly string[] {
  if (!isRecord(value)) return [];
  const digests = isRecord(value.digests) ? value.digests : undefined;
  return isSha256Digest(digests?.dependencyBinding) ? [digests.dependencyBinding] : [];
}
export function readFormalContractDigest(root: string): string | undefined {
  try {
    const directives = readFileSync(join(root, "src", "solution.ts"), "utf8")
      .split(/\r?\n/u)
      .filter((line) => /^\s*\/\/@/u.test(line));
    return directives.length === 0 ? undefined : digest(directives);
  } catch {
    return undefined;
  }
}
export function readFormalCandidateDigest(root: string): string | undefined {
  try {
    return `sha256:${createHash("sha256")
      .update(readFileSync(join(root, "src", "solution.ts")))
      .digest("hex")}`;
  } catch {
    return undefined;
  }
}
function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}
function isSha256Digest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
