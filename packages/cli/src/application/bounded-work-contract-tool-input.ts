import type {
  BoundedWorkAdoptionAuthority,
  BoundedWorkContract,
  BoundedWorkHarnessCapability,
} from "@kilnai/core";
import { adoptBoundedWorkContractRevision } from "@kilnai/core";
import type { KilnWorkGovernanceConfig } from "../kiln-yaml-types.js";
import {
  assertExactKeys,
  hasExactKeys,
  isRecord,
  readText,
  requireInputArray,
  requireInputRecord,
} from "./work-governance-tool-input.js";

export function boundedWorkContractSchema(): Record<string, unknown> {
  const boundedWorkEffects = [
    "inspect",
    "modify_source",
    "modify_tests",
    "modify_documentation",
    "modify_configuration",
    "run_verification",
    "invoke_managed_agent",
    "external_write",
  ] as const;
  const changeAuthorities = ["none", "scoped", "unrestricted"] as const;
  return {
    type: "object",
    properties: {
      schema: { type: "string", const: "kiln.bounded-work-contract/v2" },
      intent: {
        type: "object",
        properties: {
          objective: { type: "string", minLength: 1 },
          acceptanceCriteria: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                id: { type: "string", minLength: 1 },
                statement: { type: "string", minLength: 1 },
              },
              required: ["id", "statement"],
              additionalProperties: false,
            },
          },
          nonGoals: { type: "array", items: { type: "string", minLength: 1 } },
        },
        required: ["objective", "acceptanceCriteria", "nonGoals"],
        additionalProperties: false,
      },
      assurance: {
        type: "object",
        properties: {
          formalVerification: {
            type: "object",
            properties: {
              semantics: { type: "string", const: "allOf" },
              obligations: {
                type: "array",
                minItems: 1,
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", minLength: 1 },
                    symbol: { type: "string", minLength: 1 },
                    subjectPaths: {
                      type: "array",
                      minItems: 1,
                      items: { type: "string", minLength: 1 },
                    },
                  },
                  required: ["id", "symbol", "subjectPaths"],
                  additionalProperties: false,
                },
              },
              mappings: {
                type: "array",
                minItems: 1,
                items: {
                  type: "object",
                  properties: {
                    criterionId: { type: "string", minLength: 1 },
                    obligationIds: {
                      type: "array",
                      minItems: 1,
                      items: { type: "string", minLength: 1 },
                    },
                  },
                  required: ["criterionId", "obligationIds"],
                  additionalProperties: false,
                },
              },
            },
            required: ["semantics", "obligations", "mappings"],
            additionalProperties: false,
          },
        },
        required: ["formalVerification"],
        additionalProperties: false,
      },
      scope: {
        type: "object",
        properties: {
          allowedWorkItemIds: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
          permittedEffects: { type: "array", minItems: 1, items: { type: "string", enum: boundedWorkEffects } },
          permittedSurfaces: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
          allowedRoots: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
          deniedRoots: { type: "array", items: { type: "string", minLength: 1 } },
          refactorAuthority: { type: "string", enum: changeAuthorities },
          migrationAuthority: { type: "string", enum: changeAuthorities },
          dependencyAuthority: { type: "string", enum: changeAuthorities },
        },
        required: [
          "allowedWorkItemIds",
          "permittedEffects",
          "permittedSurfaces",
          "allowedRoots",
          "deniedRoots",
          "refactorAuthority",
          "migrationAuthority",
          "dependencyAuthority",
        ],
        additionalProperties: false,
      },
      limits: {
        type: "object",
        properties: {
          maxExecutionAttempts: { type: "integer", minimum: 1 },
          maxManagedInvocations: { type: "integer", minimum: 0 },
          maxConcurrentManagedInvocations: { type: "integer", minimum: 0 },
          maxChildDepth: { type: "integer", minimum: 0 },
          maxReviewRounds: { type: "integer", minimum: 0 },
          maxRemediationRounds: { type: "integer", minimum: 0 },
        },
        required: [
          "maxExecutionAttempts",
          "maxManagedInvocations",
          "maxConcurrentManagedInvocations",
          "maxChildDepth",
          "maxReviewRounds",
          "maxRemediationRounds",
        ],
        additionalProperties: false,
      },
      tripwires: {
        type: "object",
        properties: {
          changedFiles: { type: "integer", minimum: 1 },
          changedLines: { type: "integer", minimum: 1 },
          activeDurationMs: { type: "integer", minimum: 1 },
          toolCalls: { type: "integer", minimum: 1 },
        },
        additionalProperties: false,
      },
      policy: {
        type: "object",
        properties: {
          scopeExpansion: { type: "string", enum: ["deny", "approval_required"] },
          budgetExhaustion: { type: "string", enum: ["pause", "stop"] },
          minimumHarnessCapability: {
            type: "string",
            enum: ["authoritative", "partially_enforced", "advisory_only"],
          },
        },
        required: ["scopeExpansion", "budgetExhaustion", "minimumHarnessCapability"],
        additionalProperties: false,
      },
    },
    required: ["schema", "intent", "assurance", "scope", "limits", "tripwires", "policy"],
    additionalProperties: false,
  };
}

