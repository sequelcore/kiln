import { expect, it } from "vitest";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import {
  ManagedCliHarnessAdapter,
  ManagedRuntimeCredentialRouteLeaseManager,
  RuntimeManagedAgentInvocationService,
  appendManagedInvocationSessionEvents,
} from "../../src/agents/managed-invocation/index.js";
import { OpenCodeSession } from "../../../cli/src/wrapper/opencode-session.js";
import {
  KILN_LIVE_OPENCODE_TESTS_ENV,
  KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV,
  describeManagedAgentProviderLive,
  expectManagedAgentLiveFilesystemAndEvidence,
  makeManagedAgentLiveCapabilitySnapshotInput,
  makeManagedAgentLiveHarnessReadOnlyRequest,
  makeManagedAgentLiveHarnessWriteRequest,
  withManagedAgentLiveFixtureWorkspace,
} from "./managed-agent-live-test-harness.js";
import type { CliSession, CliSessionFactory, SessionRunOptions } from "../../src/execution/cli-session-contract.js";

const itOpenCodeWriteProof = process.env[KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV] === "1" ? it : it.skip;

describeManagedAgentProviderLive("managed agent OpenCode live proof", KILN_LIVE_OPENCODE_TESTS_ENV, () => {
  itOpenCodeWriteProof("keeps the Kiln fixture boundary unchanged under read-only authority", async () => {
    await withManagedAgentLiveFixtureWorkspace({
      prefix: "kiln-managed-agent-opencode-readonly-",
      files: {
        "proof.txt": "before\n",
      },
    }, async (workspace) => {
      const model = requireOpenCodeLiveModel();
      const request = makeManagedAgentLiveHarnessReadOnlyRequest({
        invocationId: "invocation-opencode-live-readonly-1",
        workspaceRoot: workspace.workspaceRoot,
        providerId: "opencode",
        model,
        summary: "Attempt a write that Kiln must deny.",
        prompt: [
          "Perform exactly one OpenCode edit or write tool call against proof.txt.",
          "Replace the complete file contents with exactly the five ASCII characters: after",
          "Do not modify any other file.",
          "Do not claim completion unless the tool call returns a result.",
        ].join("\n"),
      });
      const adapter = new ManagedCliHarnessAdapter({
        providerId: "opencode",
        model,
        factory: createOpenCodeLiveSessionFactory({
          permissionDefault: "deny",
          model,
        }),
        filesystemBoundary: {
          enabled: true,
          trackedPaths: [workspace.filePath("proof.txt")],
          restoreReadOnlyViolations: true,
        },
      });
      const service = createOpenCodeLiveInvocationService();

      const result = await service.invoke(request, adapter, makeManagedAgentLiveCapabilitySnapshotInput(request));

      expect(result.status).toBe("completed");
      if (result.status !== "completed") {
        throw new Error("Expected completed OpenCode live read-only proof");
      }
      // OpenCode may suppress a denied tool before emitting a decision; this proves Kiln's effective boundary.
      await expect(workspace.readFile("proof.txt")).resolves.toBe("before\n");
      expect(result.record.writeEvidence?.some((evidence) =>
        evidence.kind === "write-proposal-approved" || evidence.kind === "write-attempt-completed",
      ) ?? false).toBe(false);
      expect(JSON.stringify(result.record.writeEvidence ?? [])).not.toContain("diff --git");
    });
  }, 180000);

  itOpenCodeWriteProof("records a real OpenCode approved fixture write as canonical write evidence", async () => {
    await withManagedAgentLiveFixtureWorkspace({
      prefix: "kiln-managed-agent-opencode-write-",
      files: {
        "proof.txt": "before\n",
      },
    }, async (workspace) => {
      const model = requireOpenCodeLiveModel();
      const request = makeManagedAgentLiveHarnessWriteRequest({
        invocationId: "invocation-opencode-live-write-1",
        workspaceRoot: workspace.workspaceRoot,
        allowedPaths: [workspace.workspaceRoot],
        providerId: "opencode",
        model,
        summary: "Apply one approved OpenCode fixture write.",
        prompt: [
          "Perform exactly one OpenCode edit or write tool call against proof.txt.",
          "Replace the complete file contents with exactly the five ASCII characters: after",
          "Do not modify any other file.",
          "Do not claim completion unless the tool call returns a result.",
        ].join("\n"),
      });
      const adapter = new ManagedCliHarnessAdapter({
        providerId: "opencode",
        model,
        factory: createOpenCodeLiveSessionFactory({
          permissionDefault: "allow",
          model,
        }),
        writeAuthority: {
          proposalSupported: true,
          approvedApplySupported: true,
          memoryProposalSupported: true,
          rollbackEvidence: true,
          cleanupEvidence: true,
          scopeReduction: true,
        },
        filesystemBoundary: {
          enabled: true,
          trackedPaths: [workspace.filePath("proof.txt")],
        },
      });
      const service = createOpenCodeLiveInvocationService();

      const result = await service.invoke(request, adapter, makeManagedAgentLiveCapabilitySnapshotInput(request));

      expect(result.status).toBe("completed");
      if (result.status !== "completed") {
        throw new Error("Expected completed OpenCode live write proof");
      }
      await expectManagedAgentLiveFilesystemAndEvidence({
        workspace,
        relativePath: "proof.txt",
        expectedContents: "after",
        evidence: result.record.writeEvidence ?? [],
        expectedEvidenceKinds: [
          "write-proposal-created",
          "write-proposal-approved",
          "write-attempt-completed",
        ],
        forbiddenInlineText: "diff --git",
      });

      const runtimeSession = new RuntimeSession({
        sessionId: request.parentSessionId,
        appName: "test-app",
        tenantId: "tenant-a",
        userId: "user-1",
        systemPrompt: "test",
      });
      const events = appendManagedInvocationSessionEvents({
        session: runtimeSession,
        request,
        decision: result.decision,
        record: result.record,
        durationMs: 20,
        timestamp: new Date("2026-05-05T12:00:00.000Z"),
      });

      expect(events[2].managedInvocationEvidence?.writeEvidence?.map((evidence) => evidence.kind)).toEqual([
        "write-proposal-created",
        "write-proposal-approved",
        "write-attempt-completed",
      ]);
      expect(JSON.stringify(events[2].managedInvocationEvidence)).not.toContain(workspace.workspaceRoot);
      expect(JSON.stringify(events[2].managedInvocationEvidence?.writeAuthority)).toContain(
        `kiln://managed-agents/invocations/${request.invocationId}/resources/write`,
      );
      expect(JSON.stringify(events[2].managedInvocationEvidence?.writeAuthority)).toContain(
        `kiln://managed-agents/invocations/${request.invocationId}/resources/approval`,
      );
    });
  }, 180000);

  it("keeps real OpenCode cancellation canonical and suppresses late write evidence", async () => {
    await withManagedAgentLiveFixtureWorkspace({
      prefix: "kiln-managed-agent-opencode-cancel-",
      files: {
        "proof.txt": "before\n",
      },
    }, async (workspace) => {
      const model = requireOpenCodeLiveModel();
      const runStarted = deferred<void>();
      const request = makeManagedAgentLiveHarnessWriteRequest({
        invocationId: "invocation-opencode-live-cancel-1",
        workspaceRoot: workspace.workspaceRoot,
        allowedPaths: [workspace.workspaceRoot],
        providerId: "opencode",
        model,
        summary: "Start an OpenCode live child that will be cancelled by Kiln.",
        prompt: [
          "Read proof.txt, then wait for further instructions from the operator.",
          "Do not edit proof.txt unless explicitly instructed later.",
          "Keep the turn active until the operator interrupts.",
        ].join("\n"),
      });
      const adapter = new ManagedCliHarnessAdapter({
        providerId: "opencode",
        model,
        factory: createObservedOpenCodeLiveSessionFactory({
          permissionDefault: "allow",
          model,
          onRunStarted: () => runStarted.resolve(),
        }),
        writeAuthority: {
          proposalSupported: true,
          approvedApplySupported: true,
          memoryProposalSupported: true,
          rollbackEvidence: true,
          cleanupEvidence: true,
          scopeReduction: true,
        },
        filesystemBoundary: {
          enabled: true,
          trackedPaths: [workspace.filePath("proof.txt")],
        },
      });
      const service = createOpenCodeLiveInvocationService();

      const started = await service.start(request, adapter, makeManagedAgentLiveCapabilitySnapshotInput(request));
      expect(started.status).toBe("started");
      await withTimeout(
        runStarted.promise,
        10_000,
        "OpenCode live run did not stay in flight long enough to cancel.",
      );

      const cancelled = await service.cancel(
        request.invocationId,
        "Operator cancelled the live OpenCode child run.",
      );
      const joined = await service.join(request.invocationId);

      expect(cancelled.status).toBe("cancelled");
      expect(joined.status).toBe("completed");
      if (joined.status !== "completed") {
        throw new Error("Expected completed OpenCode live cancellation proof");
      }
      expect(joined.record.lifecycleState).toBe("cancelled");
      expect(joined.record.resultHandoff?.summary)
        .toBe("Operator cancelled the live OpenCode child run.");
      await expect(workspace.readFile("proof.txt")).resolves.toBe("before\n");
      expect(joined.record.writeEvidence?.some((evidence) =>
        evidence.kind === "write-proposal-approved" || evidence.kind === "write-attempt-completed",
      ) ?? false).toBe(false);
      expect(JSON.stringify(joined.record.writeEvidence ?? [])).not.toContain("diff --git");

      await expectCancelledJoinStable({
        service,
        invocationId: request.invocationId,
        expectedSummary: "Operator cancelled the live OpenCode child run.",
        expectedWriteEvidence: joined.record.writeEvidence,
        readProofFile: () => workspace.readFile("proof.txt"),
        durationMs: 2_000,
        intervalMs: 250,
      });
    });
  }, 180000);
});

