import { describe, expect, it } from "vitest";
import { KILN_BENCHMARK_PROFILES, createBenchmarkProfileScorers } from "../../src/eval/index.js";
import {
  BOUNDED_IMPLEMENTATION_PROFILE_ID, BOUNDED_IMPLEMENTATION_SOURCE_PATH,
  BOUNDED_IMPLEMENTATION_VERIFIER_ID, BOUNDED_IMPLEMENTATION_VERIFIER_VERSION,
  hasPassedBoundedImplementationVerification, type BoundedImplementationVerification,
} from "../../src/eval/bounded-implementation.js";

const passed = {
  verifierId: BOUNDED_IMPLEMENTATION_VERIFIER_ID, verifierVersion: BOUNDED_IMPLEMENTATION_VERIFIER_VERSION,
  status: "passed", infrastructureFailure: false, violations: [],
  changes: { changed: [{ path: BOUNDED_IMPLEMENTATION_SOURCE_PATH, beforeHash: `sha256:${"a".repeat(64)}`, afterHash: `sha256:${"b".repeat(64)}` }], added: [], deleted: [] },
  tests: { status: "completed", exitCode: 0, passed: 8, failed: 0, timedOut: false },
} as const satisfies BoundedImplementationVerification;

describe("bounded implementation scoring", () => {
  it.each([
    ["absent evidence", undefined],
    ["solver claim", { status: "passed" }],
    ["old verifier", { ...passed, verifierVersion: "1" }],
    ["infrastructure failure", { ...passed, infrastructureFailure: true }],
    ["early exit", { ...passed, tests: { ...passed.tests, passed: 0 } }],
    ["skipped tests", { ...passed, tests: { status: "not-run", reason: "invalid-diff" } }],
    ["timeout", { ...passed, tests: { ...passed.tests, timedOut: true } }],
    ["extra file", { ...passed, changes: { ...passed.changes, added: [{ path: "extra.ts", hash: `sha256:${"c".repeat(64)}` }] } }],
    ["no source change", { ...passed, changes: { ...passed.changes, changed: [] } }],
  ])("rejects %s", (_label, value) => {
    expect(hasPassedBoundedImplementationVerification(value)).toBe(false);
  });

  it("scores observed verification without delegation, milestones or handoff claims", async () => {
    const profile = KILN_BENCHMARK_PROFILES.find((entry) => entry.id === BOUNDED_IMPLEMENTATION_PROFILE_ID);
    if (!profile) throw new Error("Missing bounded implementation profile");
    expect(profile.admissionScorers).toEqual(["bounded-implementation", "execution-integrity"]);
    const scorer = createBenchmarkProfileScorers(profile).find((entry) => entry.name === "bounded-implementation");
    if (!scorer) throw new Error("Missing bounded implementation scorer");
    expect(await scorer.score({ input: "implement", output: "src/normalize.ts", metadata: { observedVerification: passed } }))
      .toMatchObject({ score: 1 });
    expect(await scorer.score({ input: "implement", output: "all tests passed", metadata: { milestones: [{ completed: true }] } }))
      .toMatchObject({ score: 0 });
  });
});
