import { createHash } from "node:crypto";
import type { AdmittedExecutionRoute, ContentPart, OperatorExecutionIntent, ProviderAdapter } from "@kilnai/core";
import type { OperatorTurnRequestedAuthority } from "@kilnai/gateway-contracts";
import { OperatorAuthorityAdmissionCoordinator } from "../execution-routing/operator-authority-admission-coordinator.js";
import { defineOperatorAuthorityAdmissionFacets, defineOperatorSkillCatalogAdmission } from "../execution-routing/operator-authority-admission-facets.js";
import {
  OperatorSessionExecutionRoutingService,
  type OperatorSessionExecutionCandidatePort,
  type OperatorSessionCredentialPort,
  type OperatorSessionExecutionCatalogSnapshot,
} from "../execution-routing/operator-session-execution-routing-service.js";
import type { ExecutionAccountCapacityAuthority } from "../execution-kernel/execution-account-capacity-authority.js";
import type { AuthorityAdmissionEvidenceStore } from "../session/authority-admission-evidence.js";
import { applyEffectiveAuthorityAdmissionBundleToPerCallConfig, type EffectiveAuthorityAdmissionBundle } from "../session/effective-authority-admission-bundle.js";
import { prepareOperatorAdoptionTurn, requireOperatorAdoptionDecisionPersistence, type OperatorAdoptionDecisionPersistence } from "../session/operator-adoption-authority.js";
import type { PerCallToolConfig } from "../session/runtime-session-orchestrator.types.js";
import type { ActionEffectEnvelope } from "@kilnai/core/engine";
import type { RuntimeSession } from "../session/runtime-session.js";
import type { RuntimeSessionTurnBudgetAuthority } from "../session/session-turn-budget-authority.js";
import type { SessionRegistry } from "../session/persistence/session-registry.js";

export interface GatewayAuthorityAdmissionRequest {
  readonly ingressId: string;
  readonly appName: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly channel: string;
  readonly userParts: readonly ContentPart[];
  /** Request attenuation only; it never creates authority. */
  readonly requestedAuthority?: OperatorTurnRequestedAuthority;
}

export interface GatewayAuthorityAdmissionCommit {
  readonly session: RuntimeSession;
  readonly bundle: EffectiveAuthorityAdmissionBundle;
  readonly perCallConfig: PerCallToolConfig;
  readonly provider: ProviderAdapter;
  readonly evidence: { readonly status: "persisted"; readonly sessionId: string; readonly admissionId: string };
}

/** Productive execution remains inside this callback for the full account-fence lifetime. */
export interface GatewayAuthorityAdmissionPort {
  execute<Result>(request: GatewayAuthorityAdmissionRequest, dispatch: (commit: GatewayAuthorityAdmissionCommit) => Promise<Result>): Promise<Result>;
}

export interface FixedRouteGatewayAuthorityAdmissionOptions<Credential> {
  readonly appName: string;
  readonly routeId: string;
  readonly snapshot: OperatorSessionExecutionCatalogSnapshot;
  readonly sessionRegistry: SessionRegistry;
  readonly candidates: OperatorSessionExecutionCandidatePort;
  readonly accountCapacityAuthority: ExecutionAccountCapacityAuthority;
  readonly credentials: OperatorSessionCredentialPort<Credential>;
  readonly evidenceStore: AuthorityAdmissionEvidenceStore;
  readonly persistOperatorAdoptionDecision: OperatorAdoptionDecisionPersistence;
  readonly createProvider: (input: { readonly credential: Credential; readonly admission: AdmittedExecutionRoute }) => ProviderAdapter | Promise<ProviderAdapter>;
  readonly sessionTurnBudget?: RuntimeSessionTurnBudgetAuthority;
  readonly now?: () => Date;
}

type PendingDispatch = (commit: GatewayAuthorityAdmissionCommit) => Promise<unknown>;
type PreparedGatewayAdmission = { readonly session: RuntimeSession; readonly perCallConfig: PerCallToolConfig };

/** Runtime-owned fixed-route composer for productive App Gateway ingress. */
export class FixedRouteGatewayAuthorityAdmission<Credential = unknown> implements GatewayAuthorityAdmissionPort {
  readonly #pending = new Map<string, PendingDispatch>();
  readonly #coordinator: OperatorAuthorityAdmissionCoordinator<GatewayAuthorityAdmissionRequest, PreparedGatewayAdmission>;
  readonly #routing: OperatorSessionExecutionRoutingService<Credential, GatewayAuthorityAdmissionRequest, unknown>;

