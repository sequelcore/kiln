import { describe, expect, it } from "vitest";
import {
  deriveManagedInvocationCallerAuthority,
  resolveManagedInvocationCallerIdentity,
} from "../../src/agents/managed-invocation/caller-capability-policy.js";
import type { EffectiveTurnAuthoritySnapshot } from "../../src/session/runtime-session-orchestrator.types.js";
import type { RuntimeBuiltinToolExecutionContext } from "../../src/session/runtime-session-orchestrator.types.js";
import {
  executeManagedInvocationTool,
} from "../../src/agents/managed-invocation/runtime-tool/tool-executors.js";
import { executeManagedAgentOrchestrationTool } from "../../src/agents/managed-invocation/runtime-tool/orchestration-work-items.js";
import { RuntimeManagedAgentInvocationService } from "../../src/agents/managed-invocation/index.js";
import type { ManagedInvocationToolAttachment, ManagedInvocationToolOptions } from "../../src/agents/managed-invocation/runtime-tool/types.js";

describe("deriveManagedInvocationCallerAuthority", () => {
  const routeAllowedToolNames = ["read"];
  const authority = (admittedAuthority: EffectiveTurnAuthoritySnapshot["admittedAuthority"]): EffectiveTurnAuthoritySnapshot => ({
    executionMode: "execute",
    requestedAuthority: "auto",
    admittedAuthority,
    sourcePolicy: "runtime_surface_projection",
    reason: "test",
    completeness: "authoritative",
    toolCount: 1,
    deniedToolCount: 0,
  });

  it("keeps the independent no-identity profile read-only and non-recursive", () => {
    expect(deriveManagedInvocationCallerAuthority({ routeAllowedToolNames })).toEqual({
      authorityCeiling: "read_only",
      allowedToolNames: routeAllowedToolNames,
      allowsRecursion: false,
      allowsAttachments: false,
      allowsWrite: false,
    });
  });

  it.each([undefined, "auto"] as const)(
    "rejects an incomplete kiln-runtime caller with parent authority %s",
    (parentEffectiveRequestedAuthority) => {
      expect(() => deriveManagedInvocationCallerAuthority({
        callerIdentity: {
          kind: "kiln-runtime",
          surface: "test",
          attachmentId: "kiln-runtime:test",
          ...(parentEffectiveRequestedAuthority === undefined
            ? {}
            : { parentEffectiveRequestedAuthority }),
        },
        routeAllowedToolNames,
      })).toThrow("parentEffectiveRequestedAuthority");
    },
  );

  it("derives write and recursion only from an explicit parent authority", () => {
    expect(deriveManagedInvocationCallerAuthority({
      callerIdentity: {
        kind: "kiln-runtime",
        surface: "test",
        attachmentId: "kiln-runtime:test",
        parentEffectiveRequestedAuthority: "destructive",
      },
      routeAllowedToolNames,
    })).toEqual({
      authorityCeiling: "destructive",
      allowedToolNames: routeAllowedToolNames,
      allowsRecursion: true,
      allowsAttachments: true,
      allowsWrite: true,
    });
  });

  it.each([
    ["read_only", "read_only"],
    ["idempotent", "audited"],
    ["audited", "audited"],
    ["destructive", "destructive"],
  ] as const)("maps admitted turn authority %s to caller ceiling %s", (admittedAuthority, expected) => {
    const identity = resolveManagedInvocationCallerIdentity({
      kind: "kiln-runtime",
      surface: "test",
      attachmentId: "kiln-runtime:test",
    }, authority(admittedAuthority));
    expect(identity).toEqual({
      ok: true,
      callerIdentity: expect.objectContaining({ parentEffectiveRequestedAuthority: expected }),
    });
  });

  it.each([undefined, "unknown", "fail_closed"] as const)("rejects missing or unsafe admitted authority %s", (admittedAuthority) => {
    const result = resolveManagedInvocationCallerIdentity({
      kind: "kiln-runtime",
      surface: "test",
      attachmentId: "kiln-runtime:test",
    }, admittedAuthority === undefined ? undefined : authority(admittedAuthority));
    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("expected rejection");
    expect(result.reason).toContain("admitted effective turn authority");
  });

  it("blocks invoke and orchestrate before dispatch when the turn authority is unavailable", async () => {
    const callerIdentity = {
      kind: "kiln-runtime" as const,
      surface: "test",
      attachmentId: "kiln-runtime:test",
    };
    const options = { routes: [] } as ManagedInvocationToolOptions;
    const attachment: ManagedInvocationToolAttachment = { options, callerIdentity };
    const context = {
      session: { id: "session-test", userTurnCount: 0 } as RuntimeBuiltinToolExecutionContext["session"],
      toolCall: { id: "tool-call-test", name: "managed_agent.invoke", input: {} },
    } as RuntimeBuiltinToolExecutionContext;
    const service = new RuntimeManagedAgentInvocationService();

    const invokeResult = await executeManagedInvocationTool({}, context, attachment, service);
    expect(invokeResult).toMatchObject({
      isError: true,
      metadata: { errorCode: "managed_parent_authority_unavailable" },
    });

    const orchestrateResult = await executeManagedAgentOrchestrationTool({}, context, callerIdentity, {
      ...options,
      invocationService: service,
    });
    expect(orchestrateResult).toMatchObject({
      isError: true,
      metadata: { errorCode: "managed_parent_authority_unavailable" },
    });
  });
});