function requireOpenCodeLiveModel(): string {
  const model = process.env.KILN_LIVE_OPENCODE_MODEL?.trim();
  if (model === undefined || model.length === 0) {
    throw new Error(
      "OpenCode live proof requires explicit KILN_LIVE_OPENCODE_MODEL with proven native behavior.",
    );
  }
  return model;
}

function createOpenCodeLiveSessionFactory(options: {
  readonly permissionDefault: "allow" | "deny";
  readonly model: string;
}): CliSessionFactory {
  return (systemPrompt, cwd) => new OpenCodeSession({
    task: systemPrompt,
    cwd,
    model: options.model,
    permissionDefault: options.permissionDefault,
    sandboxMode: options.permissionDefault === "allow" ? "workspace-write" : "read-only",
    sessionLedgerOwner: "host",
  });
}

function createOpenCodeLiveInvocationService(): RuntimeManagedAgentInvocationService {
  return new RuntimeManagedAgentInvocationService({
    credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
      allowedRouteIds: ["credential-route:opencode"],
    }),
  });
}

function createObservedOpenCodeLiveSessionFactory(options: {
  readonly permissionDefault: "allow" | "deny";
  readonly model: string;
  readonly onRunStarted: () => void;
}): CliSessionFactory {
  const baseFactory = createOpenCodeLiveSessionFactory(options);
  return (systemPrompt, cwd, runtimeOptions) => {
    const session = baseFactory(systemPrompt, cwd, runtimeOptions);
    return observeCliSessionRun(session, options.onRunStarted);
  };
}

