import { describe, expect, it, vi } from "vitest";
import {
  defineManagedAgentCapabilitySnapshot,
  defineManagedAgentInvocationRecord,
  defineManagedAgentInvocationRequest,
  evaluateManagedAgentAdmission,
} from "@kilnai/core";
import type {
  ManagedAgentCapabilitySnapshotInput,
  ManagedAgentCapabilitySnapshot,
  ManagedAgentInvocationRequest,
} from "@kilnai/core";
import {
  RuntimeManagedAgentInvocationService,
} from "../../src/agents/managed-invocation/index.js";
import {
  ManagedRemoteHarnessAdapter,
} from "../../src/agents/managed-invocation/remote-harness-adapter.js";
import type {
  ManagedRemoteHarnessTransport,
} from "../../src/agents/managed-invocation/remote-harness-adapter.js";

function request(
  overrides: Partial<Parameters<typeof defineManagedAgentInvocationRequest>[0]> = {},
): ManagedAgentInvocationRequest {
  return defineManagedAgentInvocationRequest({
    invocationId: "inv-remote-1",
    agentId: "codex-cloud:foundation-readonly-plan",
    parentSessionId: "parent-session",
    parentTurnId: "parent-session:turn:1",
    profile: "foundation-readonly-plan",
    requestedBy: "assistant",
    requestSource: "test",
    providerRoute: {
      providerId: "codex-cloud",
      surface: "remote-harness",
      model: "gpt-5.5",
    },
    adapterKind: "harness",
    executionMode: "remote-harness",
    authority: {
      authorityProfileId: "authority:codex-cloud-remote:foundation-readonly-plan",
      permissionProfile: "read-only",
      toolAuthority: {
        allowedToolNames: ["read", "grep"],
        writeAllowed: false,
        networkAllowed: false,
      },
      workingDirectory: {
        path: "C:/repo",
        mode: "read-only",
      },
      timeoutMs: 5000,
      credentialRoute: {
        mode: "credentialless",
      },
      memoryScope: {
        scope: { kind: "project", id: "repo" },
        access: "read-only",
      },
    },
    input: {
      summary: "Inspect remote-managed docs.",
      prompt: "Read the admitted docs and summarize risks.",
    },
    ...overrides,
  });
}

function admitted(
  childRequest: ManagedAgentInvocationRequest,
  adapter: ManagedRemoteHarnessAdapter,
) {
  const decision = evaluateManagedAgentAdmission(childRequest, adapter.descriptor, snapshotInput());
  if (decision.status !== "admitted") {
    throw new Error(decision.reason);
  }
  return decision;
}

function snapshotInput(): ManagedAgentCapabilitySnapshotInput {
  return {
    capturedAt: "2026-05-07T08:00:00.000Z",
    routeId: "codex-cloud-remote-readonly",
    routeSource: "explicit-managed-route",
  };
}

