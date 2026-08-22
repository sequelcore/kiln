import {
  assertPersistableAuthorityAdmissionBundle,
  type AuthorityAdmissionEvidenceStore,
  type EffectiveAuthorityAdmissionBundle,
  defineRuntimeSessionAuthorityFacet,
  type RuntimeSessionAuthorityFacet,
} from '@kilnai/runtime';
import { withConfigMutationLock } from './config-mutation-lock.js';
import {
  TranscriptStore,
  type PersistedAuthorityAdmissionRecord,
} from '../wrapper/session-store.js';

/**
 * Physical CLI adapter for Runtime authority evidence. The Runtime contract
 * remains mandatory and fail-closed; this adapter only owns the CLI transcript
 * filesystem and its per-session commit lock.
 */
export class TranscriptAuthorityAdmissionEvidenceStore implements AuthorityAdmissionEvidenceStore {
  constructor(private readonly transcriptStore: TranscriptStore) {}

  async persist(bundle: EffectiveAuthorityAdmissionBundle): Promise<void> {
    const admitted = assertPersistableAuthorityAdmissionBundle(bundle);
    const record: PersistedAuthorityAdmissionRecord = {
      schemaRevision: 1,
      sessionId: admitted.sessionId,
      turnId: admitted.turnId,
      admissionId: admitted.admissionId,
      bundle: admitted,
    };
    await withConfigMutationLock(
      this.transcriptStore.authorityAdmissionLockPath(admitted.sessionId),
      () => this.transcriptStore.appendAuthorityAdmission(record),
      { waitMs: 5_000 },
    );
  }

  async loadSessionFacet(sessionId: string): Promise<RuntimeSessionAuthorityFacet | undefined> {
    const records = await this.transcriptStore.readAuthorityAdmissions(sessionId);
    let admittedFacet: RuntimeSessionAuthorityFacet | undefined;
    for (const record of records) {
      const facet = defineRuntimeSessionAuthorityFacet({
        sessionId: record.bundle.sessionId,
        sessionRevision: record.bundle.configuration.sessionRevision,
        ...record.bundle.session,
      });
      if (admittedFacet && admittedFacet.facetId !== facet.facetId) {
        throw new Error(`Authority admission evidence contains conflicting session facets for "${sessionId}".`);
      }
      admittedFacet = facet;
    }
    return admittedFacet;
  }
}