export function readBoundedWorkContract(value: unknown): BoundedWorkContract | undefined {
  if (!isRecord(value)) return undefined;
  try {
    assertBoundedWorkContractShape(value);
    const contract = value as unknown as BoundedWorkContract;
    // Core normalizes and rejects every malformed or incomplete field before it can become authority.
    const revision = adoptBoundedWorkContractRevision({
      contract,
      adoptedAt: new Date().toISOString(),
      adoptedBy: { kind: "operator", actorId: "validation", decisionId: "validation" },
      accountingLineageId: "validation",
    });
    return revision.contract;
  } catch {
    return undefined;
  }
}

export function readBoundedWorkContractAuthority(value: unknown): BoundedWorkAdoptionAuthority | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === "operator"
    && hasExactKeys(value, ["kind", "actorId", "decisionId"])
    && readText(value.actorId)
    && readText(value.decisionId)) {
    return { kind: "operator", actorId: readText(value.actorId)!, decisionId: readText(value.decisionId)! };
  }
  if (value.kind === "approved_plan"
    && hasExactKeys(value, ["kind", "planId", "planDigest"])
    && readText(value.planId)
    && readText(value.planDigest)) {
    return { kind: "approved_plan", planId: readText(value.planId)!, planDigest: readText(value.planDigest)! };
  }
  return undefined;
}