function completedRecord(
  childRequest: ManagedAgentInvocationRequest,
  capabilitySnapshot: ManagedAgentCapabilitySnapshot,
) {
  return defineManagedAgentInvocationRecord({
    invocationId: childRequest.invocationId,
    agentId: childRequest.agentId,
    parentSessionId: childRequest.parentSessionId,
    parentTurnId: childRequest.parentTurnId,
    profile: childRequest.profile,
    lifecycleState: "completed",
    providerRoute: childRequest.providerRoute,
    adapterKind: childRequest.adapterKind,
    executionMode: childRequest.executionMode,
    authority: childRequest.authority,
    capabilitySnapshot,
    childSessionId: "remote-child-session",
    transcript: {
      uri: "kiln://managed-invocations/inv-remote-1/transcript",
      redacted: "unknown",
      truncated: false,
      persisted: true,
      retention: "external",
    },
    usage: {
      source: "adapter",
      tokenClasses: [
        { name: "input", value: "unknown" },
        { name: "output", value: "unknown" },
      ],
      cost: {
        currency: "unknown",
        amount: "unknown",
      },
    },
    resultHandoff: {
      summary: "Remote child completed.",
      resourceUris: ["kiln://managed-invocations/inv-remote-1/transcript"],
      memoryWriteProposalUris: [],
    },
  });
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("ManagedRemoteHarnessAdapter", () => {
  it("requires HTTPS endpoints for default remote transport", () => {
    expect(() => new ManagedRemoteHarnessAdapter({
      providerId: "codex-cloud",
      model: "gpt-5.5",
      invokeUrl: "http://remote.example.test/managed-agent/invoke",
      cancelUrl: "https://remote.example.test/managed-agent/cancel",
    })).toThrow("Managed remote harness invokeUrl is required");
  });

  it("invokes remote harness transport through the shared managed invocation contract", async () => {
    const childRequest = request();
    const transport: ManagedRemoteHarnessTransport = {
      invoke: vi.fn(async ({ request: sentRequest, admission }) =>
        completedRecord(sentRequest, admission.capabilitySnapshot)
      ),
      cancel: vi.fn(),
    };
    const adapter = new ManagedRemoteHarnessAdapter({
      providerId: "codex-cloud",
      model: "gpt-5.5",
      transport,
      limitations: [
        "Remote harness reports aggregate token classes only.",
      ],
    });
    const decision = admitted(childRequest, adapter);
    const registerExecutionSettlement = vi.fn();

    const record = await adapter.invoke({
      request: childRequest,
      admission: decision,
      abortSignal: new AbortController().signal,
      registerExecutionSettlement,
    });

    expect(adapter.descriptor).toMatchObject({
      adapterKind: "harness",
      providerId: "codex-cloud",
      supportedExecutionModes: ["remote-harness"],
      limitations: ["Remote harness reports aggregate token classes only."],
    });
    expect(transport.invoke).toHaveBeenCalledWith(expect.objectContaining({
      request: childRequest,
      admission: decision,
    }));
    expect(registerExecutionSettlement).toHaveBeenCalledOnce();
    expect(JSON.stringify((transport.invoke as ReturnType<typeof vi.fn>).mock.calls[0])).not.toContain("KILN_REMOTE_HARNESS_TOKEN");
    expect(record).toMatchObject({
      invocationId: "inv-remote-1",
      lifecycleState: "completed",
      adapterKind: "harness",
      executionMode: "remote-harness",
      providerRoute: {
        providerId: "codex-cloud",
        surface: "remote-harness",
        model: "gpt-5.5",
      },
      resultHandoff: {
        summary: "Remote child completed.",
      },
    });
  });

  it("cancels the remote harness without invoking when the parent aborts before transport start", async () => {
    const childRequest = request();
    const transport: ManagedRemoteHarnessTransport = {
      invoke: vi.fn(async ({ request: sentRequest, admission }) =>
        completedRecord(sentRequest, admission.capabilitySnapshot)
      ),
      cancel: vi.fn(async () => undefined),
    };
    const adapter = new ManagedRemoteHarnessAdapter({
      providerId: "codex-cloud",
      model: "gpt-5.5",
      transport,
    });
    const decision = admitted(childRequest, adapter);
    const controller = new AbortController();
    controller.abort("Operator stopped remote child.");

    const record = await adapter.invoke({
      request: childRequest,
      admission: decision,
      abortSignal: controller.signal,
    });

    expect(transport.invoke).not.toHaveBeenCalled();
    expect(transport.cancel).toHaveBeenCalledWith({
      invocationId: "inv-remote-1",
      request: childRequest,
      reason: "Operator stopped remote child.",
      abortSignal: controller.signal,
    });
    expect(record.lifecycleState).toBe("cancelled");
    expect(record.resultHandoff?.summary).toBe("Operator stopped remote child.");
  });

  it("still returns cancelled evidence when pre-start remote cancellation notification fails", async () => {
    const childRequest = request();
    const transport: ManagedRemoteHarnessTransport = {
      invoke: vi.fn(async ({ request: sentRequest, admission }) =>
        completedRecord(sentRequest, admission.capabilitySnapshot)
      ),
      cancel: vi.fn(async () => {
        throw new Error("remote cancel endpoint unavailable");
      }),
    };
    const adapter = new ManagedRemoteHarnessAdapter({
      providerId: "codex-cloud",
      model: "gpt-5.5",
      transport,
    });
    const decision = admitted(childRequest, adapter);
    const controller = new AbortController();
    controller.abort("Operator stopped remote child.");

    const record = await adapter.invoke({
      request: childRequest,
      admission: decision,
      abortSignal: controller.signal,
    });

    expect(transport.invoke).not.toHaveBeenCalled();
    expect(transport.cancel).toHaveBeenCalledTimes(1);
    expect(record.lifecycleState).toBe("cancelled");
    expect(record.resultHandoff?.summary).toBe("Operator stopped remote child.");
  });

  it("keeps runtime admission fail-closed when a remote harness broadens admitted evidence", async () => {
    const childRequest = request();
    const transport: ManagedRemoteHarnessTransport = {
      invoke: vi.fn(async ({ request: sentRequest, admission }) =>
        completedRecord(sentRequest, defineManagedAgentCapabilitySnapshot({
          ...admission.capabilitySnapshot,
          snapshotId: "broadened-remote-snapshot",
        }))
      ),
      cancel: vi.fn(),
    };
    const adapter = new ManagedRemoteHarnessAdapter({
      providerId: "codex-cloud",
      model: "gpt-5.5",
      transport,
    });
    const decision = admitted(childRequest, adapter);

    await expect(new RuntimeManagedAgentInvocationService().invokeAdmitted({
      request: childRequest,
      adapter,
      admission: decision,
    })).rejects.toThrow("Managed agent adapter returned capability snapshot outside the admitted request");
  });

  it("keeps runtime admission fail-closed when a remote harness spoofs top-level route identity", async () => {
    const childRequest = request();
    const transport: ManagedRemoteHarnessTransport = {
      invoke: vi.fn(async ({ request: sentRequest, admission }) => ({
        ...completedRecord(sentRequest, admission.capabilitySnapshot),
        providerRoute: {
          providerId: "spoofed-provider",
          surface: "remote-harness",
          model: "gpt-5.5",
        },
      })),
      cancel: vi.fn(),
    };
    const adapter = new ManagedRemoteHarnessAdapter({
      providerId: "codex-cloud",
      model: "gpt-5.5",
      transport,
    });
    const decision = admitted(childRequest, adapter);

    await expect(new RuntimeManagedAgentInvocationService().invokeAdmitted({
      request: childRequest,
      adapter,
      admission: decision,
    })).rejects.toThrow("Managed invocation usage route must match the admitted capability snapshot");
  });

  it("marks an in-flight remote invocation failed when remote cancellation notification fails", async () => {
    const childRequest = request();
    const terminal = deferred<unknown>();
    const transport: ManagedRemoteHarnessTransport = {
      invoke: vi.fn(async () => terminal.promise),
      cancel: vi.fn(async () => {
        throw new Error("remote cancel endpoint unavailable");
      }),
    };
    const adapter = new ManagedRemoteHarnessAdapter({
      providerId: "codex-cloud",
      model: "gpt-5.5",
      transport,
    });
    const service = new RuntimeManagedAgentInvocationService();

    const started = await service.start(childRequest, adapter, snapshotInput());
    expect(started.status).toBe("started");
    expect(transport.invoke).toHaveBeenCalledTimes(1);

    await expect(service.cancel(childRequest.invocationId, "Operator stopped remote child."))
      .rejects.toThrow("remote cancel endpoint unavailable");

    const snapshot = service.status(childRequest.invocationId);
    expect(snapshot?.lifecycleState).toBe("failed");
    expect(snapshot?.record?.lifecycleState).toBe("failed");
    expect(snapshot?.record?.resultHandoff?.summary).toContain("Managed invocation cancellation failed");

    terminal.resolve(completedRecord(childRequest, admitted(childRequest, adapter).capabilitySnapshot));
    const joined = await service.join(childRequest.invocationId);
    expect(joined.status).toBe("completed");
    expect(joined.record.lifecycleState).toBe("failed");
  });
});
