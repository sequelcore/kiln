import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { randomUUID } from "node:crypto";
import {
  BOUNDED_IMPLEMENTATION_FIXTURE,
  BOUNDED_IMPLEMENTATION_SOURCE_PATH,
  BOUNDED_IMPLEMENTATION_TEST_COUNT,
  BOUNDED_IMPLEMENTATION_VERIFIER_ID,
  BOUNDED_IMPLEMENTATION_VERIFIER_VERSION,
  type BoundedImplementationVerification,
} from "@kilnai/core/eval";
import type { BenchmarkWriteWorkspaceChanges, BenchmarkWriteWorkspaceLease } from "./benchmark-write-workspace.js";
import { buildContainerVerifierArgs, CONTAINER_VERIFIER_RUNNER, NODE_VERIFIER_IMAGE, type ContainerVerifierRunner } from "./benchmarks/container-verifier-runner.js";


export function isContextEfficiencyBoundedImplementationFixture(workspaceFixture: unknown): boolean {
  return workspaceFixture === BOUNDED_IMPLEMENTATION_FIXTURE;
}

export async function assertBoundedImplementationVerifierAvailable(
  runner: ContainerVerifierRunner = CONTAINER_VERIFIER_RUNNER,
): Promise<void> {
  const name = `kiln-bounded-verifier-preflight-${randomUUID()}`;
  try {
    const result = await runner.run(name, buildContainerVerifierArgs({
      name, image: NODE_VERIFIER_IMAGE, mounts: [], command: ["node", "--version"],
    }));
    if (result.infrastructureFailure || result.timedOut || result.exitCode !== 0 || result.stdout.trim() !== "v24.15.0") {
      throw new Error("Bounded implementation requires the pinned Node verifier container before model dispatch.");
    }
  } finally {
    await runner.cleanup(name);
  }
}

/** The evaluator owns test execution; candidate code never executes on the host. */
export async function verifyContextEfficiencyBoundedImplementationLease(input: {
  readonly lease: BenchmarkWriteWorkspaceLease;
  readonly runner?: ContainerVerifierRunner;
}): Promise<BoundedImplementationVerification> {
  const changes = input.lease.collectChanges();
  const violations = validateAllowedChanges(changes);
  const identity = {
    verifierId: BOUNDED_IMPLEMENTATION_VERIFIER_ID,
    verifierVersion: BOUNDED_IMPLEMENTATION_VERIFIER_VERSION,
  } as const;
  if (violations.length > 0) {
    return { ...identity, status: "failed", infrastructureFailure: false, changes, violations,
      tests: { status: "not-run", reason: "invalid-diff" } };
  }
  const runner = input.runner ?? CONTAINER_VERIFIER_RUNNER;
  const name = `kiln-bounded-verifier-${randomUUID()}`;
  try {
    const cases = Value.Parse(VerificationCasesSchema, JSON.parse(readFileSync(join(input.lease.rootPath, "verification/cases.json"), "utf8")));
    let passed = 0;
    let timedOut = false;
    let infrastructureFailure = false;
    let exitCode = 0;
    for (const testCase of cases) {
      const result = await runner.run(name, buildContainerVerifierArgs({
        name, image: NODE_VERIFIER_IMAGE,
        mounts: [{ source: join(input.lease.rootPath, BOUNDED_IMPLEMENTATION_SOURCE_PATH), target: "/candidate.ts" }],
        command: ["node", "--experimental-vm-modules", "--input-type=module", "--eval", CASE_RUNNER, JSON.stringify(testCase.input)],
      }));
      timedOut = result.timedOut;
      infrastructureFailure = result.infrastructureFailure;
      exitCode = result.exitCode;
      if (timedOut || infrastructureFailure || exitCode !== 0) break;
      let output: unknown;
      try { output = JSON.parse(result.stdout); } catch { break; }
      if (!Value.Check(CaseResultSchema, output) || output.kind !== testCase.expected.kind) break;
      if (output.kind === "returned" && testCase.expected.kind === "returned"
        ? output.value !== testCase.expected.value
        : output.kind !== "threw" || testCase.expected.kind !== "threw"
          || !output.message.includes(testCase.expected.message)) break;
      passed += 1;
    }
    const after = input.lease.collectChanges();
    input.lease.verifyCanonicalUnchanged();
    const finalViolations = JSON.stringify(changes) === JSON.stringify(after)
      ? [] : ["Workspace changed during verification."];
    const failed = cases.length - passed;
    return {
      ...identity,
      status: !infrastructureFailure && !timedOut && exitCode === 0
        && passed === BOUNDED_IMPLEMENTATION_TEST_COUNT && failed === 0 && finalViolations.length === 0 ? "passed" : "failed",
      infrastructureFailure,
      changes: after,
      violations: finalViolations,
      tests: { status: "completed", exitCode, passed, failed, timedOut },
    };
  } finally {
    await runner.cleanup(name);
  }
}

