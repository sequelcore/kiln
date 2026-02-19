import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionState, SessionConflictError } from "../../src/server/session-state.js";
import type { WSContext } from "hono/ws";

function makeMockWs(open = true): WSContext {
  return {
    send: vi.fn(),
    close: vi.fn(),
    readyState: open ? 1 : 3,
    raw: undefined,
    binaryType: "arraybuffer",
    url: null,
    protocol: null,
  } as unknown as WSContext;
}

describe("SessionState", () => {
  let state: SessionState;

  beforeEach(() => {
    state = new SessionState();
  });

  describe("snapshot()", () => {
    it("returns correct initial state", () => {
      const snap = state.snapshot();

      expect(snap.sessionActive).toBe(false);
      expect(snap.sessionStatus).toBe("idle");
      expect(snap.statusMessage).toBe("");
      expect(snap.task).toBeNull();
      expect(snap.phase).toBe("idle");
      expect(snap.status).toBe("idle");
      expect(snap.cost).toEqual({
        total: 0,
        inputTokens: 0,
        outputTokens: 0,
        byRole: {},
      });
      expect(snap.events).toEqual([]);
      expect(snap.output).toEqual([]);
      expect(snap.tasks).toEqual([]);
      expect(snap.workers).toEqual([]);
      expect(snap.qualityGates).toEqual([]);
    });
  });

  describe("sessionStatus", () => {
    it("returns idle initially", () => {
      expect(state.sessionStatus).toBe("idle");
      expect(state.isSessionActive).toBe(false);
    });
  });

  describe("client management", () => {
    it("tracks client count", () => {
      expect(state.clientCount).toBe(0);

      const ws1 = makeMockWs();
      const ws2 = makeMockWs();
      state.addClient(ws1);
      expect(state.clientCount).toBe(1);

      state.addClient(ws2);
      expect(state.clientCount).toBe(2);

      state.removeClient(ws1);
      expect(state.clientCount).toBe(1);
    });
  });

  describe("handleSdkMessage()", () => {
    it("handles system init message", () => {
      state.handleSdkMessage({
        type: "system",
        subtype: "init",
        model: "claude-sonnet-4-6",
        mcp_servers: [{ name: "kiln", status: "connected" }],
      });

      const snap = state.snapshot();
      expect(snap.output).toHaveLength(2);
      expect(snap.output[0]).toBe("[system] Model: claude-sonnet-4-6");
      expect(snap.output[1]).toBe("[system] MCP: kiln (connected)");
    });

    it("handles assistant text message", () => {
      state.handleSdkMessage({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Hello, I will fix the bug." },
          ],
        },
      });

      const snap = state.snapshot();
      expect(snap.output).toHaveLength(1);
      expect(snap.output[0]).toBe("Hello, I will fix the bug.");
    });

    it("handles assistant tool_use message", () => {
      state.handleSdkMessage({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Read", input: { file_path: "/test.ts" } },
          ],
        },
      });

      const snap = state.snapshot();
      expect(snap.output).toHaveLength(1);
      expect(snap.output[0]).toContain("[tool] Read");
      expect(snap.output[0]).toContain("file_path");
    });

    it("handles result success message", () => {
      state.handleSdkMessage({
        type: "result",
        subtype: "success",
        result: "Task completed successfully.",
        total_cost_usd: 0.0542,
        duration_ms: 12500,
      });

      const snap = state.snapshot();
      expect(snap.output.length).toBeGreaterThanOrEqual(2);
      expect(snap.output).toContain("--- Result ---");
      expect(snap.output).toContain("Task completed successfully.");
      expect(snap.output.some((l: string) => l.includes("$0.0542"))).toBe(true);
    });

    it("handles result error message", () => {
      state.handleSdkMessage({
        type: "result",
        subtype: "error_during_execution",
        errors: ["Something went wrong"],
        total_cost_usd: 0.01,
        duration_ms: 1000,
      });

      const snap = state.snapshot();
      expect(snap.output.some((l: string) => l.includes("[error]"))).toBe(true);
    });

    it("handles tool_progress message", () => {
      state.handleSdkMessage({
        type: "tool_progress",
        tool_name: "Bash",
        elapsed_time_seconds: 5.2,
      });

      const snap = state.snapshot();
      expect(snap.output).toHaveLength(1);
      expect(snap.output[0]).toContain("[tool progress] Bash");
      expect(snap.output[0]).toContain("5s");
    });

    it("handles tool_use_summary message", () => {
      state.handleSdkMessage({
        type: "tool_use_summary",
        summary: "Read 3 files",
      });

      const snap = state.snapshot();
      expect(snap.output).toHaveLength(1);
      expect(snap.output[0]).toBe("[tool summary] Read 3 files");
    });

    it("ignores user messages", () => {
      state.handleSdkMessage({ type: "user", message: {} });

      const snap = state.snapshot();
      expect(snap.output).toHaveLength(0);
    });
  });

  describe("emitOutputLine()", () => {
    it("caps at MAX_OUTPUT_LINES (500)", () => {
      for (let i = 0; i < 510; i++) {
        state.emitOutputLine(`line ${i}`, "stdout");
      }

      const snap = state.snapshot();
      expect(snap.output.length).toBeLessThanOrEqual(500);
      expect(snap.output[snap.output.length - 1]).toBe("line 509");
    });

    it("broadcasts each output line", () => {
      const ws = makeMockWs();
      state.addClient(ws);

      state.emitOutputLine("hello", "stdout");
      state.emitOutputLine("world", "stdout");

      expect(ws.send).toHaveBeenCalledTimes(2);
      const calls = vi.mocked(ws.send).mock.calls;
      const msg1 = JSON.parse(calls[0]![0] as string) as { type: string; text: string; stream: string };
      const msg2 = JSON.parse(calls[1]![0] as string) as { type: string; text: string; stream: string };
      expect(msg1.type).toBe("output");
      expect(msg1.text).toBe("hello");
      expect(msg1.stream).toBe("stdout");
      expect(msg2.type).toBe("output");
      expect(msg2.text).toBe("world");
    });
  });

  describe("broadcast()", () => {
    it("sends to all connected clients", () => {
      const ws1 = makeMockWs();
      const ws2 = makeMockWs();
      const ws3 = makeMockWs();
      state.addClient(ws1);
      state.addClient(ws2);
      state.addClient(ws3);

      const msg = { type: "pong" as const };
      state.broadcast(msg);

      const expected = JSON.stringify(msg);
      expect(ws1.send).toHaveBeenCalledWith(expected);
      expect(ws2.send).toHaveBeenCalledWith(expected);
      expect(ws3.send).toHaveBeenCalledWith(expected);
    });

    it("removes clients that throw on send", () => {
      const goodWs = makeMockWs();
      const badWs = makeMockWs();
      vi.mocked(badWs.send).mockImplementation(() => {
        throw new Error("Connection closed");
      });

      state.addClient(goodWs);
      state.addClient(badWs);
      expect(state.clientCount).toBe(2);

      state.broadcast({ type: "pong" });

      expect(state.clientCount).toBe(1);
      expect(goodWs.send).toHaveBeenCalledOnce();
    });

    it("does nothing with no clients", () => {
      expect(() => state.broadcast({ type: "pong" })).not.toThrow();
    });
  });

  describe("SessionConflictError", () => {
    it("is an instance of Error", () => {
      const err = new SessionConflictError("test");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("SessionConflictError");
      expect(err.message).toBe("test");
    });
  });

  describe("stopSession()", () => {
    it("does not throw when no session is active", () => {
      expect(() => state.stopSession()).not.toThrow();
    });
  });
});
