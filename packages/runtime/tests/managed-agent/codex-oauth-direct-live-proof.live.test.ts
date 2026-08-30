import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  createExecutionAccountPolicyId,
  createExecutionAccountRef,
  defineManagedAgentInvocationRequest,
  defineManagedAgentWriteAuthority,
  defineManagedAgentWriteScope,
} from "@kilnai/core/agents";
import {
  digestManagedEconomicValue,
  type ManagedEconomicCommitment,
} from "@kilnai/core/cost";
import { createSessionBuiltinToolOptions } from "@kilnai/core/tools";
import {
  CodexOAuthCredentialPoolService,
  ManagedEconomicDispatchCoordinator,
  ManagedRuntimeCredentialRouteLeaseManager,
  RuntimeManagedAgentInvocationService,
  SqliteManagedAccountLeaseAuthority,
} from "@kilnai/runtime";
import { createManagedDirectProviderAdapterFactory } from "../../../cli/src/config/managed-agent-direct-adapters.js";
import type {
  ManagedAgentRuntimeAdapter,
  ManagedInvocationRouteProfile,
} from "@kilnai/runtime";
import type { ManagedAgentRuntimeInvocationLifecycleOptions } from "../../src/agents/managed-invocation/invocation-service.js";
import {
  defineEffectiveAuthorityAdmissionBundle,
  type EffectiveAuthorityAdmissionBundle,
} from "../../src/session/effective-authority-admission-bundle.js";
import type {
  RuntimeModelRoundActionClaim,
  RuntimeModelRoundActionClaimPermit,
  RuntimeModelRoundActionClaimStore,
  RuntimeToolActionClaim,
  RuntimeToolActionClaimPermit,
  RuntimeToolActionClaimStore,
} from "@kilnai/runtime";
import type { DirectProviderCredentialBinding } from "../../../cli/src/wrapper/direct-provider-adapter-factory.js";
import { createEconomicRouteProofAdoption } from "./economic-route-proof-fixture.js";
import { managedEconomicAdmissionBundle } from "./managed-economic-admission-fixture.js";
import {
  KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL,
  KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV,
  describeManagedAgentProviderLive,
  expectManagedAgentLiveFilesystemAndEvidence,
  makeManagedAgentLiveCapabilitySnapshotInput,
  requireManagedAgentLiveEnvironment,
  withManagedAgentLiveFixtureWorkspace,
} from "./managed-agent-live-test-harness.js";

