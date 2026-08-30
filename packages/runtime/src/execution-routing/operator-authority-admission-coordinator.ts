import type { SessionTurnBudgetDecision } from "@kilnai/core";
import { isValidNarrowing } from "@kilnai/core/engine";
import {
  assertRuntimeCapabilityAuthorityCandidateProjection,
  type RuntimeCapabilityAuthorityCandidateProjection,
} from "../capabilities/runtime-capability-composition.js";
import type { AuthorityAdmissionEvidenceStore } from "../session/authority-admission-evidence.js";
import {
  assertPersistableAuthorityAdmissionBundle,
} from "../session/authority-admission-evidence.js";
import type {
  EffectiveAuthorityAdmissionBundle,
  TurnBudgetAdmission,
} from "../session/effective-authority-admission-bundle.js";
import {
  defineRuntimeSessionAuthorityFacet,
} from "../session/runtime-session-authority-facet.js";
import type { RuntimeSession } from "../session/runtime-session.js";
import type { RuntimeSessionTurnBudgetAuthority } from "../session/session-turn-budget-authority.js";
import type {
  OperatorSessionAuthorityAdmissionFacets,
  OperatorSessionAuthorityAdmissionPort,
  OperatorSessionExecutionRequest,
} from "./operator-session-execution-routing-service.js";

export interface OperatorAuthorityAdmissionSessionResolution {
  readonly session: RuntimeSession;
  /** True only when this boundary created an empty logical session for authority admission. */
  readonly allowAuthorityFacetCreation: boolean;
}

export interface OperatorAuthorityAdmissionCoordinatorOptions<Payload, Prepared> {
  readonly resolveSession: (
    request: OperatorSessionExecutionRequest<Payload>,
  ) => OperatorAuthorityAdmissionSessionResolution | Promise<OperatorAuthorityAdmissionSessionResolution>;
  readonly sessionTurnBudget?: RuntimeSessionTurnBudgetAuthority;
  readonly prepare: (
    input: Parameters<OperatorSessionAuthorityAdmissionPort<Payload>["prepare"]>[0] & {
      readonly session: RuntimeSession;
    },
  ) => {
    readonly facets: OperatorSessionAuthorityAdmissionFacets;
    readonly prepared: Prepared;
    /** Complete public candidate projection captured before bundle computation. */
    readonly capabilityCandidateProjection?: RuntimeCapabilityAuthorityCandidateProjection;
  } | Promise<{
    readonly facets: OperatorSessionAuthorityAdmissionFacets;
    readonly prepared: Prepared;
    readonly capabilityCandidateProjection?: RuntimeCapabilityAuthorityCandidateProjection;
  }>;
  readonly saveSession: (session: RuntimeSession) => void | Promise<void>;
  readonly evidenceStore: AuthorityAdmissionEvidenceStore;
  readonly discardPrepared?: (prepared: Prepared) => void | Promise<void>;
}

type AdmissionState<Payload, Prepared> = {
  readonly request: OperatorSessionExecutionRequest<Payload>;
  readonly session: RuntimeSession;
  readonly allowAuthorityFacetCreation: boolean;
  readonly budget: TurnBudgetAdmission;
  phase: "reserved" | "prepared" | "persisted";
  facets?: OperatorSessionAuthorityAdmissionFacets;
  prepared?: Prepared;
  capabilityCandidateProjection?: RuntimeCapabilityAuthorityCandidateProjection;
  admissionId?: string;
  sessionSaved?: boolean;
};

