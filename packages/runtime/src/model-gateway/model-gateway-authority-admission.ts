import { createHash } from "node:crypto";
import type {
  ActionEffectEnvelope,
  EffectiveTurnAuthoritySnapshot,
  ExecutionCatalog,
  ModelTurn,
} from "@kilnai/core";
import {
  defineEffectiveAuthorityAdmissionBundle,
  type CallerOwnedToolContractAdmission,
  type SkillCatalogAdmission,
} from "../session/effective-authority-admission-bundle.js";
import type { RuntimeConfigurationRevisionSnapshot } from "../session/runtime-configuration-revision-pin.js";
import type { GovernedOneRoundAuthorityAdmissionPort, GovernedOneRoundInvocationInput } from "../execution-kernel/governed-one-round-invocation.js";
import { evaluateExecutionTargetDataPolicy } from "../execution-routing/execution-route-data-policy-authority.js";

export interface ModelGatewayAuthorityAdmissionOptions {
  readonly executionCatalog: ExecutionCatalog;
  readonly configurationRevision: RuntimeConfigurationRevisionSnapshot;
  readonly skillCatalog?: SkillCatalogAdmission;
  readonly now?: () => Date;
}

/**
 * Composes the model ingress' one authority value.  Model Gateway is a
 * caller-owned, one-round surface: it admits no Kiln-executable tools and
 * therefore never invents a synthetic tool permission.  Caller tool schemas
 * remain bound as an exact, secret-free contract facet.
 */
export function createModelGatewayAuthorityAdmissionPort(
  options: ModelGatewayAuthorityAdmissionOptions,
): GovernedOneRoundAuthorityAdmissionPort {
  const now = options.now ?? (() => new Date());
  const skillCatalog = options.skillCatalog ?? defaultSkillCatalog(options.configurationRevision);
  return {
    compose: async (input) => {
      const route = options.executionCatalog.routes.find(({ id }) => id === input.admission.routeId);
      if (!route) throw new Error(`Execution route '${input.admission.routeId}' is unavailable.`);
      const dataPolicy = evaluateExecutionTargetDataPolicy({
        routeId: input.admission.routeId,
        providerId: input.admission.providerId,
        providerModelId: input.admission.providerModelId,
        requestedClassification: route.dataClassification,
        evidence: route.dataPolicyEvidence,
        now: now(),
      });
      if (dataPolicy.decision.status !== "admitted") {
        throw new Error(`Execution route data policy denied execution: ${dataPolicy.decision.reason}.`);
      }
      const authority = modelGatewayAuthority(input.invocation);
      const effectCeiling = observeOnlyEffectCeiling();
      const bundleInput = {
        sessionId: input.invocation.identity.sessionId,
        turnId: input.invocation.identity.turnId,
        admittedAt: now().toISOString(),
        configuration: {
          sessionRevision: options.configurationRevision,
          turnRevision: options.configurationRevision,
        },
        session: {
          skillCatalog,
          authorityCeiling: {
            maximumAuthority: "read_only" as const,
            reason: "Model Gateway admits caller-owned tools only; Kiln executes no tool effects at this boundary.",
          },
        },
        turn: {
          authority,
          workGovernance: { status: "not-required" as const },
          operatorAdoption: { status: "not-required" as const },
          tools: {
            allowedToolPermissions: [],
            deniedToolNames: [],
            callerOwnedToolContract: callerOwnedToolContractForTurn(input.invocation.turn),
          },
          effectCeiling,
          budget: input.budget,
          execution: {
            status: "routed" as const,
            route: input.admission,
            dataPolicy,
            binding: input.binding,
          },
        },
      } satisfies Parameters<typeof defineEffectiveAuthorityAdmissionBundle>[0];
      return defineEffectiveAuthorityAdmissionBundle(bundleInput);
    },
  };
}

export function callerOwnedToolContractForTurn(turn: ModelTurn): CallerOwnedToolContractAdmission {
  const tools = turn.tools ?? [];
  const names = [...new Set(tools.map((tool) => "namespace" in tool && tool.namespace !== undefined ? `${tool.namespace}:${tool.name}` : tool.name))].sort(compareCodeUnits);
  return Object.freeze({
    names: Object.freeze(names),
    digest: `sha256:${createHash("sha256").update(stableStringify(tools), "utf8").digest("hex")}`,
  });
}

function modelGatewayAuthority(input: GovernedOneRoundInvocationInput): EffectiveTurnAuthoritySnapshot {
  return Object.freeze({
    executionMode: "execute",
    requestedAuthority: "read_only",
    admittedAuthority: "read_only",
    sourcePolicy: "runtime_surface_projection",
    reason: `Caller-owned model ingress admitted capability ${input.authority.capabilityId}.`,
    completeness: "authoritative",
    toolCount: 0,
    deniedToolCount: 0,
    sandboxProjection: "none",
    policyInputs: Object.freeze([{
      source: "route_policy" as const,
      status: "applied" as const,
      reason: "Model Gateway does not execute caller-owned tools inside Kiln.",
      requestedAuthority: "read_only" as const,
      admittedAuthority: "read_only" as const,
    }]),
  });
}

function observeOnlyEffectCeiling(): ActionEffectEnvelope {
  return {
    operation: "observe",
    boundaries: [],
    reversibility: "reversible",
    dataEgress: "none",
    identityUse: "none",
    consequences: [],
    idempotency: "idempotent",
  };
}

function defaultSkillCatalog(revision: RuntimeConfigurationRevisionSnapshot): SkillCatalogAdmission {
  const skillIds: readonly string[] = Object.freeze([]);
  return Object.freeze({
    catalogId: "model-gateway-caller-owned",
    revision: `sha256:${createHash("sha256").update(stableStringify({ revision, skillIds }), "utf8").digest("hex")}`,
    skillIds,
  });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => compareCodeUnits(left, right)).map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