describeManagedAgentProviderLive(
  "managed agent Codex OAuth subscription direct-provider read live proof",
  KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV,
  () => {
    it("reads a governed fixture through the subscription-backed direct adapter", async () => {
      await withManagedAgentLiveFixtureWorkspace({
        prefix: "kiln-managed-agent-codex-oauth-direct-readonly-",
        files: {
          "proof.txt": [
            "Managed subscription direct-provider live fixture.",
            "keyword=kiln-codex-oauth-direct-live-proof",
            "The child must obtain this keyword by calling the read tool.",
            "",
          ].join("\n"),
        },
      }, async (workspace) => {
        const model = requireManagedAgentLiveEnvironment(KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL);
        const invocationId = "invocation-codex-oauth-direct-live-readonly-1";
        const request = defineManagedAgentInvocationRequest({
          invocationId,
          agentId: "codex-oauth-direct-live:foundation-readonly-plan",
          parentSessionId: "session-codex-oauth-direct-live-parent",
          parentTurnId: "session-codex-oauth-direct-live-parent:turn:1",
          profile: "foundation-readonly-plan",
          requestedBy: "operator",
          requestSource: "live-test",
          providerRoute: {
            providerId: "codex-oauth",
            surface: "direct-provider",
            model,
          },
          adapterKind: "direct",
          executionMode: "direct-provider",
          authority: {
            authorityProfileId: "authority:codex-oauth-direct-live-readonly",
            permissionProfile: "read-only",
            toolAuthority: {
              allowedToolNames: ["read"],
              writeAllowed: false,
              networkAllowed: false,
            },
            workingDirectory: {
              path: workspace.workspaceRoot,
              mode: "read-only",
            },
            timeoutMs: 120000,
            credentialRoute: {
              mode: "account-leased",
              routeId: "credential-route:codex-oauth:runtime-selected",
              accountPolicyId: createExecutionAccountPolicyId("codex-oauth-accounts"),
            },
            memoryScope: {
              scope: { kind: "project", id: "kiln" },
              access: "read-only",
            },
          },
          input: {
            summary: "Read the Codex OAuth direct-provider live fixture through Kiln tools.",
            prompt: [
              "Call the read tool exactly once with filePath \"proof.txt\".",
              "After reading the file, reply with the keyword value in the form:",
              "DIRECT_CODEX_OAUTH_LIVE_PROOF:<keyword>",
              "Do not guess the keyword. Do not modify files.",
            ].join("\n"),
          },
        });

        const result = await withCodexOauthEconomicDispatch({
          routeId: "codex-oauth-live-proof",
          model,
          invocationId,
          parentTurnId: request.parentTurnId,
          permissionProfile: "read-only",
          admissionProfile: "foundation-readonly-plan",
          workingDirectoryMode: "read-only",
        }, ({ adapter, economicDispatch, childAuthorityAdmission }) => createCodexOauthDirectLiveService()
          .invoke(request, adapter, makeManagedAgentLiveCapabilitySnapshotInput(request), {
            economicDispatch,
            childAuthorityAdmission,
          }));

        expect(result.status).toBe("completed");
        if (result.status !== "completed") {
          throw new Error("Expected completed Codex OAuth direct-provider live proof");
        }
        expectCompletedLiveRecord(result.record, "Codex OAuth direct-provider read live proof");
        expectCredentialRouteLeaseEvidence(result.record, invocationId);
        expect(result.record.resultHandoff?.summary).toContain("kiln-codex-oauth-direct-live-proof");
        await expect(workspace.readFile("proof.txt")).resolves.toContain("keyword=kiln-codex-oauth-direct-live-proof");
      });
    }, 180000);
  },
);