/** Runtime-owned one-shot authority admission lifecycle for operator turns. */
export class OperatorAuthorityAdmissionCoordinator<Payload, Prepared>
implements OperatorSessionAuthorityAdmissionPort<Payload> {
  readonly #states = new Map<string, AdmissionState<Payload, Prepared>>();
  readonly #executionIdsByTurnId = new Map<string, string>();

  constructor(readonly options: OperatorAuthorityAdmissionCoordinatorOptions<Payload, Prepared>) {}

  async preflight(input: {
    readonly request: OperatorSessionExecutionRequest<Payload>;
  }): Promise<TurnBudgetAdmission> {
    const executionId = input.request.executionId;
    if (this.#states.has(executionId)) throw new Error(`Authority admission ${executionId} is already reserved.`);
    const placeholder = {} as AdmissionState<Payload, Prepared>;
    this.#states.set(executionId, placeholder);
    try {
      const resolution = await this.options.resolveSession(input.request);
      if (!resolution.session.runtimeSessionAuthorityFacet) {
        const persistedFacet = await this.options.evidenceStore.loadSessionFacet(resolution.session.id);
        if (persistedFacet) resolution.session.bindRuntimeSessionAuthorityFacet(persistedFacet);
      }
      const budget = this.options.sessionTurnBudget
        ? admittedBudget(await this.options.sessionTurnBudget.admit(resolution.session.id))
        : { status: "not-configured" as const };
      this.#states.set(executionId, {
        request: input.request,
        session: resolution.session,
        allowAuthorityFacetCreation: resolution.allowAuthorityFacetCreation,
        budget,
        phase: "reserved",
      });
      return budget;
    } catch (error) {
      this.#states.delete(executionId);
      throw error;
    }
  }

  async prepare(
    input: Parameters<OperatorSessionAuthorityAdmissionPort<Payload>["prepare"]>[0],
  ): Promise<OperatorSessionAuthorityAdmissionFacets> {
    const state = this.#requireState(input.request.executionId, "reserved");
    if (input.request !== state.request) {
      throw new Error("Authority preparation request does not match the reserved execution request.");
    }
    const result = await this.options.prepare({ ...input, session: state.session });
    state.prepared = result.prepared;
    state.capabilityCandidateProjection = result.capabilityCandidateProjection === undefined
      ? undefined
      : assertRuntimeCapabilityAuthorityCandidateProjection(result.capabilityCandidateProjection);
    try {
      if (result.facets.sessionId !== state.session.id) {
        throw new Error("Prepared authority facets do not belong to the reserved Runtime session.");
      }
      const existingExecutionId = this.#executionIdsByTurnId.get(result.facets.turnId);
      if (existingExecutionId && existingExecutionId !== input.request.executionId) {
        throw new Error(`Canonical authority turn ${result.facets.turnId} is already reserved.`);
      }
      const proposedFacet = defineRuntimeSessionAuthorityFacet({
        sessionId: result.facets.sessionId,
        sessionRevision: result.facets.sessionRevision,
        ...result.facets.session,
      });
      const existingFacet = state.session.runtimeSessionAuthorityFacet;
      if (!existingFacet) {
        const emptyNonAuthoritySession = state.session.messageCount === 0
          && state.session.runtimeConfigurationRevision === undefined;
        if ((!state.allowAuthorityFacetCreation && !emptyNonAuthoritySession) || state.session.messageCount > 0) {
          throw new Error("A legacy or history-bearing Runtime session cannot become an authority source.");
        }
        state.session.bindRuntimeSessionAuthorityFacet(proposedFacet);
      } else if (existingFacet.facetId !== proposedFacet.facetId) {
        throw new Error("Prepared authority facets do not match the persisted Runtime session authority facet.");
      }
      state.facets = result.facets;
      state.phase = "prepared";
      this.#executionIdsByTurnId.set(result.facets.turnId, input.request.executionId);
    return state.capabilityCandidateProjection === undefined
      ? result.facets
      : { ...result.facets, capabilityCandidateProjection: state.capabilityCandidateProjection };
    } catch (error) {
      this.#states.delete(input.request.executionId);
      await this.options.discardPrepared?.(result.prepared);
      throw error;
    }
  }

  async persist(bundle: EffectiveAuthorityAdmissionBundle): Promise<void> {
    const executionId = this.#executionIdsByTurnId.get(bundle.turnId);
    if (!executionId) throw new Error(`Authority admission for canonical turn ${bundle.turnId} is not prepared.`);
    const state = this.#requireState(executionId, "prepared");
    const admitted = assertPersistableAuthorityAdmissionBundle(bundle);
    validateCapabilityAdmissionProjection(admitted, state.capabilityCandidateProjection);
    if (admitted.sessionId !== state.session.id
      || JSON.stringify(admitted.turn.budget) !== JSON.stringify(state.budget)) {
      throw new Error("Persisted authority bundle does not match its reserved session and budget admission.");
    }
    const expectedFacet = defineRuntimeSessionAuthorityFacet({
      sessionId: admitted.sessionId,
      sessionRevision: admitted.configuration.sessionRevision,
      ...admitted.session,
    });
    if (state.session.runtimeSessionAuthorityFacet?.facetId !== expectedFacet.facetId) {
      throw new Error("Persisted authority bundle does not match the Runtime session authority facet.");
    }
    if (!state.sessionSaved) {
      await this.options.saveSession(state.session);
      state.sessionSaved = true;
    }
    await this.options.evidenceStore.persist(admitted);
    state.admissionId = admitted.admissionId;
    state.phase = "persisted";
  }

  consume(executionId: string, bundle: EffectiveAuthorityAdmissionBundle): Prepared {
    const state = this.#requireState(executionId, "persisted");
    const admitted = assertPersistableAuthorityAdmissionBundle(bundle);
    if (state.admissionId !== admitted.admissionId
      || admitted.turnId !== state.facets?.turnId
      || admitted.sessionId !== state.session.id) {
      throw new Error("Committed authority bundle does not match the persisted admission reservation.");
    }
    if (state.prepared === undefined) throw new Error("Persisted authority admission is missing its prepared dispatch value.");
    this.#states.delete(executionId);
    this.#executionIdsByTurnId.delete(admitted.turnId);
    return state.prepared;
  }

  async abort(executionId: string): Promise<void> {
    const state = this.#states.get(executionId);
    this.#states.delete(executionId);
    if (state?.facets) this.#executionIdsByTurnId.delete(state.facets.turnId);
    if (state?.prepared !== undefined) await this.options.discardPrepared?.(state.prepared);
  }

  #requireState(executionId: string, phase: AdmissionState<Payload, Prepared>["phase"]): AdmissionState<Payload, Prepared> {
    const state = this.#states.get(executionId);
    if (!state || state.phase !== phase) throw new Error(`Authority admission ${executionId} is not ${phase}.`);
    return state;
  }
}

