import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { buildManagedAgentBackgroundJobOrchestrationRequest } from "@kilnai/core/agents";
import { createSessionBuiltinToolOptions } from "@kilnai/core/tools";
import {
  CodexOAuthCredentialPoolService,
  ConfiguredExecutionAccountRuntime,
  SqliteManagedAccountLeaseAuthority,
  runManagedAgentOrchestrationLifecycle,
} from "../../src/index.js";
import { createManagedDirectProviderAdapterFactory } from "../../../cli/src/config/managed-agent-direct-adapters.js";
import { discoverManagedAgentProviderModels } from "../../../cli/src/config/managed-agent-provider-models.js";
import { resolveManagedInvocationToolOptions } from "../../../cli/src/config/managed-agent-routes.js";
import { readGlobalConfig } from "../../../cli/src/config/global-config.js";
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

        const configuredRoute = config.managedAgents?.routes?.find((route) => route.id === routeId);
        if (
          !configuredRoute
          || configuredRoute.kind !== "direct"
          || configuredRoute.provider !== "codex-oauth"
          || configuredRoute.credentials?.mode !== "runtime-selected"
          || configuredRoute.tools?.writes !== false
          || configuredRoute.tools?.network !== false
        ) {
          throw new Error(
            "Managed-account live route must be a configured read-only Codex OAuth direct route.",
          );
        }
        const policy = config.modelGateway?.virtualModels.find(
          (candidate) => candidate.id === configuredRoute.credentials?.accountPolicyId,
        );
        if (!policy || policy.accountIds.length !== 2) {
          throw new Error("Managed-account live policy must configure exactly two account candidates.");
        }
        const policyCredentialIds = policy.accountIds.map((accountId) => {
          const account = config.modelGateway?.accounts.find((candidate) => candidate.id === accountId);
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
        const routing = new ConfiguredExecutionAccountRuntime({
          config: config.modelGateway,
          codexPool,
        });
        const usagePreflight = await routing.resolve({
          accountPolicyId: policy.id,
          providerRoute: {
            providerId: configuredRoute.provider,
            surface: "managed-account-live-preflight",
            model: configuredRoute.model,
          },
        });
        if (!usagePreflight.candidates.some(
          (candidate) =>
            candidate.usageEvidence.freshness === "fresh"
            && candidate.usageEvidence.availability === "available",
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
          surface: "cli",
          isProviderAvailable: (provider) => provider === "codex-oauth",
          providerModelEligibility: await discoverManagedAgentProviderModels(),
          directAdapterFactory: createManagedDirectProviderAdapterFactory({
            builtinToolOptions: createSessionBuiltinToolOptions(),
          }),
          managedAccountComposition: {
            routing,
            authority: leaseAuthority,
            updateConfig: (next) => routing.updateConfig(next),
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

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must name the explicitly authorized managed route.`);
  return value;
}
