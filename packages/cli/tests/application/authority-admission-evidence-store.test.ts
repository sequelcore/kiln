import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defineEffectiveAuthorityAdmissionBundle,
  type EffectiveAuthorityAdmissionBundle,
} from "@kilnai/runtime";
import type { ActionEffectEnvelope, AuthorityDescriptor } from "@kilnai/core";
import { TranscriptStore } from "../../src/wrapper/session-store.js";
import { TranscriptAuthorityAdmissionEvidenceStore } from "../../src/application/authority-admission-evidence-store.js";

const READ_AUTHORITY: AuthorityDescriptor = { level: 1, allowed: true, requiresApproval: false, reason: "read-only" };
const READ_EFFECT: ActionEffectEnvelope = { operation: "observe", boundaries: ["workspace"], reversibility: "reversible", dataEgress: "none", identityUse: "none", consequences: ["local-state"], idempotency: "idempotent" };

function makeBundle(turnId = "turn-1", turnRevision = "r2", sessionRevision = "s1"): EffectiveAuthorityAdmissionBundle {
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: "session-1", turnId, admittedAt: "2026-08-22T18:00:00.000Z",
    configuration: {
      sessionRevision: { revisionSetId: `R-${sessionRevision}`, revisions: { skills: sessionRevision } },
      turnRevision: { revisionSetId: "R2", revisions: { routes: turnRevision } },
    },
    session: {
      skillCatalog: { catalogId: "operator", revision: "skills-r1", skillIds: ["research"] },
      authorityCeiling: { maximumAuthority: "audited", reason: "operator policy", subjectId: "session-1" },
    },
    turn: {
      authority: {
        executionMode: "execute", requestedAuthority: "audited", admittedAuthority: "audited",
        sourcePolicy: "runtime_surface_projection", reason: "admitted", completeness: "authoritative",
        toolCount: 1, deniedToolCount: 0, sandboxProjection: "workspace_write",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: { allowedToolPermissions: [{ toolName: "read_file", authority: READ_AUTHORITY, effectEnvelope: READ_EFFECT }], deniedToolNames: [] },
      effectCeiling: { operation: "observe", boundaries: ["workspace"], reversibility: "reversible", dataEgress: "metadata", identityUse: "none", consequences: ["local-state"], idempotency: "idempotent" },
      budget: { status: "not-configured" }, execution: { status: "not-routed" },
    },
  });
}

describe("TranscriptAuthorityAdmissionEvidenceStore", () => {
  it("persists the complete secret-free bundle and is idempotent by turn", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-admission-"));
    const transcriptStore = new TranscriptStore(root);
    const store = new TranscriptAuthorityAdmissionEvidenceStore(transcriptStore);
    const bundle = makeBundle();
    await store.persist(bundle);
    await store.persist(bundle);

    const facet = await store.loadSessionFacet("session-1");
    expect(facet).toMatchObject({
      sessionId: "session-1",
      sessionRevision: bundle.configuration.sessionRevision,
      skillCatalog: bundle.session.skillCatalog,
      authorityCeiling: bundle.session.authorityCeiling,
    });

    const records = await transcriptStore.readAuthorityAdmissions("session-1");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ sessionId: "session-1", turnId: "turn-1", admissionId: bundle.admissionId, bundle });
    const raw = await readFile(join(root, ".kiln", "sessions", encodeURIComponent("session-1"), "authority-admissions.jsonl"), "utf8");
    expect(raw).toContain("\"execution\":{\"status\":\"not-routed\"}");
    expect(raw).not.toMatch(/token|secret|password|workingDirectory/iu);
  });

  it("rejects a conflicting admission for an already admitted turn", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-admission-"));
    const store = new TranscriptAuthorityAdmissionEvidenceStore(new TranscriptStore(root));
    await store.persist(makeBundle());
    await expect(store.persist(makeBundle("turn-1"))).resolves.toBeUndefined();
    await expect(store.persist(makeBundle("turn-1", "r3"))).rejects.toThrow(/conflict|turn-1/iu);
  });

  it("serializes concurrent adapters sharing one session lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-admission-"));
    const first = new TranscriptAuthorityAdmissionEvidenceStore(new TranscriptStore(root));
    const second = new TranscriptAuthorityAdmissionEvidenceStore(new TranscriptStore(root));
    const bundle = makeBundle("turn-concurrent");
    await expect(Promise.all([first.persist(bundle), second.persist(bundle)])).resolves.toEqual([undefined, undefined]);
    expect(await new TranscriptStore(root).readAuthorityAdmissions("session-1")).toHaveLength(1);
  });

  it("rejects conflicting logical-session facets across different turns", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-admission-"));
    const store = new TranscriptAuthorityAdmissionEvidenceStore(new TranscriptStore(root));
    await store.persist(makeBundle("turn-1"));
    await expect(store.persist(makeBundle("turn-2", "r3", "s2"))).rejects.toThrow(/conflicting session facets/iu);
  });

  it("fails closed when the transcript evidence file is malformed", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-admission-"));
    const transcriptStore = new TranscriptStore(root);
    const dir = join(root, ".kiln", "sessions", encodeURIComponent("session-1"));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "authority-admissions.jsonl"), "not-json\n", "utf8");
    await expect(new TranscriptAuthorityAdmissionEvidenceStore(transcriptStore).persist(makeBundle())).rejects.toThrow(/JSON|malformed|evidence/iu);
    await expect(new TranscriptAuthorityAdmissionEvidenceStore(transcriptStore).loadSessionFacet("session-1")).rejects.toThrow(/JSON|malformed|evidence/iu);
  });
});
