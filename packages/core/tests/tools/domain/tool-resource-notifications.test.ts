import { describe, expect, it, vi } from "vitest";
import { createDefaultBuiltinToolSurface } from "../../../src/tools/default-tool-surface.js";
import { ToolResourceNotificationHub } from "../../../src/tools/domain/tool-resource-notifications.js";
import { MemoryArtifactResourceStore } from "../../../src/tools/infrastructure/artifact-resource-store.js";

describe("ToolResourceNotificationHub", () => {
  it("sends resource updates only to subscribed sessions", async () => {
    vi.useFakeTimers();
    try {
      const hub = new ToolResourceNotificationHub({ debounceMs: 10 });
      const first: unknown[] = [];
      const second: unknown[] = [];

      hub.subscribeResource({
        sessionId: "first",
        uri: "kiln://session/tasks",
        sendNotification: async (notification) => {
          first.push(notification);
        },
      });
      hub.subscribeResource({
        sessionId: "second",
        uri: "kiln://session/monitors",
        sendNotification: async (notification) => {
          second.push(notification);
        },
      });

      hub.notifyResourceUpdated("kiln://session/tasks/task_1");
      await vi.advanceTimersByTimeAsync(10);

      expect(first).toEqual([{
        method: "notifications/resources/updated",
        params: { uri: "kiln://session/tasks/task_1" },
      }]);
      expect(second).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("debounces duplicate resource updates and cancels pending work on unsubscribe", async () => {
    vi.useFakeTimers();
    try {
      const hub = new ToolResourceNotificationHub({ debounceMs: 25 });
      const notifications: unknown[] = [];

      hub.subscribeResource({
        sessionId: "client",
        uri: "kiln://session/monitors/mon_1",
        sendNotification: async (notification) => {
          notifications.push(notification);
        },
      });

      hub.notifyResourceUpdated("kiln://session/monitors/mon_1");
      hub.notifyResourceUpdated("kiln://session/monitors/mon_1");
      hub.unsubscribeResource({ sessionId: "client", uri: "kiln://session/monitors/mon_1" });
      await vi.advanceTimersByTimeAsync(25);

      expect(notifications).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("broadcasts debounced resource list changes to active sessions", async () => {
    vi.useFakeTimers();
    try {
      const hub = new ToolResourceNotificationHub({ debounceMs: 5 });
      const first: unknown[] = [];
      const second: unknown[] = [];

      hub.registerSession({
        sessionId: "first",
        sendNotification: async (notification) => {
          first.push(notification);
        },
      });
      hub.registerSession({
        sessionId: "second",
        sendNotification: async (notification) => {
          second.push(notification);
        },
      });

      hub.notifyResourceListChanged();
      hub.notifyResourceListChanged();
      await vi.advanceTimersByTimeAsync(5);

      expect(first).toEqual([{ method: "notifications/resources/list_changed" }]);
      expect(second).toEqual([{ method: "notifications/resources/list_changed" }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards every update to adapters that own downstream URI filtering", async () => {
    vi.useFakeTimers();
    try {
      const hub = new ToolResourceNotificationHub({ debounceMs: 5 });
      const notifications: unknown[] = [];
      hub.registerSession({
        sessionId: "modern-mcp",
        receivesAllResourceUpdates: true,
        sendNotification: async (notification) => {
          notifications.push(notification);
        },
      });

      hub.notifyResourceUpdated("kiln://session/tasks/task_1");
      await vi.advanceTimersByTimeAsync(5);

      expect(notifications).toEqual([{
        method: "notifications/resources/updated",
        params: { uri: "kiln://session/tasks/task_1" },
      }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits session resource updates after task and monitor mutations", async () => {
    vi.useFakeTimers();
    try {
      const surface = createDefaultBuiltinToolSurface({
        resourceNotifications: { debounceMs: 5 },
        monitor: {
          commandRunner: {
            start: (_request, sink) => {
              sink.stdout("ready\n");
              return { stop: async () => sink.finish({ signal: "SIGTERM" }) };
            },
          },
        },
      });
      const notifications: unknown[] = [];
      surface.resourceNotifications.subscribeResource({
        sessionId: "client",
        uri: "kiln://session",
        sendNotification: async (notification) => {
          notifications.push(notification);
        },
      });

      const task = surface.taskStateStore.update({ title: "Update docs", status: "in_progress" });
      const monitor = surface.monitorRegistry.start({
        command: "bun run test",
        cwd: "C:/workspace",
        timeoutMs: 60_000,
      });
      await surface.monitorRegistry.stop(monitor.id, "test");
      await vi.advanceTimersByTimeAsync(5);

      expect(notifications).toEqual([
        { method: "notifications/resources/updated", params: { uri: "kiln://session/tasks" } },
        { method: "notifications/resources/updated", params: { uri: `kiln://session/tasks/${task.id}` } },
        { method: "notifications/resources/updated", params: { uri: "kiln://session/monitors" } },
        { method: "notifications/resources/updated", params: { uri: `kiln://session/monitors/${monitor.id}` } },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits artifact namespace list changes and artifact updates", async () => {
    vi.useFakeTimers();
    try {
      const artifactStore = new MemoryArtifactResourceStore({
        now: () => "2026-04-29T20:00:00.000Z",
      });
      const surface = createDefaultBuiltinToolSurface({
        resourceNotifications: { debounceMs: 5 },
        artifactResources: { store: artifactStore },
      });
      const notifications: unknown[] = [];
      surface.resourceNotifications.subscribeResource({
        sessionId: "client",
        uri: "kiln://artifacts",
        sendNotification: async (notification) => {
          notifications.push(notification);
        },
      });

      const artifact = artifactStore.put({
        namespace: "test-results",
        title: "Focused Tests",
        mimeType: "text/plain",
        content: { type: "text", text: "passed" },
        producer: { kind: "tool", name: "bash" },
        retention: { scope: "session" },
      });
      await vi.advanceTimersByTimeAsync(5);

      expect(notifications).toEqual([
        { method: "notifications/resources/list_changed" },
        { method: "notifications/resources/updated", params: { uri: "kiln://artifacts/test-results" } },
        { method: "notifications/resources/updated", params: { uri: `kiln://artifacts/test-results/${artifact.id}` } },
        { method: "notifications/resources/updated", params: { uri: `kiln://artifacts/test-results/${artifact.id}/content` } },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
