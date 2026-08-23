import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { admitOperatorExecutionIntent, buildManagedAgentBackgroundJobOrchestrationRequest } from "@kilnai/core/agents";
import { createSessionBuiltinToolOptions } from "@kilnai/core/tools";
import {
  CodexOAuthCredentialPoolService,
  ConfiguredExecutionAccountRuntime,
  runManagedAgentOrchestrationLifecycle,
  SqliteManagedAccountLeaseAuthority,
} from "@kilnai/runtime";
import type {
  RuntimeModelRoundActionClaim,
  RuntimeModelRoundActionClaimPermit,
  RuntimeModelRoundActionClaimStore,
  RuntimeToolActionClaim,
  RuntimeToolActionClaimPermit,
  RuntimeToolActionClaimStore,
} from "@kilnai/runtime";
import { createManagedDirectProviderAdapterFactory } from "../../../cli/src/config/managed-agent-direct-adapters.js";
import { discoverManagedAgentProviderModels } from "../../../cli/src/config/managed-agent-provider-models.js";
import { resolveManagedInvocationToolOptions } from "../../../cli/src/config/managed-agent-routes.js";
import { readGlobalConfig, readGlobalExecutionCatalog } from "../../../cli/src/config/global-config.js";
import { createDefaultRegistry } from "../../../cli/src/wrapper/session-registry.js";
import {
  KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_ROUTE_ENV,
  KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS_ENV,
  describeManagedAgentProviderLive,
  withManagedAgentLiveFixtureWorkspace,
} from "./managed-agent-live-test-harness.js";

