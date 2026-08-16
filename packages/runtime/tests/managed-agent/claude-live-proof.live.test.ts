import { expect, it } from "vitest";
import {
  ManagedCliHarnessAdapter,
  ManagedRuntimeCredentialRouteLeaseManager,
  RuntimeManagedAgentInvocationService,
} from "../../src/agents/managed-invocation/index.js";
import {
  discoverClaudeCliModelDiscovery,
  resolveClaudeCodeExecutable,
} from "../../src/gateway/gui-provider-models.js";
import { ClaudeSession } from "../../../cli/src/wrapper/claude-code-process.js";
import {
  KILN_LIVE_CLAUDE_TESTS_ENV,
  describeManagedAgentProviderLive,
  expectManagedAgentLiveDurableEvidenceSafe,
  makeManagedAgentLiveCapabilitySnapshotInput,
  makeManagedAgentLiveHarnessReadOnlyRequest,
  withManagedAgentLiveFixtureWorkspace,
} from "./managed-agent-live-test-harness.js";
import type { CliSessionFactory } from "../../src/execution/cli-session-contract.js";
import {
  defineDeliberationLevelId,
  type DeliberationResolution,
  type ModelDeliberationCapabilities,
} from "@kilnai/core/agents";

describeManagedAgentProviderLive("managed agent Claude Code live proof", KILN_LIVE_CLAUDE_TESTS_ENV, () => {
  it("runs a read-only managed child in Claude plan mode without changing the fixture", async () => {
    await withManagedAgentLiveFixtureWorkspace({
      prefix: "kiln-managed-agent-claude-readonly-",
      files: { "proof.txt": "before\n" },
    }, async (workspace) => {
      const model = requireExplicitClaudeModel(process.env.KILN_LIVE_CLAUDE_MODEL);
      const executable = resolveClaudeCodeExecutable();
      if (executable === undefined) {
        throw new Error("The authorized Claude live proof requires an operator Claude Code executable and version.");
      }
      const discovery = await discoverClaudeCliModelDiscovery();
      expect(discovery.status).toBe("available");
      expect(discovery.models).toContain(model);
      const deliberationCapabilities = toClaudeDeliberationCapabilities(
        model,
        discovery.modelCapabilities?.[model]?.deliberation,
      );
      expect(deliberationCapabilities.levels.map((level) => level.id)).toContain("low");
      let observedPermissionMode: "plan" | "default" | undefined;
      let observedDeliberationResolution: DeliberationResolution | undefined;
      const request = makeManagedAgentLiveHarnessReadOnlyRequest({
        invocationId: "invocation-claude-live-readonly-1",
        workspaceRoot: workspace.workspaceRoot,
        providerId: "claude",
        model,
        summary: "Inspect a fixture through Claude Code plan mode.",
        prompt: "Read proof.txt and report its exact contents. Do not write, create, delete, or rename any file.",
        deliberationIntent: { mode: "fixed", preferredLevel: "low", onUnsupported: "deny" },
        handoff: {
          roleIntent: "read-only fixture inspector",
          requiredResultFields: ["summary"],
          doneCriteria: ["Report the exact contents of proof.txt without changing the workspace."],
        },
      });
      const adapter = new ManagedCliHarnessAdapter({
        providerId: "claude",
        model,
        factory: createClaudeLiveSessionFactory(
          model,
          executable,
          (mode) => { observedPermissionMode = mode; },
          (resolution) => { observedDeliberationResolution = resolution; },
        ),
        deliberationCapabilities,
        filesystemBoundary: { enabled: true, trackedPaths: [workspace.filePath("proof.txt")], restoreReadOnlyViolations: true },
      });

      const result = await new RuntimeManagedAgentInvocationService({
        credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
          allowedRouteIds: ["credential-route:claude"],
        }),
      }).invoke(
        request,
        adapter,
        makeManagedAgentLiveCapabilitySnapshotInput(request),
      );

      expect(result.status).toBe("completed");
      expect(result.record.lifecycleState, JSON.stringify(result.record.resultHandoff)).toBe("completed");
      expect(observedPermissionMode).toBe("plan");
      expect(observedDeliberationResolution).toMatchObject({
        status: "exact",
        selectedLevel: "low",
        capabilityEvidence: deliberationCapabilities.evidence,
      });
      expect(result.record.resultHandoff?.structuredResult).toMatchObject({
        version: "structured-execution-result-v1",
        status: "completed",
      });
      expect(JSON.stringify(result.record.resultHandoff?.structuredResult)).toContain("before");
      expect(result.record.resultHandoff?.provenance).toMatchObject({
        delivery: "native-structured-output",
        configuredModelId: model,
        harness: {
          id: "claude-code",
          executable: executable.evidence.executable,
          version: executable.evidence.version,
        },
      });
      expect(result.record.resultHandoff?.provenance.primaryObservedModelId).toBe(model);
      expect(result.record.resultHandoff?.provenance.observedModelIds).toContain(model);
      expect(result.record.resultHandoff?.provenance.observedModelIds).not.toContain("default");
      await expect(workspace.readFile("proof.txt")).resolves.toBe("before\n");
      expect(result.record.writeEvidence ?? []).toEqual([]);
      expectManagedAgentLiveDurableEvidenceSafe({
        evidence: {
          resultHandoff: result.record.resultHandoff,
          diagnostics: result.record.diagnostics,
          transcript: result.record.transcript,
          usage: result.record.usage,
          writeEvidence: result.record.writeEvidence,
        },
        forbiddenPaths: [workspace.workspaceRoot, executable.path],
      });
    });
  }, 240000);
});