function validateCapabilityAdmissionProjection(
  bundle: EffectiveAuthorityAdmissionBundle,
  projection: RuntimeCapabilityAuthorityCandidateProjection | undefined,
): void {
  const participation = bundle.turn.capabilityParticipation;
  if (participation.status === "not-requested") {
    if (projection !== undefined) {
      throw new Error("A not-requested capability admission cannot carry a candidate projection.");
    }
    return;
  }
  if (projection === undefined) {
    throw new Error("A generation-linked capability admission requires its prepared candidate projection.");
  }
  if (projection.generationId !== participation.generationId
    || projection.catalogDigest !== participation.catalogDigest
    || projection.candidateProjectionDigest !== participation.candidateProjectionDigest
    || projection.surfaceDigest !== participation.surfaceDigest
    || projection.caller !== participation.caller) {
    throw new Error("Prepared capability candidate projection does not match the authority admission linkage.");
  }
  const allowedByName = new Map(bundle.turn.tools.allowedToolPermissions.map((entry) => [entry.toolName, entry] as const));
  const admittedNames = new Set([
    ...allowedByName.keys(),
    ...bundle.turn.tools.deniedToolNames,
  ]);
  for (const toolName of projection.discoveryToolNames) {
    if (!admittedNames.has(toolName)) {
      throw new Error(`Capability discovery tool "${toolName}" is omitted from the authority allowlist projection.`);
    }
  }
  for (const candidate of projection.candidates) {
    if (candidate.toolName === undefined) continue;
    if (!admittedNames.has(candidate.toolName)) {
      throw new Error(`Capability candidate tool "${candidate.toolName}" is omitted from the authority allowlist projection.`);
    }
    const permission = allowedByName.get(candidate.toolName);
    if (permission !== undefined && !isValidNarrowing(candidate.effect, permission.effectEnvelope)) {
      throw new Error(`Capability candidate tool "${candidate.toolName}" exceeds its admitted effect ceiling.`);
    }
  }
}

function admittedBudget(decision: SessionTurnBudgetDecision): TurnBudgetAdmission {
  if (decision.status !== "admitted") {
    throw new Error(`Session turn budget denied execution: ${decision.reason}.`);
  }
  return { status: "admitted", reason: decision.reason, observation: decision.observation };
}