describeManagedAgentProviderLive(
  "managed agent Codex OAuth subscription direct-provider approved-write live proof",
  KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV,
  () => {
    it("records a subscription-backed direct-provider approved fixture write as canonical write evidence", async () => {
      await withManagedAgentLiveFixtureWorkspace({
        prefix: "kiln-managed-agent-codex-oauth-direct-write-",
        files: {
          "proof.txt": "before\n",
        },
      }, async (workspace) => {
        const model = requireManagedAgentLiveEnvironment(KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL);
        const invocationId = "invocation-codex-oauth-direct-live-write-1";
        const request = defineManagedAgentInvocationRequest({
          invocationId,
          agentId: "codex-oauth-direct-live:foundation-apply-approved-writes",
          parentSessionId: "session-codex-oauth-direct-live-parent",
          parentTurnId: "session-codex-oauth-direct-live-parent:turn:2",
          profile: "foundation-apply-approved-writes",
          requestedBy: "operator",
          requestSource: "live-test",
          providerRoute: {
            providerId: "codex-oauth",
            surface: "direct-provider",
            model,
          },
          adapterKind: "direct",
          executionMode: "direct-provider",
          authority: {
            authorityProfileId: "authority:codex-oauth-direct-live-approved-write",
            permissionProfile: "apply-approved-writes",
            toolAuthority: {
              allowedToolNames: ["read", "edit"],
              writeAllowed: true,
              networkAllowed: false,
            },
            workingDirectory: {
              path: workspace.workspaceRoot,
              mode: "workspace-write",
            },
            timeoutMs: 120000,
            credentialRoute: {
              mode: "account-leased",
              routeId: "credential-route:codex-oauth:runtime-selected",
              accountPolicyId: createExecutionAccountPolicyId("codex-oauth-accounts"),
            },
            memoryScope: {
              scope: { kind: "project", id: "kiln" },
              access: "write-proposals",
            },
            writeAuthority: defineManagedAgentWriteAuthority({
              profile: "foundation-apply-approved-writes",
              scope: defineManagedAgentWriteScope({
                workspace: {
                  mode: "apply-approved",
                  allowedPaths: [workspace.workspaceRoot],
                  deniedPaths: [workspace.filePath(".git")],
                },
                memory: {
                  mode: "propose",
                  scope: { kind: "project", id: "kiln" },
                  operations: ["create", "update"],
                },
                artifacts: {
                  mode: "propose",
                  resourceUris: [`kiln://managed-invocations/${invocationId}/write`],
                  retention: "session",
                },
                tools: {
                  allowedToolNames: ["read", "edit"],
                  deniedToolNames: ["git-commit"],
                },
              }),
              approval: {
                mode: "policy-approved",
                evidenceRequired: true,
                approver: "operator",
                evidenceUris: [`kiln://managed-invocations/${invocationId}/approval`],
              },
            }),
          },
          input: {
            summary: "Apply the Codex OAuth direct-provider approved write fixture.",
            prompt: [
              "Call the read tool once with filePath \"proof.txt\" and confirm it contains exactly \"before\\n\".",
              "Then call the edit tool exactly once with filePath \"proof.txt\", oldString \"before\\n\", and newString \"after\\n\".",
              "Do not modify any other file.",
              "After the edit succeeds, reply exactly:",
              "DIRECT_CODEX_OAUTH_WRITE_LIVE_PROOF:written",
            ].join("\n"),
          },
        });

        const result = await withCodexOauthEconomicDispatch({
          routeId: "codex-oauth-live-proof",
          model,
          invocationId,
          parentTurnId: request.parentTurnId,
          permissionProfile: "apply-approved-writes",
          admissionProfile: "foundation-apply-approved-writes",
          workingDirectoryMode: "workspace-write",
          writeAllowed: true,
        }, ({ adapter, economicDispatch, childAuthorityAdmission }) => createCodexOauthDirectLiveService()
          .invoke(request, adapter, makeManagedAgentLiveCapabilitySnapshotInput(request), {
            economicDispatch,
            childAuthorityAdmission,
          }));

        expect(result.status).toBe("completed");
        if (result.status !== "completed") {
          throw new Error("Expected completed Codex OAuth direct-provider approved-write live proof");
        }
        expectCompletedLiveRecord(result.record, "Codex OAuth direct-provider approved-write live proof");
        expectCredentialRouteLeaseEvidence(result.record, invocationId);
        await expectManagedAgentLiveFilesystemAndEvidence({
          workspace,
          relativePath: "proof.txt",
          expectedContents: "after\n",
          evidence: result.record.writeEvidence ?? [],
          expectedEvidenceKinds: [
            "write-proposal-created",
            "write-proposal-approved",
            "write-attempt-completed",
          ],
          forbiddenInlineText: "diff --git",
        });
        expectNoRawPatchEvidence(result.record.writeEvidence ?? []);
      });
    }, 180000);
  },
);

interface CodexOauthEconomicDispatchInput {
  readonly routeId: string;
  readonly model: string;
  readonly invocationId: string;
  readonly parentTurnId: string;
  readonly permissionProfile: "read-only" | "apply-approved-writes";
  readonly admissionProfile: "foundation-readonly-plan" | "foundation-apply-approved-writes";
  readonly workingDirectoryMode: "read-only" | "workspace-write";
  readonly writeAllowed?: boolean;
}

