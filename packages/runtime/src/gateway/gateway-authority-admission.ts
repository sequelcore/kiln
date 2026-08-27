import { createHash } from "node:crypto";
import type { AdmittedExecutionTarget, ContentPart, OperatorExecutionIntent, ProviderAdapter } from "@kilnai/core";
import type { OperatorTurnRequestedAuthority } from "@kilnai/gateway-contracts";
import { OperatorAuthorityAdmissionCoordinator } from "../execution-routing/operator-authority-admission-coordinator.js";
import { defineOperatorAuthorityAdmissionFacets, defineOperatorSkillCatalogAdmission } from "../execution-routing/operator-authority-admission-facets.js";
import {
  OperatorSessionExecutionRoutingService,
  type OperatorSessionExecutionCandidatePort,
  type OperatorSessionCredentialPort,
  type OperatorSessionExecutionTargetCatalogSnapshot,
} from "../execution-routing/operator-session-execution-routing-service.js";
import type { ExecutionAccountCapacityAuthority } from "../execution-kernel/execution-account-capacity-authority.js";
import type { AuthorityAdmissionEvidenceStore } from "../session/authority-admission-evidence.js";
import type { EffectiveAuthorityAdmissionBundle } from "../session/effective-authority-admission-bundle.js";
import { prepareOperatorAdoptionTurn, requireOperatorAdoptionDecisionPersistence, type OperatorAdoptionDecisionPersistence } from "../session/operator-adoption-authority.js";
import type {
  PerCallToolConfig,
  RuntimeAuthorityAdmissionCandidateConfig,
} from "../session/runtime-session-orchestrator.types.js";
import type { ActionEffectEnvelope } from "@kilnai/core/engine";
import type { RuntimeSession } from "../session/runtime-session.js";
import type { RuntimeSessionTurnBudgetAuthority } from "../session/session-turn-budget-authority.js";
import type { SessionRegistry } from "../session/persistence/session-registry.js";
import type {
  RuntimeModelRoundActionClaimStore,
  RuntimeModelRoundDispatchContext,
} from "../execution-kernel/runtime-model-round-action-claim.js";
import { readRuntimeModelRoundAdmission } from "../execution-kernel/runtime-model-round-action-claim.js";
import type { RuntimeToolActionClaimStore, RuntimeToolActionClaimsContext } from "../execution-kernel/runtime-tool-action-claim.js";
import type { ChannelEgressActionClaimContext } from "../channels/channel-egress-action-claim.js";
import type { RuntimeMediaActionClaimContext } from "../execution-kernel/runtime-media-action-claim.js";

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
  readonly runtimeModelRoundDispatch: RuntimeModelRoundDispatchContext;
  readonly runtimeToolActionClaims: RuntimeToolActionClaimsContext;
  readonly runtimeMediaActionClaims: RuntimeMediaActionClaimContext;
  readonly evidence: { readonly status: "persisted"; readonly sessionId: string; readonly admissionId: string };
}

/** Productive execution remains inside this callback for the full account-fence lifetime. */
export interface GatewayAuthorityAdmissionPort {
  /** Mandatory workload-local durable owner for consequential channel sends. */
  readonly channelEgressActionClaims: ChannelEgressActionClaimContext;
  execute<Result>(request: GatewayAuthorityAdmissionRequest, dispatch: (commit: GatewayAuthorityAdmissionCommit) => Promise<Result>): Promise<Result>;
}

export interface FixedTargetGatewayAuthorityAdmissionOptions<Credential> {
  readonly appName: string;
  readonly targetId: string;
  readonly snapshot: OperatorSessionExecutionTargetCatalogSnapshot;
  readonly sessionRegistry: SessionRegistry;
  readonly candidates: OperatorSessionExecutionCandidatePort;
  readonly accountCapacityAuthority: ExecutionAccountCapacityAuthority;
  readonly credentials: OperatorSessionCredentialPort<Credential>;
  readonly evidenceStore: AuthorityAdmissionEvidenceStore;
  /** Separate durable action-claim owner for App Gateway model rounds. */
  readonly modelRoundActionClaims: RuntimeModelRoundActionClaimStore;
  /** Separate durable action-claim owner for App Gateway tool/MCP effects. */
  readonly toolActionClaims: RuntimeToolActionClaimStore;
  /** Separate durable action-claim owner for App Gateway channel egress. */
  readonly channelEgressActionClaims: ChannelEgressActionClaimContext;
  /** Separate durable action-claim owner for App Gateway media effects. */
  readonly runtimeMediaActionClaims: RuntimeMediaActionClaimContext;
  readonly persistOperatorAdoptionDecision: OperatorAdoptionDecisionPersistence;
  readonly createProvider: (input: { readonly credential: Credential; readonly admission: AdmittedExecutionTarget }) => ProviderAdapter | Promise<ProviderAdapter>;
  readonly sessionTurnBudget?: RuntimeSessionTurnBudgetAuthority;
  readonly now?: () => Date;
}

type PendingDispatch = (commit: GatewayAuthorityAdmissionCommit) => Promise<unknown>;
type PreparedGatewayAdmission = { readonly session: RuntimeSession; readonly perCallConfig: RuntimeAuthorityAdmissionCandidateConfig };