  constructor(readonly options: FixedRouteGatewayAuthorityAdmissionOptions<Credential>) {
    const route = options.snapshot.catalog.routes.find((candidate) => candidate.id === options.routeId);
    if (!route) throw new Error(`App Gateway route '${options.routeId}' is unavailable.`);
    const matches = options.snapshot.catalog.routes.filter((candidate) => candidate.providerId === route.providerId && candidate.providerModelId === route.providerModelId);
    if (matches.length !== 1) throw new Error(`App Gateway provider/model ${route.providerId}/${route.providerModelId} must identify exactly one canonical route.`);
    this.#coordinator = new OperatorAuthorityAdmissionCoordinator({
      resolveSession: async ({ payload }) => {
        const session = await options.sessionRegistry.getById(payload.sessionId);
        if (!session || session.appName !== payload.appName || session.tenantId !== payload.tenantId || session.userId !== payload.userId || payload.appName !== options.appName) {
          throw new Error("App Gateway admission request does not identify its exact Runtime session.");
        }
        return { session, allowAuthorityFacetCreation: session.messageCount === 0 };
      },
      sessionTurnBudget: options.sessionTurnBudget,
      prepare: async ({ request, session, snapshot, binding }) => {
        const adoption = await prepareOperatorAdoptionTurn({
          session,
          actorId: request.payload.userId,
          correlationId: request.executionId,
          persist: requireOperatorAdoptionDecisionPersistence(options.persistOperatorAdoptionDecision),
        });
        const perCallConfig: PerCallToolConfig = {
          turnId: adoption.turnId,
          turnCorrelationId: adoption.correlationId,
          operatorAdoptionDecision: adoption.operatorAdoptionDecision,
          executionBinding: binding,
          runtimeConfigurationRevision: snapshot.configurationRevision,
          toolAllowlist: new Set(),
          toolAuthority: new Map(),
          perCallCapabilities: new Map(),
          additionalTools: [],
          effectiveTurnAuthority: {
            executionMode: "execute",
            requestedAuthority: request.payload.requestedAuthority ?? "auto",
            admittedAuthority: "fail_closed",
            sourcePolicy: "runtime_surface_projection",
            reason: "App Gateway has no canonical tool-authority policy; model-only execution is admitted.",
            completeness: "authoritative",
            toolCount: 0,
            deniedToolCount: 0,
            sandboxProjection: "read_only",
          },
        };
        return {
          facets: defineOperatorAuthorityAdmissionFacets({
            executionId: request.executionId,
            turnId: adoption.turnId,
            session,
            snapshot,
            perCallConfig,
            candidateToolNames: [],
            skillCatalog: defineOperatorSkillCatalogAdmission([]),
            authorityCeiling: { maximumAuthority: "read_only", reason: "App Gateway model-only session ceiling." },
            workGovernance: { status: "not-required" },
            operatorAdoption: { status: "admitted", decision: adoption.operatorAdoptionDecision },
            effectCeiling: gatewayTurnEffectCeiling(request.payload.channel),
          }),
          prepared: { session, perCallConfig },
        };
      },
      saveSession: (session) => options.sessionRegistry.save(session),
      evidenceStore: options.evidenceStore,
    });
    this.#routing = new OperatorSessionExecutionRoutingService({
      catalogSource: {
        capture: () => options.snapshot,
        activate: (captured) => {
          if (captured.configurationRevision.revisionSetId !== options.snapshot.configurationRevision.revisionSetId) throw new Error("App Gateway configuration revision changed during fixed-route admission.");
        },
      },
      candidates: options.candidates,
      accountCapacityAuthority: options.accountCapacityAuthority,
      credentials: options.credentials,
      authorityAdmission: this.#coordinator,
      dispatch: {
        dispatchCommittedTurn: async (committed) => {
          const dispatch = this.#pending.get(committed.executionId);
          if (!dispatch) throw new Error("App Gateway committed execution has no ingress dispatch owner.");
          const prepared = this.#coordinator.consume(committed.executionId, committed.authorityAdmission);
          const provider = await options.createProvider({ credential: committed.credential, admission: committed.admission });
          return dispatch({
            session: prepared.session,
            bundle: committed.authorityAdmission,
            perCallConfig: applyEffectiveAuthorityAdmissionBundleToPerCallConfig(committed.authorityAdmission, prepared.perCallConfig),
            provider,
            evidence: { status: "persisted", sessionId: committed.authorityAdmission.sessionId, admissionId: committed.authorityAdmission.admissionId },
          });
        },
      },
      now: options.now,
    });
  }

  async execute<Result>(request: GatewayAuthorityAdmissionRequest, dispatch: (commit: GatewayAuthorityAdmissionCommit) => Promise<Result>): Promise<Result> {
    if (this.#pending.has(request.ingressId)) throw new Error(`App Gateway ingress '${request.ingressId}' is already executing.`);
    this.#pending.set(request.ingressId, dispatch as PendingDispatch);
    try {
      const result = await this.#routing.execute({
        executionId: request.ingressId,
        intentFingerprint: fingerprintGatewayIntent({ routeId: this.options.routeId }),
        intent: { routeId: this.options.routeId },
        payload: request,
      });
      return result.result as Result;
    } finally {
      this.#pending.delete(request.ingressId);
    }
  }
}

const MESSAGING_CHANNELS = new Set(["email", "instagram", "messenger", "whatsapp"]);

function gatewayTurnEffectCeiling(channel: string): ActionEffectEnvelope {
  const externalMessage = MESSAGING_CHANNELS.has(channel);
  return {
    operation: "mutate",
    boundaries: externalMessage
      ? ["external-system", "network", "workspace"]
      : ["network", "workspace"],
    reversibility: "irreversible",
    dataEgress: "sensitive-data",
    identityUse: "authenticated",
    consequences: externalMessage ? ["external-state", "local-state"] : ["local-state"],
    idempotency: "non-idempotent",
  };
}

function fingerprintGatewayIntent(intent: OperatorExecutionIntent): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(intent), "utf8").digest("hex")}`;
}