async function withCodexOauthEconomicDispatch<T>(
  input: CodexOauthEconomicDispatchInput,
  execute: (prepared: {
    readonly adapter: ManagedAgentRuntimeAdapter;
    readonly economicDispatch: NonNullable<ManagedAgentRuntimeInvocationLifecycleOptions["economicDispatch"]>;
    readonly childAuthorityAdmission: { readonly bundle: EffectiveAuthorityAdmissionBundle };
  }) => Promise<T>,
): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "kiln-codex-oauth-direct-economic-live-"));
  const authority = new SqliteManagedAccountLeaseAuthority({
    path: join(root, "authority.sqlite"),
    ownerId: `owner:${input.invocationId}`,
    now: () => Date.parse("2026-08-02T12:00:00.000Z"),
  });
  let resolveSettlement!: () => void;
  let rejectSettlement!: (error: unknown) => void;
  const settlementRecorded = new Promise<void>((resolve, reject) => {
    resolveSettlement = resolve;
    rejectSettlement = reject;
  });
  try {
    const profile = directProfile(
      input.permissionProfile,
      input.admissionProfile,
      "credential-route:codex-oauth:runtime-selected",
      input.workingDirectoryMode,
      input.writeAllowed,
    );
    const credentialBinding = await credentialBindingFor(input.routeId);
    const childAdmissions = new Map<string, EffectiveAuthorityAdmissionBundle>();
    const createAdapter = createManagedDirectProviderAdapterFactory({
      builtinToolOptions: createSessionBuiltinToolOptions(),
      runtimeToolActionClaims: createLiveToolActionStore(),
      readAuthorityAdmission: ({ admissionId }) => childAdmissions.get(admissionId),
      runtimeModelRoundActionClaims: createLiveModelRoundStore(),
    });
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: {
        acquire: (request) => authority.acquireCommitment(request),
        releasePreFence: (jobId, economicAttemptId) =>
          authority.releaseCommitmentPreFence(jobId, economicAttemptId),
        fenceDispatch: (jobId, economicAttemptId, dispatchFenceId, actionClaim) =>
          authority.fenceDispatch(jobId, economicAttemptId, dispatchFenceId, actionClaim),
        readDispatch: (jobId, economicAttemptId, dispatchFenceId, actionClaim) =>
          authority.readDispatch(jobId, economicAttemptId, dispatchFenceId, actionClaim),
        settleExecution: (jobId, economicAttemptId, dispatchFenceId, settlement) => {
          try {
            const record = authority.settleExecution(jobId, economicAttemptId, dispatchFenceId, settlement);
            resolveSettlement();
            return record;
          } catch (error) {
            rejectSettlement(error);
            throw error;
          }
        },
        recordExecutionSettlementPending: (jobId, economicAttemptId, dispatchFenceId, reason) =>
          authority.recordExecutionSettlementPending(jobId, economicAttemptId, dispatchFenceId, reason),
      },
      resolveLifecycleTimeoutMs: () => 120_000,
      createAdapter: ({
        commitment,
        dispatchFenceId,
        abortSignal,
        authorityProfileId,
        admissionProfile,
        profileAuthorityDigest,
        invocationId,
      }) => createAdapter({
        id: input.routeId,
        kind: "direct",
        authorityProfiles: [],
      }, credentialBinding, abortSignal, {
        commitment,
        dispatchFenceId,
        abortSignal,
        authorityProfileId,
        admissionProfile,
        profileAuthorityDigest,
        invocationId,
      }, profile),
    });
    const baseAdoption = createEconomicRouteProofAdoption({
      providerId: "codex-oauth",
      routeId: input.routeId,
      modelId: input.model,
      priceKind: "subscription",
      quotaEvidence: {
        kind: "unknown",
        capacityIdentity: "codex-oauth-capacity",
        subscriptionClass: "unknown",
        reason: "Live fixture does not project account quota into durable test evidence.",
        evidence: null,
      },
      quotaRequirement: "optional",
    });
    const adoption = {
      ...baseAdoption,
      routeCapacity: baseAdoption.routeCapacity.map((capacity) => ({
        ...capacity,
        candidates: capacity.candidates.map((candidate) => ({
          ...candidate,
          candidate: {
            ...candidate.candidate,
            account: createExecutionAccountRef(`configured:${credentialBinding.accountId}`),
          },
          credentialRevisionId: credentialBinding.credentialRevision,
        })),
      })),
    };
    const prepared = await coordinator.prepare({
      jobId: `job:${input.invocationId}`,
      economicAttemptId: `economic-attempt:${input.invocationId}`,
      intentFingerprint: digestManagedEconomicValue({
        invocationId: input.invocationId,
        routeId: input.routeId,
        model: input.model,
      }),
      admissionBundle: managedEconomicAdmissionBundle({
        sessionId: "session-codex-oauth-direct-live-parent",
        turnId: input.parentTurnId,
        admittedAuthority: input.writeAllowed ? "audited" : "read_only",
      }),
      effectIdentity: "managed-agent-live:codex-oauth-provider-dispatch",
      adoption,
      admissionProfile: input.admissionProfile,
      authorityProfileId: profile.authorityProfileId,
      invocationId: input.invocationId,
      workLimitDurationMs: 120_000,
    });
    if (prepared.status !== "prepared") {
      throw new Error("Codex OAuth live economic dispatch was not prepared.");
    }
    const childAuthorityAdmission = createLiveChildAuthorityAdmission(input, credentialBinding, prepared.commitment);
    childAdmissions.set(childAuthorityAdmission.admissionId, childAuthorityAdmission);
    const result = await execute({
      adapter: prepared.adapter,
      economicDispatch: {
        commitment: prepared.commitment,
        dispatchFenceId: prepared.dispatchFenceId,
        recordExecutionSettlementPending: prepared.recordExecutionSettlementPending,
        createExecutionSettlement: prepared.createExecutionSettlement,
        registerEconomicSettlement: prepared.registerEconomicSettlement,
      },
      childAuthorityAdmission: { bundle: childAuthorityAdmission },
    });
    await settlementRecorded;
    return result;
  } finally {
    authority.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function createLiveChildAuthorityAdmission(
  input: CodexOauthEconomicDispatchInput,
  credentialBinding: DirectProviderCredentialBinding,
  commitment: ManagedEconomicCommitment,
): EffectiveAuthorityAdmissionBundle {
  const admittedAuthority = input.writeAllowed ? "audited" as const : "read_only" as const;
  const allowedToolNames = input.writeAllowed ? ["read", "edit"] : ["read"];
  const toolPermissions: EffectiveAuthorityAdmissionBundle["turn"]["tools"]["allowedToolPermissions"] =
    allowedToolNames.map((toolName) => ({
      toolName,
      authority: {
        level: toolName === "edit" ? 3 : 1,
        allowed: true,
        requiresApproval: false,
        reason: "live-proof-policy-admitted",
      },
      effectEnvelope: toolName === "edit"
        ? {
            operation: "mutate",
            boundaries: ["workspace"],
            reversibility: "compensatable",
            dataEgress: "none",
            identityUse: "none",
            consequences: ["local-state"],
            idempotency: "non-idempotent",
          }
        : {
            operation: "observe",
            boundaries: ["workspace"],
            reversibility: "reversible",
            dataEgress: "none",
            identityUse: "none",
            consequences: ["local-state"],
            idempotency: "idempotent",
          },
    }));
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: "session-codex-oauth-direct-live-parent",
    turnId: input.parentTurnId,
    admittedAt: "2026-08-02T12:00:00.000Z",
    configuration: {
      sessionRevision: { revisionSetId: "codex-oauth-live", revisions: { liveProof: "1" } },
      turnRevision: { revisionSetId: "codex-oauth-live", revisions: { liveProof: "1" } },
    },
    session: {
      skillCatalog: { catalogId: "codex-oauth-live", revision: "1", skillIds: [] },
      authorityCeiling: {
        maximumAuthority: admittedAuthority,
        reason: "Codex OAuth direct live proof authority ceiling.",
        subjectId: input.invocationId,
      },
    },
    turn: {
      capabilityParticipation: { status: "not-requested" },
      authority: {
        executionMode: "execute",
        requestedAuthority: admittedAuthority,
        admittedAuthority,
        sourcePolicy: "runtime_surface_projection",
        reason: "Codex OAuth direct live proof admission.",
        completeness: "authoritative",
        toolCount: toolPermissions.length,
        deniedToolCount: 0,
        sandboxProjection: input.writeAllowed ? "workspace_write" : "read_only",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: { allowedToolPermissions: toolPermissions, deniedToolNames: [] },
      effectCeiling: {
        operation: input.writeAllowed ? "mutate" : "observe",
        boundaries: ["process", "workspace", "machine", "network", "external-system"],
        reversibility: input.writeAllowed ? "compensatable" : "reversible",
        dataEgress: "sensitive-data",
        identityUse: "privileged",
        consequences: ["local-state", "external-state", "financial", "security"],
        idempotency: input.writeAllowed ? "non-idempotent" : "idempotent",
      },
      budget: { status: "not-configured" },
      execution: {
        status: "routed",
        target: {
          targetId: input.routeId,
          providerId: "codex-oauth",
          providerModelId: input.model,
          accountSelection: { kind: "operator-override", accountPolicyId: "codex-oauth-accounts", accountId: credentialBinding.accountId },
        },
        dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "policy-admitted" } },
        binding: {
          status: "bound",
          routeId: input.routeId,
          accountId: credentialBinding.accountId,
          credentialId: credentialBinding.credentialId,
          credentialRevision: credentialBinding.credentialRevision,
        },
        economicCommitment: {
          commitmentId: commitment.commitmentId,
          authorityRevision: commitment.reservation.authorityRevision,
        },
      },
    },
  });
}

