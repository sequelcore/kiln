import type { ProviderAdapter } from "@kilnai/core/agents";
import type { ActionEffectEnvelope, AuthorityDescriptor } from "@kilnai/core/engine";
import {
  type RuntimeModelRoundActionClaim,
  type RuntimeModelRoundActionClaimPermit,
  type RuntimeModelRoundActionClaimStore,
  type RuntimeModelRoundDispatchContext,
  runtimeModelRoundEffectIdentity,
} from "../../src/execution-kernel/runtime-model-round-action-claim.js";
import type {
  RuntimeToolActionClaim,
  RuntimeToolActionClaimPermit,
  RuntimeToolActionClaimStore,
  RuntimeToolActionClaimsContext,
} from "../../src/execution-kernel/runtime-tool-action-claim.js";
import {
  defineEffectiveAuthorityAdmissionBundle,
  type EffectiveAuthorityAdmissionBundle,
} from "../../src/session/effective-authority-admission-bundle.js";
import type { RuntimeSession } from "../../src/session/runtime-session.js";
import type { PerCallToolConfig } from "../../src/session/runtime-session-orchestrator.types.js";

export const FIXTURE_READ_ONLY_EFFECT: ActionEffectEnvelope = {
  operation: "observe",
  boundaries: ["external-system"],
  reversibility: "reversible",
  dataEgress: "metadata",
  identityUse: "authenticated",
  consequences: [],
  idempotency: "idempotent",
};

export interface FixtureToolPermission {
  readonly toolName: string;
  readonly effectEnvelope?: ActionEffectEnvelope;
  readonly authority?: AuthorityDescriptor;
}

export function createFixtureModelRoundStore(): RuntimeModelRoundActionClaimStore {
  const rows = new Map<string, RuntimeModelRoundActionClaim>();
  const consumed = new WeakSet<object>();
  return {
    claim(claim) {
      if (rows.has(claim.claimId)) throw new Error("Fixture model-round claim already exists; no redispatch.");
      const permit = {
        claimId: claim.claimId,
        permitId: `fixture-model-round:${claim.claimId}`,
        consume: () => {
          if (consumed.has(permit)) throw new Error("Fixture model-round permit already consumed.");
          consumed.add(permit);
        },
      } as unknown as RuntimeModelRoundActionClaimPermit;
      rows.set(claim.claimId, claim);
      return permit;
    },
    settle(permit, settlement) {
      const claim = rows.get(permit.claimId);
      if (!claim || !consumed.has(permit)) throw new Error("Fixture model-round permit was not consumed.");
      rows.set(permit.claimId, {
        ...claim,
        status: settlement.kind === "success" ? "settled" : "unknown",
        ...(settlement.kind === "success"
          ? { outcome: "success" as const }
          : { outcome: "unknown" as const, unknownReason: settlement.reason }),
        ...(settlement.settledAt ? { settledAt: settlement.settledAt } : {}),
      });
    },
  };
}

export function createFixtureToolActionStore(): RuntimeToolActionClaimStore {
  const rows = new Map<string, RuntimeToolActionClaim>();
  const consumed = new WeakSet<object>();
  return {
    claim(claim) {
      if (rows.has(claim.claimId)) throw new Error("Fixture tool-action claim already exists; no redispatch.");
      const permit = {
        claimId: claim.claimId,
        permitId: `fixture-tool-action:${claim.claimId}`,
        consume: () => {
          if (consumed.has(permit)) throw new Error("Fixture tool-action permit already consumed.");
          consumed.add(permit);
        },
      } as unknown as RuntimeToolActionClaimPermit;
      rows.set(claim.claimId, claim);
      return permit;
    },
    settle(permit, settlement) {
      const claim = rows.get(permit.claimId);
      if (!claim || !consumed.has(permit)) throw new Error("Fixture tool-action permit was not consumed.");
      rows.set(permit.claimId, {
        ...claim,
        status: settlement.kind === "success" ? "settled" : "unknown",
        ...(settlement.kind === "success" ? { outcome: "success" as const } : { unknownReason: settlement.reason }),
        ...(settlement.settledAt ? { settledAt: settlement.settledAt } : {}),
      });
    },
  };
}