describeManagedAgentProviderLive(
  "managed agent Codex OAuth account-leased live proof",
  KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS_ENV,
  () => {
    it("fails closed before dispatch while postcommit account execution is unavailable", async () => {
      let leaseAuthority: SqliteManagedAccountLeaseAuthority | undefined;
      await withManagedAgentLiveFixtureWorkspace({
        prefix: "kiln-managed-account-live-",
        files: {
          "proof.txt": [
            "Managed account-leased live fixture.",
            "keyword=kiln-managed-account-live-proof",
            "",
          ].join("\n"),
        },
        onWorkspaceCleanup: () => {
          leaseAuthority?.close();
          leaseAuthority = undefined;
        },
      }, async (workspace) => {
        const routeId = requireEnvironment(KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_ROUTE_ENV);
        const config = readGlobalConfig();
        if (!config) throw new Error("Managed-account live proof requires ~/.kiln/config.yaml.");

        const targetCatalog = config.targetCatalog;
        const configuredRoute = targetCatalog?.targets.find((target) => target.id === routeId);
        if (
          !configuredRoute
          || configuredRoute.kind !== "direct"
          || configuredRoute.providerId !== "codex-oauth"
          || configuredRoute.accountSelection.mode !== "automatic"
        ) {
          throw new Error(
            "Managed-account live route must be a configured read-only Codex OAuth direct route.",
          );
        }
        const policy = targetCatalog?.accountPolicies.find(
          (candidate) => configuredRoute.accountSelection.mode === "automatic"
            && candidate.id === configuredRoute.accountSelection.accountPolicyId,
        );
        if (!targetCatalog || !policy || policy.accountIds.length !== 2) {
          throw new Error("Managed-account live policy must configure exactly two account candidates.");
        }
        const policyCredentialIds = policy.accountIds.map((accountId) => {
          const account = targetCatalog.accounts.find((candidate) => candidate.id === accountId);
          if (!account || account.providerId !== "codex-oauth") {
            throw new Error("Managed-account live policy contains an invalid Codex account.");
          }
          return account.credentialId;
        });

        const codexPool = new CodexOAuthCredentialPoolService();
        const credentialResolutions = vi.spyOn(codexPool, "resolveExecutionCredential");
        await codexPool.refreshUsageForCredentials(policyCredentialIds);
        expect(
          credentialResolutions.mock.calls
            .map(([account]) => account.credentialId)
            .sort(),
        ).toEqual([...policyCredentialIds].sort());
        credentialResolutions.mockClear();
        const runtimeDirectory = join(workspace.workspaceRoot, ".kiln", "runtime");
        await mkdir(runtimeDirectory, { recursive: true });
        const executionCatalog = readGlobalExecutionCatalog(config);
        if (!executionCatalog) throw new Error("Managed-account live proof requires an admitted execution catalog.");
        const routing = new ConfiguredExecutionAccountRuntime({ catalog: executionCatalog, codexPool });
        const admission = admitOperatorExecutionIntent(executionCatalog, { routeId });
        const usagePreflight = await routing.modelGatewayCandidates.resolve({
          admission,
          route: {
            routeId,
            providerId: configuredRoute.providerId,
            providerModelId: configuredRoute.providerModelId,
            scope: "virtual:managed-account-live-preflight",
          },
        });
        if (!usagePreflight.some(
          (candidate) =>
            candidate.lease.usageEvidence.freshness === "fresh"
            && candidate.lease.usageEvidence.availability === "available",
        )) {
          throw new Error(
            "Managed-account live proof requires at least one policy candidate with fresh available usage.",
          );
        }
        leaseAuthority = new SqliteManagedAccountLeaseAuthority({
          path: join(runtimeDirectory, "managed-account-live-proof.sqlite"),
        });
        const { registry } = createDefaultRegistry();
        const resolution = await resolveManagedInvocationToolOptions(config, {
          cwd: workspace.workspaceRoot,
          userHome: process.env.USERPROFILE,
          registry,
          surface: "operator",
          isProviderAvailable: (provider) => provider === "codex-oauth",
          providerModelEligibility: await discoverManagedAgentProviderModels(),
          directAdapterFactory: createManagedDirectProviderAdapterFactory({
            builtinToolOptions: createSessionBuiltinToolOptions(),
            runtimeToolActionClaims: createLiveToolActionStore(),
            readAuthorityAdmission: () => undefined,
            runtimeModelRoundActionClaims: createLiveModelRoundStore(),
          }),
          managedAccountComposition: {
            routing,
            authority: leaseAuthority,
            updateCatalog: (next) => routing.updateCatalog(next),
            close: () => leaseAuthority?.close(),
          },
        });
        const managedInvocation = resolution.managedInvocation;
        if (!managedInvocation) {
          throw new Error(
            `Managed-account live route composition is unavailable: ${JSON.stringify(resolution.routeHealth)}`,
          );
        }

        const route = managedInvocation.routes.find((candidate) => candidate.routeId === routeId);
        if (!route) {
          const health = resolution.routeHealth.find((candidate) => candidate.routeId === routeId);
          throw new Error(health?.reason ?? "Managed-account live route is unavailable.");
        }

        const orchestration = await runManagedAgentOrchestrationLifecycle({
          orchestrationRequest: buildManagedAgentBackgroundJobOrchestrationRequest({
            orchestrationId: `managed-account-live-${Date.now()}`,
            parentSessionId: "managed-account-live-parent",
            parentTurnId: "managed-account-live-parent:turn:1",
            requestedBy: "operator",
            requestSource: "live-test",
            roleIntent: "verifier",
            routeId,
            task: [
              "Call the read tool exactly once with filePath \"proof.txt\".",
              "Return the keyword in the form MANAGED_ACCOUNT_LIVE_PROOF:<keyword>.",
              "Do not guess, write files, or call any other tool.",
            ].join(" "),
            workingDirectoryMode: "read-only",
          }),
          managedInvocation,
          profile: "foundation-readonly-plan",
        });

        expect(orchestration.orchestrationResult).toMatchObject({
          mode: "background-job",
          status: "completed",
          succeededCount: 0,
          failedCount: 1,
        });
        expect(credentialResolutions).not.toHaveBeenCalled();
        await expect(workspace.readFile("proof.txt")).resolves.toContain(
          "keyword=kiln-managed-account-live-proof",
        );
      });
    }, 240_000);
  },
);

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

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must name the explicitly authorized managed route.`);
  return value;
}
