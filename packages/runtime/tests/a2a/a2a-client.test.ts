import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { A2AClient } from "../../src/a2a/a2a-client.js";
import type { AgentCard, A2AMessage, A2ATask } from "@kilnai/core";

describe("A2AClient", () => {
  let client: A2AClient;
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new A2AClient();
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("discoverAgent", () => {
    it("fetches and parses agent card", async () => {
      const card: AgentCard = {
        name: "test-agent",
        description: "Test agent",
        url: "https://example.com/agent",
        version: "1.0.0",
        capabilities: [],
      };

      fetchMock.mockResolvedValue(new Response(JSON.stringify(card), { status: 200 }));

      const result = await client.discoverAgent("https://example.com/agent");

      expect(result).toEqual(card);
      expect(fetchMock).toHaveBeenCalledWith("https://example.com/agent/.well-known/agent.json");
    });

    it("throws A2A_CLIENT_FAILED on network error", async () => {
      fetchMock.mockRejectedValue(new Error("Network error"));

      await expect(client.discoverAgent("https://example.com/agent")).rejects.toThrow("Failed to fetch agent card");
    });

    it("throws A2A_CLIENT_FAILED on invalid JSON", async () => {
      fetchMock.mockResolvedValue(new Response("not valid json", { status: 200 }));

      await expect(client.discoverAgent("https://example.com/agent")).rejects.toThrow("Failed to parse agent card JSON");
    });

    it("throws A2A_CLIENT_FAILED on non-object response", async () => {
      fetchMock.mockResolvedValue(new Response("null", { status: 200 }));

      await expect(client.discoverAgent("https://example.com/agent")).rejects.toThrow("Agent card response is not a valid object");
    });

    it("throws A2A_CLIENT_FAILED on missing required fields", async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ name: "test" }), { status: 200 }));

      await expect(client.discoverAgent("https://example.com/agent")).rejects.toThrow("Agent card is missing required fields");
    });

    it("throws A2A_CLIENT_FAILED on non-200 response", async () => {
      fetchMock.mockResolvedValue(new Response("Not found", { status: 404 }));

      await expect(client.discoverAgent("https://example.com/agent")).rejects.toThrow("Agent card request failed with status 404");
    });

    it("handles trailing slash in agent URL", async () => {
      const card: AgentCard = {
        name: "test-agent",
        description: "Test agent",
        url: "https://example.com/agent/",
        version: "1.0.0",
        capabilities: [],
      };

      fetchMock.mockResolvedValue(new Response(JSON.stringify(card), { status: 200 }));

      await client.discoverAgent("https://example.com/agent/");

      expect(fetchMock).toHaveBeenCalledWith("https://example.com/agent/.well-known/agent.json");
    });
  });

  describe("sendTask", () => {
    const message: A2AMessage = {
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
    };

    it("sends JSON-RPC and returns task", async () => {
      const task: A2ATask = {
        id: "task-123",
        status: { state: "completed", timestamp: new Date().toISOString() },
      };

      fetchMock.mockResolvedValue(new Response(JSON.stringify({ jsonrpc: "2.0", result: task, id: "1" }), { status: 200 }));

      const result = await client.sendTask("https://example.com/agent", message);

      expect(result).toEqual(task);
    });

    it("throws A2A_CLIENT_FAILED on timeout", async () => {
      fetchMock.mockImplementation(() => new Promise((_, reject) => {
        setTimeout(() => reject(new DOMException("Aborted", "AbortError")), 100);
      }));

      await expect(client.sendTask("https://example.com/agent", message, 10)).rejects.toThrow("Task request timed out");
    });

    it("throws A2A_CLIENT_FAILED on JSON-RPC error response", async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Task not found" },
        id: "1",
      }), { status: 200 }));

      await expect(client.sendTask("https://example.com/agent", message)).rejects.toThrow("Remote agent error: Task not found");
    });

    it("throws A2A_CLIENT_FAILED on missing result field", async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ jsonrpc: "2.0", id: "1" }), { status: 200 }));

      await expect(client.sendTask("https://example.com/agent", message)).rejects.toThrow("Task response missing 'result' field");
    });

    it("throws A2A_CLIENT_FAILED on non-200 response", async () => {
      fetchMock.mockResolvedValue(new Response("Internal error", { status: 500 }));

      await expect(client.sendTask("https://example.com/agent", message)).rejects.toThrow("Task request failed with status 500");
    });

    it("throws A2A_CLIENT_FAILED on invalid JSON response", async () => {
      fetchMock.mockResolvedValue(new Response("not valid json", { status: 200 }));

      await expect(client.sendTask("https://example.com/agent", message)).rejects.toThrow("Failed to parse task response JSON");
    });
  });
});