function assertBoundedWorkContractShape(value: Record<string, unknown>): void {
  assertExactKeys(value, ["schema", "intent", "assurance", "scope", "limits", "tripwires", "policy"], "boundedWorkContract");

  const intent = requireInputRecord(value.intent, "boundedWorkContract.intent");
  assertExactKeys(intent, ["objective", "acceptanceCriteria", "nonGoals"], "boundedWorkContract.intent");
  for (const [index, criterion] of requireInputArray(
    intent.acceptanceCriteria,
    "boundedWorkContract.intent.acceptanceCriteria",
  ).entries()) {
    const record = requireInputRecord(criterion, `boundedWorkContract.intent.acceptanceCriteria[${index}]`);
    assertExactKeys(
      record,
      ["id", "statement"],
      `boundedWorkContract.intent.acceptanceCriteria[${index}]`,
    );
  }
  requireInputArray(intent.nonGoals, "boundedWorkContract.intent.nonGoals");

  const assurance = requireInputRecord(value.assurance, "boundedWorkContract.assurance");
  assertExactKeys(assurance, ["formalVerification"], "boundedWorkContract.assurance");
  const formalVerification = requireInputRecord(
    assurance.formalVerification,
    "boundedWorkContract.assurance.formalVerification",
  );
  assertExactKeys(
    formalVerification,
    ["semantics", "obligations", "mappings"],
    "boundedWorkContract.assurance.formalVerification",
  );
  for (const [index, obligation] of requireInputArray(
    formalVerification.obligations,
    "boundedWorkContract.assurance.formalVerification.obligations",
  ).entries()) {
    const record = requireInputRecord(
      obligation,
      `boundedWorkContract.assurance.formalVerification.obligations[${index}]`,
    );
    assertExactKeys(
      record,
      ["id", "symbol", "subjectPaths"],
      `boundedWorkContract.assurance.formalVerification.obligations[${index}]`,
    );
    requireInputArray(
      record.subjectPaths,
      `boundedWorkContract.assurance.formalVerification.obligations[${index}].subjectPaths`,
    );
  }
  for (const [index, mapping] of requireInputArray(
    formalVerification.mappings,
    "boundedWorkContract.assurance.formalVerification.mappings",
  ).entries()) {
    const record = requireInputRecord(
      mapping,
      `boundedWorkContract.assurance.formalVerification.mappings[${index}]`,
    );
    assertExactKeys(
      record,
      ["criterionId", "obligationIds"],
      `boundedWorkContract.assurance.formalVerification.mappings[${index}]`,
    );
    requireInputArray(
      record.obligationIds,
      `boundedWorkContract.assurance.formalVerification.mappings[${index}].obligationIds`,
    );
  }

  const scope = requireInputRecord(value.scope, "boundedWorkContract.scope");
  assertExactKeys(
    scope,
    [
      "allowedWorkItemIds",
      "permittedEffects",
      "permittedSurfaces",
      "allowedRoots",
      "deniedRoots",
      "refactorAuthority",
      "migrationAuthority",
      "dependencyAuthority",
    ],
    "boundedWorkContract.scope",
  );
  for (const field of ["allowedWorkItemIds", "permittedEffects", "permittedSurfaces", "allowedRoots", "deniedRoots"] as const) {
    requireInputArray(scope[field], `boundedWorkContract.scope.${field}`);
  }

  const limits = requireInputRecord(value.limits, "boundedWorkContract.limits");
  assertExactKeys(
    limits,
    [
      "maxExecutionAttempts",
      "maxManagedInvocations",
      "maxConcurrentManagedInvocations",
      "maxChildDepth",
      "maxReviewRounds",
      "maxRemediationRounds",
    ],
    "boundedWorkContract.limits",
    [
      "maxExecutionAttempts",
      "maxManagedInvocations",
      "maxConcurrentManagedInvocations",
      "maxChildDepth",
      "maxReviewRounds",
      "maxRemediationRounds",
    ],
  );

  const tripwires = requireInputRecord(value.tripwires, "boundedWorkContract.tripwires");
  assertExactKeys(
    tripwires,
    ["changedFiles", "changedLines", "activeDurationMs", "toolCalls"],
    "boundedWorkContract.tripwires",
    [],
  );

  const policy = requireInputRecord(value.policy, "boundedWorkContract.policy");
  assertExactKeys(
    policy,
    ["scopeExpansion", "budgetExhaustion", "minimumHarnessCapability"],
    "boundedWorkContract.policy",
  );
}


export function assertBoundedWorkPolicyCeiling(
  config: KilnWorkGovernanceConfig | undefined,
  contract: BoundedWorkContract,
): void {
  const ceiling = config?.boundedWorkCeiling;
  if (!ceiling) return;
  if (ceiling.allowedEffects && contract.scope.permittedEffects.some((effect) => !ceiling.allowedEffects!.includes(effect))) {
    throw new Error("bounded-work contract requests an effect outside the configured global ceiling");
  }
  if (ceiling.allowedRoots && contract.scope.allowedRoots.some((root) => !ceiling.allowedRoots!.some((ceilingRoot) => root === ceilingRoot || root.startsWith(`${ceilingRoot}/`)))) {
    throw new Error("bounded-work contract requests a root outside the configured global ceiling");
  }
  if (ceiling.deniedRoots && ceiling.deniedRoots.some((root) => !contract.scope.deniedRoots.includes(root))) {
    throw new Error("bounded-work contract must retain every globally denied root");
  }
  const limits = ceiling.maximumLimits;
  if (limits) {
    for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
      const maximum = limits[key];
      const requested = contract.limits[key];
      if (maximum !== undefined && (requested === undefined || requested > maximum)) {
        throw new Error(`bounded-work contract ${key} exceeds or omits the configured global ceiling`);
      }
    }
  }
  const rank: Record<BoundedWorkHarnessCapability, number> = { advisory_only: 0, partially_enforced: 1, authoritative: 2 };
  if (ceiling.minimumHarnessCapability && rank[contract.policy.minimumHarnessCapability] < rank[ceiling.minimumHarnessCapability]) {
    throw new Error("bounded-work contract harness capability is below the configured global minimum");
  }
}