function createCodexOauthDirectLiveService(): RuntimeManagedAgentInvocationService {
  return new RuntimeManagedAgentInvocationService({
    credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
      allowedRouteIds: ["credential-route:codex-oauth:runtime-selected"],
    }),
  });
}

async function credentialBindingFor(routeId: string): Promise<DirectProviderCredentialBinding> {
  const selected = (await new CodexOAuthCredentialPoolService().listExecutionAccounts())[0];
  if (!selected) {
    throw new Error("Codex OAuth direct live proof requires one executable credential.");
  }
  return {
    routeId,
    accountId: selected.credentialId,
    credentialId: selected.credentialId,
    credentialRevision: selected.revision,
  };
}

function createLiveToolActionStore(): RuntimeToolActionClaimStore {
  const claims = new Map<string, RuntimeToolActionClaim>();
  const states = new WeakMap<object, { readonly claimId: string; consumed: boolean }>();
  return {
    claim(input) {
      if (claims.has(input.claimId)) throw new Error("Live tool-action claim already exists; no redispatch.");
      const state = { claimId: input.claimId, consumed: false };
      const permit = Object.freeze({
        claimId: input.claimId,
        permitId: `live-tool-action:${input.claimId}`,
        consume: () => {
          if (state.consumed) throw new Error("Live tool-action permit already consumed.");
          state.consumed = true;
        },
      }) as unknown as RuntimeToolActionClaimPermit;
      claims.set(input.claimId, input);
      states.set(permit, state);
      return permit;
    },
    settle(permit, settlement) {
      const state = states.get(permit);
      const claim = claims.get(permit.claimId);
      if (!state || !claim || !state.consumed) throw new Error("Live tool-action permit was not consumed.");
      claims.set(permit.claimId, {
        ...claim,
        status: settlement.kind === "success" ? "settled" : "unknown",
        ...(settlement.kind === "success" ? { outcome: "success" as const } : { unknownReason: settlement.reason }),
        ...(settlement.settledAt ? { settledAt: settlement.settledAt } : {}),
      });
      states.delete(permit);
    },
  };
}

