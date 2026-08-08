import {
  OPERATOR_RUNTIME_AUDIENCE,
  OPERATOR_RUNTIME_PROTOCOL_VERSION,
  type OperatorProjectBinding,
  type OperatorSessionClaims,
} from "@kilnai/gateway-contracts";
import { describe, expect, it, vi } from "vitest";

import {
  ProjectRuntimeRegistry,
  ProjectRuntimeRegistryError,
  type ProjectRuntimeRegistryDescriptor,
} from "../../src/operator-runtime/project-runtime-registry.js";

const PROJECT_A_ID = `krp_${"a".repeat(64)}`;
const PROJECT_B_ID = `krp_${"b".repeat(64)}`;
const MARKER_1 = `sha256:${"1".repeat(64)}`;
const MARKER_2 = `sha256:${"2".repeat(64)}`;
const MARKER_3 = `sha256:${"3".repeat(64)}`;

interface TestRuntime {
  readonly name: string;
  close(): Promise<void>;
}

function descriptor(
  projectRuntimeId = PROJECT_A_ID,
  markerDigest = MARKER_1,
  canonicalRoot = "canonical-project-a",
): ProjectRuntimeRegistryDescriptor {
  return {
    canonicalRoot,
    binding: { projectRuntimeId, markerDigest },
  };
}

