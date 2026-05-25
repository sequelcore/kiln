import { expect, it } from "vitest";
import {
  createSessionBuiltinToolOptions,
  defineManagedAgentInvocationRequest,
  defineManagedAgentWriteAuthority,
  defineManagedAgentWriteScope,
} from "@kilnai/core";
import {
  ManagedRuntimeCredentialRouteLeaseManager,
  RuntimeManagedAgentInvocationService,
} from "../../src/index.js";
import { createManagedDirectProviderAdapterFactory } from "../../../cli/src/config/managed-agent-direct-adapters.js";
import {
  KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV,
  describeManagedAgentProviderLive,
  expectManagedAgentLiveFilesystemAndEvidence,
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
        const model = process.env.KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL ?? "gpt-5.5";
        const adapter = await createManagedDirectProviderAdapterFactory({
          builtinToolOptions: createSessionBuiltinToolOptions(),
        })({
          id: "codex-oauth-readonly-live",
          kind: "direct",
          provider: "codex-oauth",
          model,
          profiles: ["foundation-readonly-plan"],
          workingDirectory: "project",
          tools: {
            allowed: ["read"],
            writes: false,
            network: false,
          },
          credentials: { mode: "runtime-selected" },
          memory: { access: "read-only" },
          timeoutMs: 120000,
        });
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

        const result = await createCodexOauthDirectLiveService().invoke(request, adapter);

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
        const model = process.env.KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL ?? "gpt-5.5";
        const adapter = await createManagedDirectProviderAdapterFactory({
          builtinToolOptions: createSessionBuiltinToolOptions(),
        })({
          id: "codex-oauth-approved-write-live",
          kind: "direct",
          provider: "codex-oauth",
          model,
          profiles: ["foundation-apply-approved-writes"],
          workingDirectory: "project",
          tools: {
            allowed: ["write"],
            writes: true,
            network: false,
          },
          credentials: { mode: "runtime-selected" },
          memory: { access: "write-proposals" },
          timeoutMs: 120000,
        });
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
              allowedToolNames: ["write"],
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
                  allowedToolNames: ["write"],
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
              "Call the write tool exactly once with filePath \"proof.txt\" and content \"after\\n\".",
              "Do not modify any other file.",
              "After the write succeeds, reply exactly:",
              "DIRECT_CODEX_OAUTH_WRITE_LIVE_PROOF:written",
            ].join("\n"),
          },
        });

        const result = await createCodexOauthDirectLiveService().invoke(request, adapter);

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
