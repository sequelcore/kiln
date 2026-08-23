import { isAbsolute } from "node:path";
import { KilnYamlError } from "../../../kiln-yaml.js";
import { isRecord, rejectUnknownFields } from "./shared.js";

export function validateGlobalVerification(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError("verification must be an object");
  rejectUnknownFields(value, ["formal"], "verification");
  if (!isRecord(value.formal)) throw new KilnYamlError("verification.formal must be an object");
  rejectUnknownFields(value.formal, ["dafny", "screening"], "verification.formal");
  if (!isRecord(value.formal.dafny)) {
    throw new KilnYamlError("verification.formal.dafny must be an object");
  }
  rejectUnknownFields(value.formal.dafny, ["executable", "expectedVersion"], "verification.formal.dafny");
  if (typeof value.formal.dafny.executable !== "string" || value.formal.dafny.executable.trim().length === 0) {
    throw new KilnYamlError("verification.formal.dafny.executable must be a non-empty string");
  }
  if (typeof value.formal.dafny.expectedVersion !== "string"
    || !isCanonicalDafnyVersion(value.formal.dafny.expectedVersion)) {
    throw new KilnYamlError("verification.formal.dafny.expectedVersion must be a canonical version");
  }
  const screening = value.formal.screening;
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
  validateAbsolutePath(
    screening.lemmaScript.packageRoot,
    "verification.formal.screening.lemmaScript.packageRoot",
  );
  validateAbsolutePath(
    screening.lemmaScript.entrypoint,
    "verification.formal.screening.lemmaScript.entrypoint",
  );
  if (typeof screening.lemmaScript.expectedVersion !== "string"
    || !isCanonicalDafnyVersion(screening.lemmaScript.expectedVersion)) {
    throw new KilnYamlError(
      "verification.formal.screening.lemmaScript.expectedVersion must be a canonical version",
    );
  }
}

function validateAbsolutePath(value: unknown, path: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || !isAbsolute(value)) {
    throw new KilnYamlError(`${path} must be an absolute path`);
  }
}

function isCanonicalDafnyVersion(value: string): boolean {
  return /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(value);
}