function createLiveModelRoundStore(): RuntimeModelRoundActionClaimStore {
  const claims = new Map<string, RuntimeModelRoundActionClaim>();
  const states = new WeakMap<object, { readonly claimId: string; consumed: boolean }>();
  return {
    claim(input) {
      if (claims.has(input.claimId)) throw new Error("Live model-round claim already exists; no redispatch.");
      const state = { claimId: input.claimId, consumed: false };
      const permit = Object.freeze({
        claimId: input.claimId,
        permitId: `live-model-round:${input.claimId}`,
        consume: () => {
          if (state.consumed) throw new Error("Live model-round permit already consumed.");
          state.consumed = true;
        },
      }) as unknown as RuntimeModelRoundActionClaimPermit;
      claims.set(input.claimId, input);
      states.set(permit, state);
      return permit;
    },
    settle(permit, settlement) {
      const state = states.get(permit);
      const claim = claims.get(permit.claimId);
      if (!state || !claim || !state.consumed) throw new Error("Live model-round permit was not consumed.");
      claims.set(permit.claimId, {
        ...claim,
        status: settlement.kind === "success" ? "settled" : "unknown",
        ...(settlement.kind === "success"
          ? { outcome: "success" as const }
          : { outcome: "unknown" as const, unknownReason: settlement.reason }),
        ...(settlement.settledAt ? { settledAt: settlement.settledAt } : {}),
      });
      states.delete(permit);
    },
  };
}

