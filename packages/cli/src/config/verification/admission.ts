import { isAbsolute } from "node:path";
import { KilnYamlError } from "../../kiln-yaml.js";
import { isRecord, rejectUnknownFields } from "../global-config/admission/shared.js";

export function validateGlobalVerification(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError("verification must be an object");
  rejectUnknownFields(value, ["formal", "static", "inferential"], "verification");
  if (value.formal === undefined && value.static === undefined && value.inferential === undefined) {
    throw new KilnYamlError("verification must configure at least one verifier class");
  }
  if (value.formal !== undefined) validateFormalVerification(value.formal);
  if (value.static !== undefined) validateStaticAnalysis(value.static);
  if (value.inferential !== undefined) validateInferentialReview(value.inferential);
}

function validateInferentialReview(value: unknown): void {
  if (!isRecord(value)) throw new KilnYamlError("verification.inferential must be an object");
  rejectUnknownFields(value, ["gentleAi"], "verification.inferential");
  if (!isRecord(value.gentleAi)) throw new KilnYamlError("verification.inferential.gentleAi must be an object");
  rejectUnknownFields(value.gentleAi, ["executable", "expectedVersion", "expectedExecutableDigest", "expectedBuildRevision"], "verification.inferential.gentleAi");
  if (typeof value.gentleAi.executable !== "string" || value.gentleAi.executable.trim().length === 0) throw new KilnYamlError("verification.inferential.gentleAi.executable must be a non-empty string");
  if (typeof value.gentleAi.expectedVersion !== "string" || !isCanonicalVersion(value.gentleAi.expectedVersion)) throw new KilnYamlError("verification.inferential.gentleAi.expectedVersion must be a canonical version");
  if (typeof value.gentleAi.expectedExecutableDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value.gentleAi.expectedExecutableDigest)) throw new KilnYamlError("verification.inferential.gentleAi.expectedExecutableDigest must be a sha256 digest");
  if (typeof value.gentleAi.expectedBuildRevision !== "string" || !/^[a-f0-9]{40}$/u.test(value.gentleAi.expectedBuildRevision)) throw new KilnYamlError("verification.inferential.gentleAi.expectedBuildRevision must be a Git revision");
}

function validateFormalVerification(value: unknown): void {
  if (!isRecord(value)) throw new KilnYamlError("verification.formal must be an object");
  rejectUnknownFields(value, ["dafny", "screening"], "verification.formal");
  if (!isRecord(value.dafny)) {
    throw new KilnYamlError("verification.formal.dafny must be an object");
  }
  rejectUnknownFields(value.dafny, ["executable", "expectedVersion"], "verification.formal.dafny");
  if (typeof value.dafny.executable !== "string" || value.dafny.executable.trim().length === 0) {
    throw new KilnYamlError("verification.formal.dafny.executable must be a non-empty string");
  }
  if (typeof value.dafny.expectedVersion !== "string" || !isCanonicalVersion(value.dafny.expectedVersion)) {
    throw new KilnYamlError("verification.formal.dafny.expectedVersion must be a canonical version");
  }
  const screening = value.screening;
  if (screening === undefined) return;
  if (!isRecord(screening)) {
    throw new KilnYamlError("verification.formal.screening must be an object");
  }
  rejectUnknownFields(screening, ["packagePath", "lemmaScript"], "verification.formal.screening");
  validateAbsolutePath(screening.packagePath, "verification.formal.screening.packagePath");
  if (!isRecord(screening.lemmaScript)) {
    throw new KilnYamlError("verification.formal.screening.lemmaScript must be an object");
  }
  rejectUnknownFields(
    screening.lemmaScript,
    ["packageRoot", "entrypoint", "expectedVersion"],
    "verification.formal.screening.lemmaScript",
  );
  validateAbsolutePath(screening.lemmaScript.packageRoot, "verification.formal.screening.lemmaScript.packageRoot");
  validateAbsolutePath(screening.lemmaScript.entrypoint, "verification.formal.screening.lemmaScript.entrypoint");
  if (
    typeof screening.lemmaScript.expectedVersion !== "string" ||
    !isCanonicalVersion(screening.lemmaScript.expectedVersion)
  ) {
    throw new KilnYamlError("verification.formal.screening.lemmaScript.expectedVersion must be a canonical version");
  }
}

function validateStaticAnalysis(value: unknown): void {
  if (!isRecord(value)) throw new KilnYamlError("verification.static must be an object");
  rejectUnknownFields(value, ["oxlint"], "verification.static");
  if (!isRecord(value.oxlint)) {
    throw new KilnYamlError("verification.static.oxlint must be an object");
  }
  rejectUnknownFields(value.oxlint, ["executable", "expectedVersion"], "verification.static.oxlint");
  if (typeof value.oxlint.executable !== "string" || value.oxlint.executable.trim().length === 0) {
    throw new KilnYamlError("verification.static.oxlint.executable must be a non-empty string");
  }
  if (typeof value.oxlint.expectedVersion !== "string" || !isCanonicalVersion(value.oxlint.expectedVersion)) {
    throw new KilnYamlError("verification.static.oxlint.expectedVersion must be a canonical version");
  }
}

function validateAbsolutePath(value: unknown, path: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || !isAbsolute(value)) {
    throw new KilnYamlError(`${path} must be an absolute path`);
  }
}

function isCanonicalVersion(value: string): boolean {
  return /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(value);
}