function claims(binding: OperatorProjectBinding): OperatorSessionClaims {
  return {
    protocolVersion: OPERATOR_RUNTIME_PROTOCOL_VERSION,
    audience: OPERATOR_RUNTIME_AUDIENCE,
    ...binding,
    harness: "codex",
    sessionId: "session-1",
    issuedAt: 1,
    expiresAt: 2,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("ProjectRuntimeRegistry", () => {
  it("coalesces concurrent creation and recovery for the same project", async () => {
    const pending = deferred<TestRuntime>();
    const factory = vi.fn(() => pending.promise);
    const registry = new ProjectRuntimeRegistry(factory);
    const input = descriptor();

    const first = registry.ensure(input);
    const second = registry.ensure(input);
    expect(factory).toHaveBeenCalledTimes(1);

    const runtime = { name: "a", close: vi.fn(async () => undefined) };
    pending.resolve(runtime);
    await expect(Promise.all([first, second])).resolves.toEqual([
      runtime,
      runtime,
    ]);
    expect(registry.lookup(input.binding)).toBe(runtime);
  });

  it("keeps different projects isolated", async () => {
    const factory = vi.fn(
      async (
        input: ProjectRuntimeRegistryDescriptor,
      ): Promise<TestRuntime> => ({
        name: input.binding.projectRuntimeId,
        close: vi.fn(async () => undefined),
      }),
    );
    const registry = new ProjectRuntimeRegistry(factory);
    const projectA = descriptor();
    const projectB = descriptor(PROJECT_B_ID, MARKER_1, "canonical-project-b");

    const [runtimeA, runtimeB] = await Promise.all([
      registry.ensure(projectA),
      registry.ensure(projectB),
    ]);

    expect(runtimeA).not.toBe(runtimeB);
    expect(registry.lookup(projectA.binding)).toBe(runtimeA);
    expect(registry.lookup(projectB.binding)).toBe(runtimeB);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("fails closed when an identity is reused for a different canonical root", async () => {
    const registry = new ProjectRuntimeRegistry<TestRuntime>(async () => ({
      name: "a",
      close: async () => undefined,
    }));
    await registry.ensure(descriptor());

    const attempt = registry.ensure(
      descriptor(PROJECT_A_ID, MARKER_1, "sensitive-other-root"),
    );

    await expect(attempt).rejects.toMatchObject<ProjectRuntimeRegistryError>({
      code: "identity_collision",
    });
    await expect(attempt).rejects.not.toThrow(
      /sensitive-other-root|canonical-project-a/,
    );
  });

  it("closes the old binding before creating one fresh owner", async () => {
    const closing = deferred<void>();
    const firstRuntime = { name: "first", close: vi.fn(() => closing.promise) };
    const secondRuntime = { name: "second", close: vi.fn(async () => undefined) };
    const factory = vi
      .fn<(_: ProjectRuntimeRegistryDescriptor) => Promise<TestRuntime>>()
      .mockResolvedValueOnce(firstRuntime)
      .mockResolvedValueOnce(secondRuntime);
    const registry = new ProjectRuntimeRegistry(factory);
    const initial = descriptor();
    const advanced = descriptor(PROJECT_A_ID, MARKER_2);
    await registry.ensure(initial);

    const replacement = registry.ensure(advanced);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(() => registry.lookup(claims(initial.binding))).toThrowError(
      expect.objectContaining({ code: "runtime_unavailable" }),
    );
    expect(() => registry.lookup(claims(advanced.binding))).toThrowError(
      expect.objectContaining({ code: "runtime_unavailable" }),
    );

    closing.resolve();
    await expect(replacement).resolves.toBe(secondRuntime);
    expect(firstRuntime.close).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(firstRuntime.close.mock.invocationCallOrder[0]).toBeLessThan(
      factory.mock.invocationCallOrder[1]!,
    );
    expect(registry.lookup(claims(advanced.binding))).toBe(secondRuntime);
    expect(registry.statuses()).toEqual([
      {
        protocolVersion: OPERATOR_RUNTIME_PROTOCOL_VERSION,
        binding: advanced.binding,
        lifecycle: "ready",
        diagnostic: "none",
      },
    ]);
  });

  it("coalesces concurrent replacement ensures for the same new binding", async () => {
    const closing = deferred<void>();
    const replacementCreation = deferred<TestRuntime>();
    const firstRuntime = { name: "first", close: vi.fn(() => closing.promise) };
    const secondRuntime = { name: "second", close: vi.fn(async () => undefined) };
    const factory = vi
      .fn<(_: ProjectRuntimeRegistryDescriptor) => Promise<TestRuntime>>()
      .mockResolvedValueOnce(firstRuntime)
      .mockImplementationOnce(() => replacementCreation.promise);
    const registry = new ProjectRuntimeRegistry(factory);
    await registry.ensure(descriptor());

    const first = registry.ensure(descriptor(PROJECT_A_ID, MARKER_2));
    const second = registry.ensure(descriptor(PROJECT_A_ID, MARKER_2));
    closing.resolve();
    replacementCreation.resolve(secondRuntime);
    await expect(Promise.all([first, second])).resolves.toEqual([
      secondRuntime,
      secondRuntime,
    ]);
    expect(firstRuntime.close).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("waits for creation and close when the binding changes during creation", async () => {
    const firstCreation = deferred<TestRuntime>();
    const closing = deferred<void>();
    const firstRuntime = { name: "first", close: vi.fn(() => closing.promise) };
    const secondRuntime = { name: "second", close: vi.fn(async () => undefined) };
    const factory = vi
      .fn<(_: ProjectRuntimeRegistryDescriptor) => Promise<TestRuntime>>()
      .mockImplementationOnce(() => firstCreation.promise)
      .mockResolvedValueOnce(secondRuntime);
    const registry = new ProjectRuntimeRegistry(factory);

    const initial = registry.ensure(descriptor());
    const replacement = registry.ensure(descriptor(PROJECT_A_ID, MARKER_2));
    expect(factory).toHaveBeenCalledTimes(1);
    firstCreation.resolve(firstRuntime);
    await expect(initial).resolves.toBe(firstRuntime);
    await Promise.resolve();
    await Promise.resolve();
    expect(firstRuntime.close).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(1);

    closing.resolve();
    await expect(replacement).resolves.toBe(secondRuntime);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("serializes another binding change that arrives while the old owner is closing", async () => {
    const firstClosing = deferred<void>();
    const firstRuntime = { name: "first", close: vi.fn(() => firstClosing.promise) };
    const secondRuntime = { name: "second", close: vi.fn(async () => undefined) };
    const thirdRuntime = { name: "third", close: vi.fn(async () => undefined) };
    const factory = vi
      .fn<(_: ProjectRuntimeRegistryDescriptor) => Promise<TestRuntime>>()
      .mockResolvedValueOnce(firstRuntime)
      .mockResolvedValueOnce(secondRuntime)
      .mockResolvedValueOnce(thirdRuntime);
    const registry = new ProjectRuntimeRegistry(factory);
    await registry.ensure(descriptor());

    const second = registry.ensure(descriptor(PROJECT_A_ID, MARKER_2));
    const third = registry.ensure(descriptor(PROJECT_A_ID, MARKER_3));
    expect(factory).toHaveBeenCalledTimes(1);
    firstClosing.resolve();

    await expect(second).resolves.toBe(secondRuntime);
    await expect(third).resolves.toBe(thirdRuntime);
    expect(firstRuntime.close).toHaveBeenCalledTimes(1);
    expect(secondRuntime.close).toHaveBeenCalledTimes(1);
    expect(firstRuntime.close.mock.invocationCallOrder[0]).toBeLessThan(
      factory.mock.invocationCallOrder[1]!,
    );
    expect(secondRuntime.close.mock.invocationCallOrder[0]).toBeLessThan(
      factory.mock.invocationCallOrder[2]!,
    );
    expect(registry.lookup(descriptor(PROJECT_A_ID, MARKER_3).binding)).toBe(thirdRuntime);
  });

  it("removes a failed creation so a later ensure can retry", async () => {
    const runtime = { name: "recovered", close: vi.fn(async () => undefined) };
    const factory = vi
      .fn<(_: ProjectRuntimeRegistryDescriptor) => Promise<TestRuntime>>()
      .mockRejectedValueOnce(new Error("private factory failure"))
      .mockResolvedValueOnce(runtime);
    const registry = new ProjectRuntimeRegistry(factory);

    await expect(registry.ensure(descriptor())).rejects.toThrow(
      "private factory failure",
    );
    await expect(registry.ensure(descriptor())).resolves.toBe(runtime);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("waits for close before allowing ensure to create a replacement", async () => {
    const closing = deferred<void>();
    const firstRuntime = { name: "first", close: vi.fn(() => closing.promise) };
    const secondRuntime = {
      name: "second",
      close: vi.fn(async () => undefined),
    };
    const factory = vi
      .fn<(_: ProjectRuntimeRegistryDescriptor) => Promise<TestRuntime>>()
      .mockResolvedValueOnce(firstRuntime)
      .mockResolvedValueOnce(secondRuntime);
    const registry = new ProjectRuntimeRegistry(factory);
    await registry.ensure(descriptor());

    const close = registry.close(PROJECT_A_ID);
    const replacement = registry.ensure(descriptor());
    await Promise.resolve();
    expect(factory).toHaveBeenCalledTimes(1);

    closing.resolve();
    await expect(close).resolves.toBeUndefined();
    await expect(replacement).resolves.toBe(secondRuntime);
    expect(factory).toHaveBeenCalledTimes(2);
    await expect(registry.close(PROJECT_A_ID)).resolves.toBeUndefined();
    await expect(registry.close(PROJECT_A_ID)).resolves.toBeUndefined();
    expect(secondRuntime.close).toHaveBeenCalledTimes(1);
  });

  it("does not let a late stale-binding close target a fresh owner", async () => {
    const firstRuntime = { name: "first", close: vi.fn(async () => undefined) };
    const secondRuntime = { name: "second", close: vi.fn(async () => undefined) };
    const registry = new ProjectRuntimeRegistry<TestRuntime>(
      vi.fn().mockResolvedValueOnce(firstRuntime).mockResolvedValueOnce(secondRuntime),
    );
    const initial = descriptor();
    const advanced = descriptor(PROJECT_A_ID, MARKER_2);
    await registry.ensure(initial);
    await registry.ensure(advanced);

    await expect(registry.close(PROJECT_A_ID, MARKER_1)).resolves.toBeUndefined();

    expect(secondRuntime.close).not.toHaveBeenCalled();
    expect(registry.lookup(advanced.binding)).toBe(secondRuntime);
  });

  it("fails closed after close failure and never creates a possibly overlapping owner", async () => {
    const firstRuntime = {
      name: "first",
      close: vi.fn(async () => {
        throw new Error("secret close detail");
      }),
    };
    const registry = new ProjectRuntimeRegistry<TestRuntime>(
      vi
        .fn()
        .mockResolvedValueOnce(firstRuntime),
    );
    await registry.ensure(descriptor());

    const close = registry.close(PROJECT_A_ID);
    await expect(close).rejects.toMatchObject<ProjectRuntimeRegistryError>({
      code: "close_failed",
      failureCount: 1,
    });
    await expect(close).rejects.not.toThrow(
      /secret close detail|canonical-project-a/,
    );
    const retry = registry.ensure(descriptor());
    await expect(retry).rejects.toMatchObject<ProjectRuntimeRegistryError>({
      code: "close_failed",
    });
    expect(registry.statuses()).toHaveLength(1);
  });

  it("closes every owner, reports a safe aggregate, and retains failed owners unavailable", async () => {
    const registry = new ProjectRuntimeRegistry<TestRuntime>(async (input) => ({
      name: input.binding.projectRuntimeId,
      close: async () => {
        if (input.binding.projectRuntimeId === PROJECT_A_ID)
          throw new Error("private project failure");
      },
    }));
    await registry.ensure(descriptor());
    await registry.ensure(
      descriptor(PROJECT_B_ID, MARKER_1, "canonical-project-b"),
    );

    const close = registry.closeAll();
    await expect(close).rejects.toMatchObject<ProjectRuntimeRegistryError>({
      code: "close_failed",
      failureCount: 1,
    });
    await expect(close).rejects.not.toThrow(
      /private project failure|canonical-project/,
    );
    expect(registry.statuses()).toEqual([
      {
        protocolVersion: OPERATOR_RUNTIME_PROTOCOL_VERSION,
        binding: descriptor().binding,
        lifecycle: "unavailable",
        diagnostic: "project_unavailable",
      },
    ]);
    await expect(registry.closeAll()).rejects.toMatchObject<ProjectRuntimeRegistryError>({
      code: "close_failed",
      failureCount: 1,
    });
  });

  it("never exposes canonical roots or runtime values in public status", async () => {
    const runtime = {
      name: "sensitive-runtime-value",
      close: vi.fn(async () => undefined),
    };
    const registry = new ProjectRuntimeRegistry<TestRuntime>(
      async () => runtime,
    );
    const input = descriptor(
      PROJECT_A_ID,
      MARKER_1,
      "sensitive-canonical-root",
    );
    const creation = registry.ensure(input);

    expect(JSON.stringify(registry.statuses())).not.toMatch(
      /sensitive-canonical-root|sensitive-runtime-value/,
    );
    await creation;
    expect(JSON.stringify(registry.statuses())).not.toMatch(
      /sensitive-canonical-root|sensitive-runtime-value/,
    );
  });
});
