import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { YamlWatcher } from "../../src/commands/dev-watcher.js";

describe("YamlWatcher", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-watcher-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("calls onReload when a watched file changes", async () => {
    const filePath = join(tmpDir, "gateway.yaml");
    writeFileSync(filePath, "port: 4000\n");

    const onReload = vi.fn();
    const watcher = new YamlWatcher({
      paths: [filePath],
      debounceMs: 50,
      onReload,
    });

    watcher.start();

    // Trigger a file change
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    writeFileSync(filePath, "port: 4001\n");

    // Wait for debounce + fs.watch callback
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    watcher.stop();

    expect(onReload).toHaveBeenCalledWith(filePath);
  });

  it("debounces multiple rapid changes into a single onReload call", async () => {
    const filePath = join(tmpDir, "app.yaml");
    writeFileSync(filePath, "name: test\n");

    const onReload = vi.fn();
    const watcher = new YamlWatcher({
      paths: [filePath],
      debounceMs: 100,
      onReload,
    });

    watcher.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    // Write multiple times rapidly
    writeFileSync(filePath, "name: test1\n");
    writeFileSync(filePath, "name: test2\n");
    writeFileSync(filePath, "name: test3\n");

    // Wait for debounce to settle
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    watcher.stop();

    // Should be called at most once per debounce window
    expect(onReload.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("stop() cancels pending debounce timer so onReload does not fire", async () => {
    const filePath = join(tmpDir, "stop-test.yaml");
    writeFileSync(filePath, "port: 4000\n");

    const onReload = vi.fn();
    const watcher = new YamlWatcher({
      paths: [filePath],
      debounceMs: 200,
      onReload,
    });

    watcher.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    // Trigger change to schedule debounce timer
    writeFileSync(filePath, "port: 4002\n");

    // Stop before debounce fires
    watcher.stop();

    // Wait longer than debounce -- onReload should NOT have fired after stop
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    expect(onReload).not.toHaveBeenCalled();
  });

  it("stop() can be called multiple times without error", () => {
    const filePath = join(tmpDir, "multi-stop.yaml");
    writeFileSync(filePath, "port: 4000\n");

    const watcher = new YamlWatcher({
      paths: [filePath],
      debounceMs: 50,
      onReload: vi.fn(),
    });

    watcher.start();
    expect(() => {
      watcher.stop();
      watcher.stop();
    }).not.toThrow();
  });

  it("calls onError for non-existent paths", () => {
    const nonExistent = join(tmpDir, "does-not-exist.yaml");
    const onError = vi.fn();

    const watcher = new YamlWatcher({
      paths: [nonExistent],
      debounceMs: 50,
      onReload: vi.fn(),
      onError,
    });

    watcher.start();
    watcher.stop();

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("watches multiple paths independently", async () => {
    const fileA = join(tmpDir, "a.yaml");
    const fileB = join(tmpDir, "b.yaml");
    writeFileSync(fileA, "a: 1\n");
    writeFileSync(fileB, "b: 2\n");

    const reloadedPaths: string[] = [];
    const watcher = new YamlWatcher({
      paths: [fileA, fileB],
      debounceMs: 50,
      onReload: (p) => reloadedPaths.push(p),
    });

    watcher.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    writeFileSync(fileA, "a: 10\n");
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    watcher.stop();

    expect(reloadedPaths).toContain(fileA);
  });
});
