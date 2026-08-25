import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  assertBoundHostToolSandbox,
  createBoundHostToolSandbox,
  SandboxPolicy,
} from "../../src/sandbox/index.js";

const DIGEST = `sha256:${"a".repeat(64)}` as const;

describe("bound host tool sandbox", () => {
  it("creates immutable secret-free evidence for the exact policy", () => {
    const root = resolve("/tmp/kiln-bound-host-sandbox");
    const sandbox = createBoundHostToolSandbox({
      policy: new SandboxPolicy({
        projectPath: root,
        config: {
          fsPolicy: "read-write",
          netPolicy: "none",
          allowedPaths: [root],
          deniedPaths: [],
          allowedDomains: [],
        },
      }),
      leaseId: "lease:test",
      configurationRevisionId: DIGEST,
      permissionPolicyDigest: DIGEST,
    });

    expect(assertBoundHostToolSandbox(sandbox)).toBe(sandbox);
    expect(sandbox.admission).toMatchObject({
      schemaRevision: 1,
      leaseId: "lease:test",
      configurationRevisionId: DIGEST,
      permissionPolicyDigest: DIGEST,
      fsPolicy: "read-write",
      netPolicy: "none",
      allowedPathCount: 1,
      allowedDomainCount: 0,
    });
    expect(JSON.stringify(sandbox.admission)).not.toContain(root);
    expect(Object.isFrozen(sandbox)).toBe(true);
    expect(Object.isFrozen(sandbox.policy.config)).toBe(true);
  });

  it("rejects a structurally identical counterfeit", () => {
    const root = resolve("/tmp/kiln-bound-host-sandbox");
    const policy = new SandboxPolicy({
      projectPath: root,
      config: {
        fsPolicy: "read-write",
        netPolicy: "none",
        allowedPaths: [root],
        deniedPaths: [],
        allowedDomains: [],
      },
    });
    const real = createBoundHostToolSandbox({
      policy,
      leaseId: "lease:test",
      configurationRevisionId: DIGEST,
      permissionPolicyDigest: DIGEST,
    });

    expect(() => assertBoundHostToolSandbox({ policy, admission: real.admission })).toThrow(/bound host tool sandbox/iu);
  });
});