function createClaudeLiveSessionFactory(
  model: string,
  executable: NonNullable<ReturnType<typeof resolveClaudeCodeExecutable>>,
  observePermissionMode: (mode: "plan" | "default") => void,
  observeDeliberationResolution: (resolution: DeliberationResolution | undefined) => void,
): CliSessionFactory {
  return (systemPrompt, cwd, context) => {
    const permissionMode = context?.permissionPolicy?.approval === "untrusted" ? "plan" : "default";
    observePermissionMode(permissionMode);
    observeDeliberationResolution(context?.deliberationResolution);
    return new ClaudeSession({
      task: systemPrompt,
      systemPrompt,
      cwd,
      model,
      permissionMode,
      sessionLedgerOwner: "host",
      harnessExecutable: executable.path,
      harnessEvidence: executable.evidence,
      ...(context?.deliberationResolution ? { deliberationResolution: context.deliberationResolution } : {}),
      ...(context?.structuredOutput ? { structuredOutputSchema: context.structuredOutput.schema } : {}),
    });
  };
}

function toClaudeDeliberationCapabilities(
  model: string,
  capability: NonNullable<NonNullable<Awaited<ReturnType<typeof discoverClaudeCliModelDiscovery>>["modelCapabilities"]>[string]>["deliberation"],
): ModelDeliberationCapabilities {
  if (!capability || capability.provider !== "claude" || capability.model !== model) {
    throw new Error(`Claude catalog did not return exact deliberation capability evidence for '${model}'.`);
  }
  return {
    provider: capability.provider,
    model: capability.model,
    levels: capability.levels.map((level) => ({
      id: defineDeliberationLevelId(level.id),
      ...(level.nativeId ? { nativeId: level.nativeId } : {}),
    })),
    ...(capability.defaultLevel
      ? { defaultLevel: defineDeliberationLevelId(capability.defaultLevel) }
      : {}),
    supportsAdaptive: capability.supportsAdaptive,
    evidence: capability.evidence,
  };
}

function requireExplicitClaudeModel(value: string | undefined): string {
  const model = value?.trim();
  if (!model) {
    throw new Error("KILN_LIVE_CLAUDE_MODEL must name the explicit Claude catalog value authorized for this probe.");
  }
  if (["default", "sonnet", "opus", "haiku"].includes(model)) {
    throw new Error(`KILN_LIVE_CLAUDE_MODEL cannot use the moving Claude alias '${model}'.`);
  }
  return model;
}
