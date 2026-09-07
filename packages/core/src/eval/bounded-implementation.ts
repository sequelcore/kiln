export const BOUNDED_IMPLEMENTATION_PROFILE_ID = "kiln-bounded-implementation";
export const BOUNDED_IMPLEMENTATION_FIXTURE =
  "packages/core/evals/fixtures/context-efficiency-post-fix-v1/bounded-implementation";
export const BOUNDED_IMPLEMENTATION_VERIFIER_ID = "kiln.context-efficiency.bounded-implementation.v1";
export const BOUNDED_IMPLEMENTATION_VERIFIER_VERSION = "2";
export const BOUNDED_IMPLEMENTATION_SOURCE_PATH = "src/normalize.ts";
export const BOUNDED_IMPLEMENTATION_TEST_COUNT = 8;

export interface BoundedImplementationVerification {
  readonly verifierId: typeof BOUNDED_IMPLEMENTATION_VERIFIER_ID;
  readonly verifierVersion: typeof BOUNDED_IMPLEMENTATION_VERIFIER_VERSION;
  readonly status: "passed" | "failed";
  readonly infrastructureFailure: boolean;
  readonly changes: {
    readonly changed: readonly { readonly path: string; readonly beforeHash: string; readonly afterHash: string }[];
    readonly added: readonly { readonly path: string; readonly hash: string }[];
    readonly deleted: readonly { readonly path: string; readonly hash: string }[];
  };
  readonly violations: readonly string[];
  readonly tests:
    | { readonly status: "not-run"; readonly reason: "invalid-diff" }
    | {
        readonly status: "completed";
        readonly exitCode: number;
        readonly passed: number;
        readonly failed: number;
        readonly timedOut: boolean;
      };
}

/** Accepts execution-owned observations, never solver claims or expected dataset metadata. */
export function hasPassedBoundedImplementationVerification(value: unknown): boolean {
  if (
    !isRecord(value) ||
    value.verifierId !== BOUNDED_IMPLEMENTATION_VERIFIER_ID ||
    value.verifierVersion !== BOUNDED_IMPLEMENTATION_VERIFIER_VERSION ||
    value.status !== "passed" ||
    value.infrastructureFailure !== false ||
    !Array.isArray(value.violations) ||
    value.violations.length !== 0
  )
    return false;
  const tests = value.tests;
  const changes = value.changes;
  if (
    !isRecord(tests) ||
    tests.status !== "completed" ||
    tests.exitCode !== 0 ||
    tests.passed !== BOUNDED_IMPLEMENTATION_TEST_COUNT ||
    tests.failed !== 0 ||
    tests.timedOut !== false ||
    !isRecord(changes) ||
    !Array.isArray(changes.changed) ||
    changes.changed.length !== 1 ||
    !Array.isArray(changes.added) ||
    changes.added.length !== 0 ||
    !Array.isArray(changes.deleted) ||
    changes.deleted.length !== 0
  )
    return false;
  const source: unknown = changes.changed[0];
  return (
    isRecord(source) &&
    source.path === BOUNDED_IMPLEMENTATION_SOURCE_PATH &&
    typeof source.beforeHash === "string" &&
    /^sha256:[a-f0-9]{64}$/u.test(source.beforeHash) &&
    typeof source.afterHash === "string" &&
    /^sha256:[a-f0-9]{64}$/u.test(source.afterHash) &&
    source.beforeHash !== source.afterHash
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
