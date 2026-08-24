import { describe, expect, it, vi } from "vitest";
import type { KilnSkillCatalogSnapshot } from "@kilnai/gateway-contracts";
import {
  SkillCatalogDiagnosticInventory,
  createSkillCatalogDiagnosticWorkerScanner,
  type SkillCatalogDiagnosticWorkerPort,
} from "../../src/config/skill-catalog-diagnostics.js";

const OPTIONS = { projectPath: "C:/synthetic/project", userHome: "C:/synthetic/operator" } as const;

function catalog(entries = 1): KilnSkillCatalogSnapshot {
  return {
    entries: Array.from({ length: entries }, (_, index) => ({
      name: `skill-${index}`,
      description: "Synthetic diagnostic fixture.",
      origin: "project" as const,
      configured: true,
      builtIn: false,
      sourcePath: `skills/skill-${index}/SKILL.md`,
      desiredVisibility: "implicit" as const,
      admission: { state: "available" as const, reason: "Synthetic fixture." },
      projections: [],
    })),
    inventory: {
      complete: true,
      candidates: [],
      sources: [],
      identities: [],
      resolutions: [],
      harnesses: [],
      diagnostics: [],
    },
  };
}

describe("SkillCatalogDiagnosticInventory", () => {
  it("returns pending immediately and single-flights concurrent refreshes", async () => {
    let resolveScan: ((value: KilnSkillCatalogSnapshot) => void) | undefined;
    const scan = vi.fn(() => new Promise<KilnSkillCatalogSnapshot>((resolve) => {
      resolveScan = resolve;
    }));
    const inventory = new SkillCatalogDiagnosticInventory(scan);

    expect(inventory.read(OPTIONS)).toEqual({ lifecycle: { state: "pending" } });
    const first = inventory.refresh(OPTIONS);
    const second = inventory.refresh(OPTIONS);
    expect(scan).toHaveBeenCalledTimes(1);

    resolveScan?.(catalog());
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ lifecycle: expect.objectContaining({ state: "current" }) }),
      expect.objectContaining({ lifecycle: expect.objectContaining({ state: "current" }) }),
    ]);
  });

  it("terminates a worker that exceeds the internal diagnostic deadline and ignores late settlement", async () => {
    vi.useFakeTimers();
    try {
      const worker = new ControlledDiagnosticWorker();
      const scanner = createSkillCatalogDiagnosticWorkerScanner({
        createWorker: vi.fn(() => worker),
        timeoutMs: 100,
      });
      const inventory = new SkillCatalogDiagnosticInventory(scanner);

      const refresh = inventory.refresh(OPTIONS);
      await vi.advanceTimersByTimeAsync(100);
      await expect(refresh).resolves.toEqual({
        lifecycle: { state: "failed", reason: "Skill diagnostic inventory failed; use an explicit setup refresh to retry." },
      });
      expect(worker.terminate).toHaveBeenCalledTimes(1);

      worker.emit("message", { ok: true, catalog: catalog() });
      worker.emit("error", new Error("late worker error"));
      expect(inventory.read(OPTIONS)).toEqual({
        lifecycle: { state: "failed", reason: "Skill diagnostic inventory failed; use an explicit setup refresh to retry." },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the diagnostic deadline when a worker settles normally", async () => {
    vi.useFakeTimers();
    try {
      const worker = new ControlledDiagnosticWorker();
      const scanner = createSkillCatalogDiagnosticWorkerScanner({
        createWorker: () => worker,
        timeoutMs: 100,
      });
      const refresh = scanner(OPTIONS);
      worker.emit("message", { ok: true, catalog: catalog() });

      await expect(refresh).resolves.toEqual(catalog());
      await vi.advanceTimersByTimeAsync(100);
      expect(worker.terminate).not.toHaveBeenCalled();
      expect(worker.unref).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["error", new Error("synthetic worker failure")],
    ["exit", 7],
  ] as const)("clears the diagnostic deadline when the worker settles through %s", async (event, value) => {
    vi.useFakeTimers();
    try {
      const worker = new ControlledDiagnosticWorker();
      const scanner = createSkillCatalogDiagnosticWorkerScanner({
        createWorker: () => worker,
        timeoutMs: 100,
      });
      const refresh = scanner(OPTIONS);
      worker.emit(event, value);

      await expect(refresh).rejects.toBeInstanceOf(Error);
      await vi.advanceTimersByTimeAsync(100);
      expect(worker.terminate).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles a stale refresh failure without launching a replacement scan", async () => {
    let now = new Date("2026-08-24T12:00:00.000Z");
    const scans: Array<() => Promise<KilnSkillCatalogSnapshot>> = [
      async () => catalog(0),
      async () => { throw new Error("synthetic inventory failure"); },
    ];
    const scan = vi.fn(() => (scans.shift()?.() ?? Promise.reject(new Error("unexpected scan"))));
    const inventory = new SkillCatalogDiagnosticInventory(
      scan,
      () => now,
      100,
    );

    await expect(inventory.refresh(OPTIONS)).resolves.toMatchObject({
      lifecycle: { state: "empty", observedAt: now.toISOString() },
    });
    now = new Date(now.getTime() + 101);
    expect(inventory.read(OPTIONS)).toMatchObject({ lifecycle: { state: "stale" } });
    await expect(inventory.refresh(OPTIONS)).resolves.toMatchObject({
      lifecycle: {
        state: "failed",
        reason: "Skill diagnostic inventory failed; use an explicit setup refresh to retry.",
        observedAt: "2026-08-24T12:00:00.000Z",
      },
      catalog: catalog(0),
    });
    expect(inventory.read(OPTIONS)).toMatchObject({ lifecycle: { state: "failed" }, catalog: catalog(0) });
    expect(scan).toHaveBeenCalledTimes(2);

    const failed = new SkillCatalogDiagnosticInventory(async () => {
      throw new Error("first scan failed");
    });
    await expect(failed.refresh({ ...OPTIONS, projectPath: "C:/synthetic/other" })).resolves.toEqual({
      lifecycle: { state: "failed", reason: "Skill diagnostic inventory failed; use an explicit setup refresh to retry." },
    });
  });

  it("evicts the least-recently-used settled entry without abandoning live work", async () => {
    const scan = vi.fn(async () => catalog());
    const inventory = new SkillCatalogDiagnosticInventory(scan, () => new Date(), 10_000, 2);
    const first = { ...OPTIONS, projectPath: "C:/synthetic/first" };
    const second = { ...OPTIONS, projectPath: "C:/synthetic/second" };
    const third = { ...OPTIONS, projectPath: "C:/synthetic/third" };

    await inventory.refresh(first);
    await inventory.refresh(second);
    inventory.read(first);
    await inventory.refresh(third);
    inventory.read(first);
    inventory.read(second);

    expect(scan).toHaveBeenCalledTimes(4);
  });

  it("retries terminal failure only through the explicit refresh port", async () => {
    const scan = vi.fn()
      .mockRejectedValueOnce(new Error("first scan failed"))
      .mockResolvedValueOnce(catalog());
    const inventory = new SkillCatalogDiagnosticInventory(scan);

    await expect(inventory.refresh(OPTIONS)).resolves.toMatchObject({ lifecycle: { state: "failed" } });
    inventory.read(OPTIONS);
    expect(scan).toHaveBeenCalledTimes(1);

    await expect(inventory.refresh(OPTIONS)).resolves.toMatchObject({ lifecycle: { state: "current" } });
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it("fails closed at capacity when every retained entry is still in flight", () => {
    const scan = vi.fn(() => new Promise<KilnSkillCatalogSnapshot>(() => undefined));
    const inventory = new SkillCatalogDiagnosticInventory(scan, () => new Date(), 10_000, 1);

    expect(inventory.read({ ...OPTIONS, projectPath: "C:/synthetic/live" })).toEqual({ lifecycle: { state: "pending" } });
    expect(inventory.read({ ...OPTIONS, projectPath: "C:/synthetic/other" })).toEqual({
      lifecycle: { state: "failed", reason: "Skill diagnostic inventory is busy; use an explicit setup refresh to retry." },
    });
    expect(scan).toHaveBeenCalledTimes(1);
  });
});

type WorkerEvent = "message" | "error" | "exit";

class ControlledDiagnosticWorker implements SkillCatalogDiagnosticWorkerPort {
  readonly terminate = vi.fn(async () => 1);
  readonly unref = vi.fn();
  readonly #listeners = new Map<WorkerEvent, Array<(value: unknown) => void>>();

  onMessage(listener: Parameters<SkillCatalogDiagnosticWorkerPort["onMessage"]>[0]): void {
    this.#addListener("message", listener);
  }

  onError(listener: Parameters<SkillCatalogDiagnosticWorkerPort["onError"]>[0]): void {
    this.#addListener("error", listener);
  }

  onExit(listener: Parameters<SkillCatalogDiagnosticWorkerPort["onExit"]>[0]): void {
    this.#addListener("exit", listener);
  }

  #addListener(event: WorkerEvent, listener: (value: never) => void): void {
    const listeners = this.#listeners.get(event) ?? [];
    listeners.push(listener as (value: unknown) => void);
    this.#listeners.set(event, listeners);
  }

  emit(event: WorkerEvent, value: unknown): void {
    const listeners = this.#listeners.get(event) ?? [];
    this.#listeners.delete(event);
    for (const listener of listeners) listener(value);
  }
}