/** Runtime-owned fixed-target composer for productive App Gateway ingress. */
export class FixedTargetGatewayAuthorityAdmission<Credential = unknown> implements GatewayAuthorityAdmissionPort {
  readonly channelEgressActionClaims: ChannelEgressActionClaimContext;
  readonly runtimeMediaActionClaims: RuntimeMediaActionClaimContext;
  readonly #pending = new Map<string, PendingDispatch>();
  readonly #coordinator: OperatorAuthorityAdmissionCoordinator<GatewayAuthorityAdmissionRequest, PreparedGatewayAdmission>;
  readonly #routing: OperatorSessionExecutionRoutingService<Credential, GatewayAuthorityAdmissionRequest, unknown>;

  constructor(readonly options: FixedTargetGatewayAuthorityAdmissionOptions<Credential>) {
    this.channelEgressActionClaims = options.channelEgressActionClaims;
    this.runtimeMediaActionClaims = options.runtimeMediaActionClaims;
    const target = options.snapshot.catalog.targets.find((candidate) => candidate.id === options.targetId);
    if (!target) throw new Error(`App Gateway target '${options.targetId}' is unavailable.`);
    const matches = options.snapshot.catalog.targets.filter((candidate) => candidate.providerId === target.providerId && candidate.providerModelId === target.providerModelId);
    if (matches.length !== 1) throw new Error(`App Gateway provider/model ${target.providerId}/${target.providerModelId} must identify exactly one canonical target.`);
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
        const perCallConfig: RuntimeAuthorityAdmissionCandidateConfig = {
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
          const readAdmission = options.evidenceStore.readAdmission;
          if (!readAdmission) throw new Error("App Gateway has no durable admission readback for model-round claiming.");
          const bundle = await readRuntimeModelRoundAdmission({
            readAdmission: (request) => readAdmission.call(options.evidenceStore, request),
            admissionId: committed.authorityAdmission.admissionId,
            sessionId: committed.authorityAdmission.sessionId,
            turnId: committed.authorityAdmission.turnId,
            expected: {
              routeId: committed.binding.routeId,
              accountId: committed.binding.accountId,
              credentialRevision: committed.binding.credentialRevision,
            },
          });
          const runtimeModelRoundDispatch: RuntimeModelRoundDispatchContext = {
            admission: bundle,
            intentFingerprint: fingerprintGatewayIntent({ targetId: this.options.targetId }),
            attemptId: committed.executionId,
            routeId: committed.binding.routeId,
            accountId: committed.binding.accountId,
            credentialRevision: committed.binding.credentialRevision,
            readAdmission: () => readRuntimeModelRoundAdmission({
              readAdmission: (request) => readAdmission.call(options.evidenceStore, request),
              admissionId: bundle.admissionId,
              sessionId: bundle.sessionId,
              turnId: bundle.turnId,
              expected: {
                routeId: committed.binding.routeId,
                accountId: committed.binding.accountId,
                credentialRevision: committed.binding.credentialRevision,
              },
            }),
            store: options.modelRoundActionClaims,
            state: { claimed: false },
          };
          const runtimeToolActionClaims: RuntimeToolActionClaimsContext = {
            admission: bundle,
            attemptId: committed.executionId,
            adapterIdentity: `app-gateway:${committed.binding.routeId}:${committed.binding.accountId}:${committed.binding.credentialRevision}`,
            readAdmission: (request) => readRuntimeModelRoundAdmission({
              readAdmission: (readRequest) => readAdmission.call(options.evidenceStore, readRequest),
              admissionId: request.admissionId,
              sessionId: request.sessionId,
              turnId: request.turnId,
              expected: {
                routeId: committed.binding.routeId,
                accountId: committed.binding.accountId,
                credentialRevision: committed.binding.credentialRevision,
              },
            }),
            store: options.toolActionClaims,
            state: { claimed: false },
          };
          const {
            turnId: _candidateTurnId,
            operatorAdoptionDecision: _candidateAdoptionDecision,
            executionBinding: _candidateExecutionBinding,
            admittedExecutionTarget: _candidateExecutionTarget,
            toolAllowlist: _candidateToolAllowlist,
            toolAuthority: _candidateToolAuthority,
            effectiveTurnAuthority: _candidateTurnAuthority,
            runtimeConfigurationRevision: _candidateConfigurationRevision,
            ...admittedExecutionConfig
          } = prepared.perCallConfig;
          return dispatch({
            session: prepared.session,
            bundle,
            // The persisted bundle is the sole committed authority source.
            // Candidate authority fields are removed at this boundary rather
            // than being carried as a second, potentially conflicting source.
            perCallConfig: {
              ...admittedExecutionConfig,
              authorityAdmission: bundle,
            },
            provider,
            runtimeModelRoundDispatch,
            runtimeToolActionClaims,
            runtimeMediaActionClaims: this.runtimeMediaActionClaims,
            evidence: { status: "persisted", sessionId: bundle.sessionId, admissionId: bundle.admissionId },
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
        intentFingerprint: fingerprintGatewayIntent({ targetId: this.options.targetId }),
        intent: { targetId: this.options.targetId },
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

function fingerprintGatewayIntent(intent: OperatorExecutionIntent): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(intent), "utf8").digest("hex")}`;
}