function observeCliSessionRun(session: CliSession, onRunStarted: () => void): CliSession {
  return {
    async *run(options: SessionRunOptions) {
      const iterator = session.run(options)[Symbol.asyncIterator]();
      const first = iterator.next();
      const firstObservation = await Promise.race([
        first.then((result) => ({ kind: "first" as const, result })),
        sleep(1_000).then(() => ({ kind: "pending" as const })),
      ]);
      let observedInFlight = firstObservation.kind === "pending";
      if (observedInFlight) {
        onRunStarted();
        const firstResult = await first;
        if (firstResult.done) {
          return;
        }
        yield firstResult.value;
      } else if (!firstObservation.result.done) {
        if (firstObservation.result.value.type !== "completed" && firstObservation.result.value.type !== "error") {
          observedInFlight = true;
          onRunStarted();
        }
        yield firstObservation.result.value;
      } else {
        return;
      }
      for (;;) {
        const next = await iterator.next();
        if (next.done) {
          return;
        }
        if (!observedInFlight && next.value.type !== "completed" && next.value.type !== "error") {
          observedInFlight = true;
          onRunStarted();
        }
        yield next.value;
      }
    },
    dispose() {
      return session.dispose();
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function expectCancelledJoinStable(input: {
  readonly service: RuntimeManagedAgentInvocationService;
  readonly invocationId: string;
  readonly expectedSummary: string;
  readonly expectedWriteEvidence: unknown;
  readonly readProofFile: () => Promise<string>;
  readonly durationMs: number;
  readonly intervalMs: number;
}): Promise<void> {
  const deadline = Date.now() + input.durationMs;
  do {
    await sleep(input.intervalMs);
    const joined = await input.service.join(input.invocationId);
    expect(joined.record.lifecycleState).toBe("cancelled");
    expect(joined.record.resultHandoff?.summary).toBe(input.expectedSummary);
    expect(joined.record.writeEvidence).toEqual(input.expectedWriteEvidence);
    await expect(input.readProofFile()).resolves.toBe("before\n");
  } while (Date.now() < deadline);
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
