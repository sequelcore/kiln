import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { createInterface } from "node:readline/promises";
import { readGlobalConfig } from "../config/global-config.js";
import { observeDafnyInstallationDigest } from "../config/verification/dafny.js";
import { writeVerifierApproval } from "../config/verification/approval-store.js";
import type { VerifierSelection } from "../config/verification/selection-schema.js";

interface VerifierReviewDependencies {
  readonly readConfig: typeof readGlobalConfig;
  readonly observe: (selection: VerifierSelection) => string;
  readonly confirm: (selection: VerifierSelection, digest: string) => Promise<boolean>;
  readonly publish: typeof writeVerifierApproval;
}

/** Inspect bytes without executing unapproved code, then fence selection and bytes. */
export async function verifierCommand(
  args: readonly string[],
  overrides: Partial<VerifierReviewDependencies> = {},
): Promise<void> {
  const [action, verifier] = args;
  if (args.length !== 2 || action !== "review" || (verifier !== "dafny" && verifier !== "gentle-ai")) {
    throw new Error("Usage: kiln verifier review <dafny|gentle-ai>");
  }
  const dependencies = {
    readConfig: readGlobalConfig,
    observe: observeVerifier,
    confirm: confirmVerifier,
    publish: writeVerifierApproval,
    ...overrides,
  };
  const select = (): VerifierSelection => {
    const verification = dependencies.readConfig()?.verification;
    if (verifier === "dafny" && verification?.formal?.dafny) return { verifier, config: verification.formal.dafny };
    if (verifier === "gentle-ai" && verification?.inferential?.gentleAi)
      return { verifier, config: verification.inferential.gentleAi };
    throw new Error(`${verifier} is not configured.`);
  };
  const selection = select();
  const digest = dependencies.observe(selection);
  if (!(await dependencies.confirm(selection, digest))) return;
  if (!isDeepStrictEqual(select(), selection) || dependencies.observe(selection) !== digest) {
    throw new Error("Verifier selection or bytes changed during review; no approval recorded.");
  }
  dependencies.publish({ version: 1, selection, digest });
  console.log(`Approved ${verifier}. Restart the consuming Runtime to register the verifier after its version check.`);
}

function observeVerifier(selection: VerifierSelection): string {
  if (process.platform === "win32" && !/\.(?:exe|com)$/iu.test(selection.config.executable)) {
    throw new Error("Verifier must be a native executable, not a command shim.");
  }
  if (selection.verifier === "dafny") {
    return observeDafnyInstallationDigest(selection.config.installationRoot, selection.config.executable);
  }
  const stat = lstatSync(selection.config.executable);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Verifier must be a regular non-symbolic executable.");
  return `sha256:${createHash("sha256").update(readFileSync(selection.config.executable)).digest("hex")}`;
}

async function confirmVerifier(selection: VerifierSelection, digest: string): Promise<boolean> {
  console.log(`Review ${selection.verifier}\nSelection: ${JSON.stringify(selection.config)}\nDigest: ${digest}`);
  console.log("Approve only if you trust this installation's origin. Inspection has not executed it.");
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("Approval requires an interactive terminal. No approval recorded.");
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await terminal.question("Approve these exact verifier bytes? [y/N] ")).trim().toLowerCase() === "y";
  } finally {
    terminal.close();
  }
}
