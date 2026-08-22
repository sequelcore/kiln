import type { ProviderAdapter } from "@kilnai/core/agents";
import { canonicalTurnId, createOperatorAdoptionDecisionAuthority } from "@kilnai/core/events";
import { defineEffectiveAuthorityAdmissionBundle, applyEffectiveAuthorityAdmissionBundleToPerCallConfig } from "../../src/session/effective-authority-admission-bundle.js";
import type { GatewayAuthorityAdmissionPort } from "../../src/gateway/gateway-authority-admission.js";
import type { SessionRegistry } from "../../src/session/persistence/session-registry.js";

/** A complete, bundle-owned admission used by route tests. */
export function makeGatewayTestAdmission(
  sessionRegistry: SessionRegistry,
  provider: ProviderAdapter = { name: "gateway-test", createMessage: async () => ({ parts: [], inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, toolCalls: [] }), streamMessage: async function* () {} },
): GatewayAuthorityAdmissionPort {
  return {
    async execute(request, dispatch) {
      const session = await sessionRegistry.getById(request.sessionId)
        ?? await sessionRegistry.get(request.appName, request.userId, request.tenantId);
      if (!session || session.appName !== request.appName || session.tenantId !== request.tenantId || session.userId !== request.userId) {
        throw new Error("Gateway test admission requires the exact RuntimeSession identified by the request.");
      }
      const turnId = canonicalTurnId(session.id, session.userTurnCount + 1);
      const revision = { revisionSetId: "gateway-test", revisions: { execution: "gateway-test" } } as const;
      const bundle = defineEffectiveAuthorityAdmissionBundle({
        sessionId: session.id,
        turnId,
        admittedAt: "2026-08-22T18:00:00.000Z",
        configuration: { sessionRevision: revision, turnRevision: revision },
        session: {
          skillCatalog: { catalogId: "gateway-test", revision: "gateway-test", skillIds: [] },
          authorityCeiling: { maximumAuthority: "read_only", reason: "gateway route test", subjectId: session.id },
        },
        turn: {
          authority: {
            executionMode: "execute", requestedAuthority: "read_only", admittedAuthority: "fail_closed",
            sourcePolicy: "runtime_surface_projection", reason: "Gateway route test has no admitted tools.",
            completeness: "authoritative", toolCount: 0, deniedToolCount: 0, sandboxProjection: "read_only",
          },
          workGovernance: { status: "not-required" },
          operatorAdoption: {
            status: "admitted",
            decision: createOperatorAdoptionDecisionAuthority({ ownerSessionId: session.id, operatorTurnId: turnId, actorId: request.userId }),
          },
          tools: { allowedToolPermissions: [], deniedToolNames: [] },
          effectCeiling: { operation: "observe", boundaries: [], reversibility: "reversible", dataEgress: "none", identityUse: "none", consequences: [], idempotency: "idempotent" },
          budget: { status: "not-configured" },
          execution: { status: "routed", route: { routeId: "gateway-test", providerId: provider.name, providerModelId: provider.name, accountSelection: { mode: "exact", accountId: "gateway-test", source: "route" } }, dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "gateway test" } }, binding: { status: "bound", routeId: "gateway-test", accountId: "gateway-test", credentialId: "gateway-test", credentialRevision: "gateway-test" } },
        },
      });
      const perCallConfig = applyEffectiveAuthorityAdmissionBundleToPerCallConfig(bundle, { turnId, toolAllowlist: new Set(), toolAuthority: new Map(), perCallCapabilities: new Map() });
      return dispatch({ session, bundle, perCallConfig, provider, evidence: { status: "persisted", sessionId: bundle.sessionId, admissionId: bundle.admissionId } });
    },
  };
}