function fixtureModelIdentity(
  provider: ProviderAdapter,
  model: string | undefined,
): {
  readonly providerId: string;
  readonly providerModelId: string;
} {
  return {
    providerId: provider.name,
    providerModelId: model?.trim() || "unknown",
  };
}

export function createFixtureAdmission(input: {
  readonly session: RuntimeSession;
  readonly turnId: string;
  readonly provider: ProviderAdapter;
  readonly model?: string;
  readonly toolPermissions?: readonly FixtureToolPermission[];
}): EffectiveAuthorityAdmissionBundle {
  const { providerId, providerModelId } = fixtureModelIdentity(input.provider, input.model);
  const toolPermissions = [...(input.toolPermissions ?? [])]
    .map((permission) => ({
      toolName: permission.toolName,
      effectEnvelope: permission.effectEnvelope ?? FIXTURE_READ_ONLY_EFFECT,
      authority: permission.authority ?? {
        level: 1,
        allowed: true,
        requiresApproval: false,
        reason: "Fixture admission explicitly allows this tool.",
      },
    }))
    .sort((left, right) => left.toolName.localeCompare(right.toolName));
  const allowedToolPermissions = toolPermissions.filter(
    (permission) => permission.authority.allowed || permission.authority.requiresApproval,
  );
  const deniedToolNames = toolPermissions
    .filter((permission) => !permission.authority.allowed && !permission.authority.requiresApproval)
    .map((permission) => permission.toolName);
  const admittedAuthority =
    allowedToolPermissions.length > 0
      ? allowedToolPermissions.some((permission) => permission.authority.level >= 4)
        ? ("destructive" as const)
        : allowedToolPermissions.some((permission) => permission.authority.level >= 3)
          ? ("audited" as const)
          : ("read_only" as const)
      : ("fail_closed" as const);
  const effectCeiling =
    allowedToolPermissions.length > 0
      ? allowedToolPermissions.reduce(
          (effect, permission) =>
            ({
              operation:
                effect.operation === "mutate" || permission.effectEnvelope.operation === "mutate"
                  ? "mutate"
                  : "observe",
              boundaries: [...new Set([...effect.boundaries, ...permission.effectEnvelope.boundaries])],
              reversibility:
                effect.reversibility === "irreversible" || permission.effectEnvelope.reversibility === "irreversible"
                  ? "irreversible"
                  : "reversible",
              dataEgress:
                effect.dataEgress === "sensitive-data" || permission.effectEnvelope.dataEgress === "sensitive-data"
                  ? "sensitive-data"
                  : effect.dataEgress === "project-data" || permission.effectEnvelope.dataEgress === "project-data"
                    ? "project-data"
                    : effect.dataEgress === "metadata" || permission.effectEnvelope.dataEgress === "metadata"
                      ? "metadata"
                      : "none",
              identityUse:
                effect.identityUse === "privileged" || permission.effectEnvelope.identityUse === "privileged"
                  ? "privileged"
                  : effect.identityUse === "authenticated" || permission.effectEnvelope.identityUse === "authenticated"
                    ? "authenticated"
                    : "none",
              consequences: [...new Set([...effect.consequences, ...permission.effectEnvelope.consequences])],
              idempotency:
                effect.idempotency === "non-idempotent" || permission.effectEnvelope.idempotency === "non-idempotent"
                  ? "non-idempotent"
                  : effect.idempotency === "conditionally-idempotent" ||
                      permission.effectEnvelope.idempotency === "conditionally-idempotent"
                    ? "conditionally-idempotent"
                    : "idempotent",
            }) satisfies ActionEffectEnvelope,
          allowedToolPermissions[0]!.effectEnvelope,
        )
      : {
          operation: "observe" as const,
          boundaries: [],
          reversibility: "reversible" as const,
          dataEgress: "none" as const,
          identityUse: "none" as const,
          consequences: [],
          idempotency: "idempotent" as const,
        };
  const revision = {
    revisionSetId: `sha256:${"2".repeat(64)}`,
    revisions: {
      fixture: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `sha256:${string}`,
    },
  } as const;
  const routeId = "runtime-fixture-route";
  const accountId = "runtime-fixture-account";
  const credentialRevision = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: input.session.id,
    turnId: input.turnId,
    admittedAt: "2026-08-22T00:00:00.000Z",
    configuration: { sessionRevision: revision, turnRevision: revision },
    session: {
      skillCatalog: {
        catalogId: "runtime-fixture",
        revision: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        skillIds: [],
      },
      authorityCeiling: {
        maximumAuthority:
          admittedAuthority === "destructive"
            ? "destructive"
            : admittedAuthority === "audited"
              ? "audited"
              : "read_only",
        reason: "Fixture admission ceiling",
        subjectId: input.session.id,
      },
    },
    turn: {
      authority: {
        executionMode: "execute",
        requestedAuthority: admittedAuthority === "fail_closed" ? "read_only" : admittedAuthority,
        admittedAuthority,
        sourcePolicy: "runtime_surface_projection",
        reason: "Fixture admission is persisted before dispatch.",
        completeness: "authoritative",
        toolCount: allowedToolPermissions.length,
        deniedToolCount: deniedToolNames.length,
        sandboxProjection: "read_only",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: { allowedToolPermissions, deniedToolNames },
      effectCeiling,
      budget: { status: "not-configured" },
      execution: {
        status: "routed",
        route: {
          routeId,
          providerId,
          providerModelId,
          accountSelection: { mode: "exact", accountId, source: "route" },
        },
        dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "policy-admitted" } },
        binding: {
          status: "bound",
          routeId,
          accountId,
          credentialId: "runtime-fixture-credential",
          credentialRevision,
        },
      },
    },
  });
}