function validateAllowedChanges(changes: BenchmarkWriteWorkspaceChanges): readonly string[] {
  return changes.changed.length === 1 && changes.changed[0]?.path === BOUNDED_IMPLEMENTATION_SOURCE_PATH
    && changes.added.length === 0 && changes.deleted.length === 0
    ? [] : ["Bounded implementation requires modifying only the existing src/normalize.ts source file."];
}

const CaseResultSchema = Type.Union([
  Type.Object({ kind: Type.Literal("returned"), value: Type.String() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("threw"), message: Type.String() }, { additionalProperties: false }),
]);
const VerificationCasesSchema = Type.Array(
  Type.Object({ input: Type.String(), expected: CaseResultSchema }, { additionalProperties: false }),
  { minItems: BOUNDED_IMPLEMENTATION_TEST_COUNT, maxItems: BOUNDED_IMPLEMENTATION_TEST_COUNT },
);
// Docker contains effects; this context restricts the fixture to synchronous,
// import-free TypeScript and keeps completion output out of candidate globals.
const CASE_RUNNER = `
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createContext, SourceTextModule, Script } from 'node:vm';
const source = readFileSync('/candidate.ts', 'utf8');
if (Buffer.byteLength(source) > 65536) throw new Error('Candidate source exceeds 64 KiB');
const context = createContext(Object.create(null), {
  codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate',
});
new Script('delete globalThis.console;').runInContext(context, { timeout: 1000 });
const module = new SourceTextModule(stripTypeScriptTypes(source), { context,
  importModuleDynamically: () => { throw 'Dynamic imports are unsupported'; },
});
if (module.dependencySpecifiers.length) throw new Error('Imports are unsupported');
await module.link(() => { throw 'Imports are unsupported'; });
await module.evaluate({ timeout: 1000 });
if (Object.keys(module.namespace).join(',') !== 'normalizeRelativeSourcePath'
  || typeof module.namespace.normalizeRelativeSourcePath !== 'function') throw new Error('Expected the named function export');
Object.defineProperty(context, '__candidate', { value: module.namespace.normalizeRelativeSourcePath });
Object.defineProperty(context, '__input', { value: JSON.parse(process.argv.at(-1)) });
const output = new Script(\`(() => {
  try {
    const value = __candidate(__input);
    return typeof value === 'string' ? 'returned:' + value : null;
  } catch (error) {
    const message = error?.message;
    return typeof message === 'string' ? 'threw:' + message : null;
  }
})()\`).runInContext(context, { timeout: 1000 });
if (typeof output !== 'string' || output.length > 4096) throw new Error('Invalid function result');
const separator = output.indexOf(':');
const kind = output.slice(0, separator);
const value = output.slice(separator + 1);
process.stdout.write(JSON.stringify(kind === 'returned' ? { kind, value } : { kind, message: value }));
`;