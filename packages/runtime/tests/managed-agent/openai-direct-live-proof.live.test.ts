import { expect, it } from "vitest";
import { defineManagedAgentInvocationRequest } from "@kilnai/core/agents";
import { createSessionBuiltinToolOptions } from "@kilnai/core/tools";
import {
  DirectProviderCredentialPoolService,
  ManagedDirectProviderRuntimeAdapter,
  RuntimeManagedAgentInvocationService,
} from "../../src/index.js";
import { createAttachedRuntimeBuiltinToolSurface } from "../../src/gateway/attached-runtime-tool-surface.js";
import {
  KILN_LIVE_OPENAI_DIRECT_TESTS_ENV,
  describeManagedAgentProviderLive,
  makeManagedAgentLiveCapabilitySnapshotInput,
  withManagedAgentLiveFixtureWorkspace,
} from "./managed-agent-live-test-harness.js";

describeManagedAgentProviderLive("managed agent OpenAI direct-provider live proof", KILN_LIVE_OPENAI_DIRECT_TESTS_ENV, () => {
  it("reads a governed fixture through Kiln builtin tool authority", async () => {
    await withManagedAgentLiveFixtureWorkspace({
      prefix: "kiln-managed-agent-openai-direct-readonly-",
      files: {
        "proof.txt": [
          "Managed direct-provider live fixture.",
          "keyword=kiln-openai-direct-live-proof",
          "The child must obtain this keyword by calling the read tool.",
          "",
        ].join("\n"),
      },
      }, async (workspace) => {
      const model = process.env.KILN_LIVE_OPENAI_DIRECT_MODEL ?? "gpt-4o-mini";
      const service = new DirectProviderCredentialPoolService();
      const selected = (await service.listExecutionAccounts("openai"))[0];
      if (!selected) throw new Error("Live OpenAI proof requires one admitted exact credential.");
      const credential = await service.resolveExecutionCredential(selected);
      const provider = await service.createAdapterFromCredential({
        credential,
        defaultModel: model,
      });
      const childSurface = createAttachedRuntimeBuiltinToolSurface({
        builtinToolOptions: createSessionBuiltinToolOptions(),
      });
      const adapter = new ManagedDirectProviderRuntimeAdapter({
        providerId: "openai",
        model,
        provider,
        tools: childSurface.toolDefinitions,
        builtinTools: childSurface.callBuiltinTools,
        capabilityMap: childSurface.capabilities,
        toolAuthority: childSurface.toolAuthority,
        executionEnvelope: { toolRounds: { max: 4 } },
      });
      const request = defineManagedAgentInvocationRequest({
        invocationId: "invocation-openai-direct-live-readonly-1",
        agentId: "openai-direct-live:foundation-readonly-plan",
        parentSessionId: "session-openai-direct-live-parent",
        parentTurnId: "session-openai-direct-live-parent:turn:1",
        profile: "foundation-readonly-plan",
        requestedBy: "operator",
        requestSource: "live-test",
        providerRoute: {
          providerId: "openai",
          surface: "direct-provider",
          model,
        },
        adapterKind: "direct",
        executionMode: "direct-provider",
        authority: {
          authorityProfileId: "authority:openai-direct-live-readonly",
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
            routeId: "credential-route:openai:runtime-selected",
          },
          memoryScope: {
            scope: { kind: "project", id: "kiln" },
            access: "read-only",
          },
        },
        input: {
          summary: "Read the direct-provider live fixture through Kiln tools.",
          prompt: [
            "Call the read tool exactly once with filePath \"proof.txt\".",
            "After reading the file, reply with the keyword value in the form:",
            "DIRECT_OPENAI_LIVE_PROOF:<keyword>",
            "Do not guess the keyword. Do not modify files.",
          ].join("\n"),
        },
      });

      const result = await new RuntimeManagedAgentInvocationService()
        .invoke(request, adapter, makeManagedAgentLiveCapabilitySnapshotInput(request));

      expect(result.status).toBe("completed");
      if (result.status !== "completed") {
        throw new Error("Expected completed OpenAI direct-provider live proof");
      }
      expect(result.record.lifecycleState).toBe("completed");
      expect(result.record.resultHandoff?.summary).toContain("kiln-openai-direct-live-proof");
      await expect(workspace.readFile("proof.txt")).resolves.toContain("keyword=kiln-openai-direct-live-proof");
    });
  }, 180000);
});