export function createFixtureClaimConfig(input: {
  readonly session: RuntimeSession;
  readonly provider: ProviderAdapter;
  readonly model?: string;
  readonly turnId?: string;
  readonly toolPermissions?: readonly FixtureToolPermission[];
  readonly includeToolClaims?: boolean;
}): PerCallToolConfig {
  const turnId = input.turnId ?? `${input.session.id}:turn:${Math.max(input.session.userTurnCount + 1, 1)}`;
  const admission = createFixtureAdmission({ ...input, turnId });
  const modelStore = createFixtureModelRoundStore();
  const route = admission.turn.execution.status === "routed" ? admission.turn.execution : undefined;
  if (!route) throw new Error("Fixture admission must be routed.");
  const modelRound: RuntimeModelRoundDispatchContext = {
    admission,
    intentFingerprint: runtimeModelRoundEffectIdentity({
      fixture: "runtime-model-round",
      sessionId: input.session.id,
      turnId,
    }),
    attemptId: `runtime-fixture-attempt:${input.session.id}:${turnId}`,
    routeId: route.route.routeId,
    accountId: route.binding.accountId,
    credentialRevision: route.binding.credentialRevision,
    readAdmission: async () => admission,
    store: modelStore,
    state: { claimed: false },
  };
  const config: PerCallToolConfig = {
    turnCorrelationId: turnId,
    authorityAdmission: admission,
    runtimeModelRoundDispatch: modelRound,
  };
  if (input.includeToolClaims) {
    const toolStore = createFixtureToolActionStore();
    const toolClaims: RuntimeToolActionClaimsContext = {
      admission,
      attemptId: modelRound.attemptId,
      adapterIdentity: "runtime-fixture-adapter",
      readAdmission: async () => admission,
      store: toolStore,
      state: { claimed: false },
    };
    return {
      ...config,
      runtimeToolActionClaims: toolClaims,
    };
  }
  return config;
}

export function createFixtureToolPermission(
  toolName: string,
  effectEnvelope: ActionEffectEnvelope = FIXTURE_READ_ONLY_EFFECT,
  authority: AuthorityDescriptor = {
    level: 1,
    allowed: true,
    requiresApproval: false,
    reason: "Fixture admission explicitly allows this tool.",
  },
): FixtureToolPermission {
  const hasUnknownDimension =
    effectEnvelope.reversibility === "unknown" ||
    effectEnvelope.dataEgress === "unknown" ||
    effectEnvelope.identityUse === "unknown" ||
    effectEnvelope.idempotency === "unknown" ||
    effectEnvelope.consequences.includes("unknown");
  return { toolName, effectEnvelope: hasUnknownDimension ? FIXTURE_READ_ONLY_EFFECT : effectEnvelope, authority };
}
