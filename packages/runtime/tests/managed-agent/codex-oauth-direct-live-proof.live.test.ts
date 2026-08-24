import { expect, it } from "vitest";
import {
  defineManagedAgentInvocationRequest,
  defineManagedAgentWriteAuthority,
  defineManagedAgentWriteScope,
} from "@kilnai/core/agents";
import { createSessionBuiltinToolOptions } from "@kilnai/core/tools";
import {
  ManagedRuntimeCredentialRouteLeaseManager,
  RuntimeManagedAgentInvocationService,
} from "@kilnai/runtime";
import { createManagedDirectProviderAdapterFactory } from "../../../cli/src/config/managed-agent-direct-adapters.js";
import type { ManagedCommittedInvocationRequest, ManagedInvocationRouteProfile } from "@kilnai/runtime";
import type {
  RuntimeModelRoundActionClaim,
  RuntimeModelRoundActionClaimPermit,
  RuntimeModelRoundActionClaimStore,
  RuntimeToolActionClaim,
  RuntimeToolActionClaimPermit,
  RuntimeToolActionClaimStore,
} from "@kilnai/runtime";
import type { DirectProviderCredentialBinding } from "../../../cli/src/wrapper/direct-provider-adapter-factory.js";
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
        const adapter = await createManagedDirectProviderAdapterFactory({
          builtinToolOptions: createSessionBuiltinToolOptions(),
          runtimeToolActionClaims: createLiveToolActionStore(),
          readAuthorityAdmission: () => undefined,
          runtimeModelRoundActionClaims: createLiveModelRoundStore(),
        })({
          id: "codex-oauth-readonly-live",
          kind: "direct",
          authorityProfiles: [],
        }, credentialBindingFor("codex-oauth-readonly-live"), undefined,
        committedRequestFor("codex-oauth-readonly-live", "codex-oauth", model, "invocation-codex-oauth-direct-live-readonly-1"),
        directProfile("read-only", "foundation-readonly-plan", "credential-route:codex-oauth:runtime-selected", "read-only"));
        if (!adapter) {
          throw new Error("Expected Codex OAuth direct live adapter");
        }
        const request = defineManagedAgentInvocationRequest({
          invocationId: "invocation-codex-oauth-direct-live-readonly-1",
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
              mode: "runtime-selected",
              routeId: "credential-route:codex-oauth:runtime-selected",
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

        const result = await createCodexOauthDirectLiveService()
          .invoke(request, adapter, makeManagedAgentLiveCapabilitySnapshotInput(request));

        expect(result.status).toBe("completed");
        if (result.status !== "completed") {
          throw new Error("Expected completed Codex OAuth direct-provider live proof");
        }
        expectCompletedLiveRecord(result.record, "Codex OAuth direct-provider read live proof");
        expectCredentialRouteLeaseEvidence(result.record, "invocation-codex-oauth-direct-live-readonly-1");
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
        const adapter = await createManagedDirectProviderAdapterFactory({
          builtinToolOptions: createSessionBuiltinToolOptions(),
          runtimeToolActionClaims: createLiveToolActionStore(),
          readAuthorityAdmission: () => undefined,
          runtimeModelRoundActionClaims: createLiveModelRoundStore(),
        })({
          id: "codex-oauth-approved-write-live",
          kind: "direct",
          authorityProfiles: [],
        }, credentialBindingFor("codex-oauth-approved-write-live"), undefined,
        committedRequestFor("codex-oauth-approved-write-live", "codex-oauth", model, "invocation-codex-oauth-direct-live-write-1"),
        directProfile("apply-approved-writes", "foundation-apply-approved-writes", "credential-route:codex-oauth:runtime-selected", "workspace-write", true));
        if (!adapter) {
          throw new Error("Expected Codex OAuth direct approved-write live adapter");
        }

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
              mode: "runtime-selected",
              routeId: "credential-route:codex-oauth:runtime-selected",
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

        const result = await createCodexOauthDirectLiveService()
          .invoke(request, adapter, makeManagedAgentLiveCapabilitySnapshotInput(request));

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

function createCodexOauthDirectLiveService(): RuntimeManagedAgentInvocationService {
  return new RuntimeManagedAgentInvocationService({
    credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
      allowedRouteIds: ["credential-route:codex-oauth:runtime-selected"],
    }),
  });
}

function credentialBindingFor(routeId: string): DirectProviderCredentialBinding {
  return {
    routeId,
    accountId: "codex-oauth-live-account",
    credentialId: "codex-oauth-live-credential",
    credentialRevision: "codex-oauth-live-credential-revision",
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

function committedRequestFor(
  routeId: string,
  providerId: string,
  modelId: string,
  invocationId: string,
): ManagedCommittedInvocationRequest {
  const route = {
    routeId,
    providerId,
    modelId,
    adapterCapabilityId: "text",
    adapterCapabilityVersion: "1",
    authBillingChannel: "subscription",
    executionMode: "direct",
    serviceTier: "default",
    accountPolicyId: null,
    fallbackPosture: "disabled" as const,
    overagePosture: "disabled" as const,
    rateCardId: "codex-oauth-live",
    rateCardRevision: "1",
    priceEvidenceDigest: "sha256:codex-oauth-live-price",
    unit: "request",
    scheme: { kind: "unit" as const },
    contextClass: "default",
    cacheClass: "none",
    auxiliaryScheduleDigest: "sha256:codex-oauth-live-auxiliary",
    envelopeDigest: "sha256:codex-oauth-live-envelope",
  };
  const selectedIdentity = { route, account: { kind: "accountless" as const } };
  const policy = {
    policyId: "codex-oauth-live-policy",
    schemaVersion: 1,
    policyRevision: "codex-oauth-live-policy-revision",
    policyDigest: "sha256:codex-oauth-live-policy",
    comparisonDomains: [],
    noRouteAction: "deny" as const,
    evidenceRequirements: { quota: "optional" as const, price: "optional" as const },
  };
  return {
    commitment: {
      commitmentId: `codex-oauth-live-commitment:${invocationId}`,
      reservation: {
        reservationId: `codex-oauth-live-reservation:${invocationId}`,
        jobId: `codex-oauth-live-job:${invocationId}`,
        economicAttemptId: `codex-oauth-live-attempt:${invocationId}`,
        policy,
        selectedIdentity,
        priceIdentity: null,
        envelope: { kind: "bounded", digest: "sha256:codex-oauth-live-envelope", limits: [] },
        amounts: [],
        authorityRevision: "sha256:codex-oauth-live-authority",
      },
      rejected: [],
      notSelected: [],
    },
    dispatchFenceId: `codex-oauth-live-fence:${invocationId}`,
    abortSignal: new AbortController().signal,
    authorityProfileId: "authority:codex-oauth-live",
    admissionProfile: "foundation-readonly-plan",
    profileAuthorityDigest: "sha256:codex-oauth-live-profile",
    invocationId,
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