function directProfile(
  permissionProfile: "read-only" | "apply-approved-writes",
  admissionProfile: "foundation-readonly-plan" | "foundation-apply-approved-writes",
  credentialRouteId: string,
  workingDirectoryMode: "read-only" | "workspace-write",
  writeAllowed = false,
): ManagedInvocationRouteProfile {
  return {
    authorityProfileId: `authority:codex-oauth-live:${permissionProfile}`,
    admissionProfile,
    permissionProfile,
    allowedToolNames: writeAllowed ? ["read", "edit"] : ["read"],
    writeAllowed,
    networkAllowed: false,
    workingDirectory: { path: "project", mode: workingDirectoryMode },
    timeoutMs: 120000,
    credentialRoute: { mode: "runtime-selected", routeId: credentialRouteId },
    memoryScope: {
      scope: { kind: "project", id: "kiln" },
      access: writeAllowed ? "write-proposals" : "read-only",
    },
  };
}

function expectCompletedLiveRecord(
  record: { readonly lifecycleState: string; readonly resultHandoff?: { readonly summary?: string } },
  label: string,
): void {
  if (record.lifecycleState !== "completed") {
    throw new Error(`${label} failed: ${record.resultHandoff?.summary ?? "missing result handoff"}`);
  }
}

function expectCredentialRouteLeaseEvidence(
  record: {
    readonly resourceLease?: {
      readonly resourceUris: readonly string[];
      readonly diagnosticUris: readonly string[];
    };
  },
  invocationId: string,
): void {
  const encodedRouteId = "credential-route%3Acodex-oauth%3Aruntime-selected";
  expect(record.resourceLease?.resourceUris).toContain(
    `kiln://artifacts/${invocationId}/credential-route/${encodedRouteId}`,
  );
  expect(record.resourceLease?.diagnosticUris).toContain(
    `kiln://artifacts/${invocationId}/credential-route-release/${encodedRouteId}`,
  );
}

function expectNoRawPatchEvidence(evidence: readonly unknown[]): void {
  const serialized = JSON.stringify(evidence);
  expect(serialized).not.toContain("diff --git");
  expect(serialized).not.toContain("@@");
  expect(serialized).not.toContain("--- ");
  expect(serialized).not.toContain("+++ ");
  expect(serialized).not.toContain("before\\n");
  expect(serialized).not.toContain("after\\n");
}
