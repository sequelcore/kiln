import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readTrustedExecutionAuthorization } from "../../src/security/trusted-execution-authorization-store.js";
import {
  finalizeTrustedExecutionGrant,
  planTrustedExecutionGrant,
  revokeTrustedExecutionGrant,
} from "../../src/security/trusted-execution-grant.js";

const dirs: string[] = [];
function setup() {
  const base = mkdtempSync(join(tmpdir(), "kiln-trust-grant-"));
  dirs.push(base);
  return { base, project: join(base, "project") };
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const confirmation = { approved: true, operatorId: "operator:test", authorizedAt: "2026-08-06T00:00:00.000Z" };

describe("trusted execution grant", () => {
  it("plans from restricted by default and requires the project basename for full access", () => {
    const { base, project } = setup();
    const plan = planTrustedExecutionGrant({
      harness: "claude-code",
      projectPath: project,
      requestedProfile: "trusted-full-access",
      baseDir: base,
    });
    expect(plan).toMatchObject({
      currentProfile: "restricted",
      confirmationKind: "typed-basename",
      basename: "project",
      enforcement: { approvalControl: "enforced", strength: "rules-only" },
    });
  });
  it("persists authorized and narrowed results but not rejected results", () => {
    const { base, project } = setup();
    const plan = planTrustedExecutionGrant({
      harness: "codex",
      projectPath: project,
      requestedProfile: "trusted-full-access",
      baseDir: base,
    });
    expect(finalizeTrustedExecutionGrant(plan, confirmation, base).status).toBe("authorized");
    expect(readTrustedExecutionAuthorization("codex", project, base)?.profile).toBe("trusted-full-access");
    const denied = finalizeTrustedExecutionGrant(plan, { ...confirmation, approved: false }, base);
    expect(denied.status).toBe("rejected");
  });
  it("does not persist revoking a project with no grant", () => {
    const { base, project } = setup();
    const result = revokeTrustedExecutionGrant("opencode", project, confirmation, base);
    expect(result).toMatchObject({ hadExistingGrant: false, authorization: { status: "narrowed" } });
    expect(readTrustedExecutionAuthorization("opencode", project, base)).toBeUndefined();
  });
  it("narrows and persists an existing grant on revoke", () => {
    const { base, project } = setup();
    const plan = planTrustedExecutionGrant({
      harness: "codex",
      projectPath: project,
      requestedProfile: "trusted-full-access",
      baseDir: base,
    });
    finalizeTrustedExecutionGrant(plan, confirmation, base);
    expect(revokeTrustedExecutionGrant("codex", project, confirmation, base).hadExistingGrant).toBe(true);
    expect(readTrustedExecutionAuthorization("codex", project, base)).toMatchObject({
      profile: "restricted",
      authorization: { status: "narrowed" },
    });
  });
});
