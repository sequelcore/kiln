import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookToolExecutor } from "../../src/gateway/webhook-tool-executor.js";
import type { WebhookToolConfig } from "../../src/gateway/webhook-tool-executor.js";
import { verifyHmacSha256 } from "../../src/utils/hmac.js";
import { KilnError } from "@kilnai/core";

const SECRET = "test-webhook-secret";

const configs: WebhookToolConfig[] = [
  {
    name: "create_ticket",
    description: "Create a support ticket",
    url: "https://api.example.com/tickets",
    secret: SECRET,
    timeoutMs: 5000,
    inputSchema: { type: "object", properties: { title: { type: "string" } } },
  },
  {
    name: "send_email",
    description: "Send an email notification",
    url: "https://api.example.com/email",
    secret: SECRET,
    timeoutMs: 10000,
  },
];

describe("WebhookToolExecutor", () => {
  let executor: WebhookToolExecutor;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    executor = new WebhookToolExecutor(configs);
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("handles()", () => {
    it("returns true for configured tools", () => {
      expect(executor.handles("create_ticket")).toBe(true);
      expect(executor.handles("send_email")).toBe(true);
    });

    it("returns false for unknown tools", () => {
      expect(executor.handles("unknown_tool")).toBe(false);
    });
  });

  describe("execute()", () => {
    it("sends POST with correct headers", async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 1 }), { status: 200 }));

      await executor.execute("create_ticket", { title: "Bug report" });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.example.com/tickets");
      expect(init.method).toBe("POST");
      expect(init.headers).toMatchObject({
        "Content-Type": "application/json",
      });

      const headers = init.headers as Record<string, string>;
      expect(headers["X-Kiln-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
      expect(headers["X-Kiln-Timestamp"]).toBeDefined();
    });

    it("sends a valid HMAC-SHA256 signature", async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      await executor.execute("create_ticket", { title: "Test" });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      const body = init.body as string;
      const signature = headers["X-Kiln-Signature"].replace("sha256=", "");

      expect(verifyHmacSha256(SECRET, body, signature)).toBe(true);
    });

    it("returns parsed JSON response", async () => {
      const responseBody = { id: 42, status: "created" };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(responseBody), { status: 200 }),
      );

      const result = await executor.execute("create_ticket", { title: "Test" });
      expect(result).toEqual(responseBody);
    });

    it("throws WEBHOOK_TOOL_FAILED on HTTP 500", async () => {
      mockFetch.mockResolvedValueOnce(new Response("Internal Server Error", { status: 500 }));

      const err = await executor
        .execute("create_ticket", { title: "Test" })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(KilnError);
      const kilnErr = err as KilnError;
      expect(kilnErr.code).toBe("WEBHOOK_TOOL_FAILED");
      expect(kilnErr.message).toContain("HTTP 500");
      expect(kilnErr.retryable).toBe(true);
      expect(kilnErr.context).toMatchObject({ toolName: "create_ticket", status: 500 });
    });

    it("throws non-retryable WEBHOOK_TOOL_FAILED on HTTP 4xx", async () => {
      mockFetch.mockResolvedValueOnce(new Response("Bad Request", { status: 400 }));

      const err = await executor
        .execute("create_ticket", { title: "Test" })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(KilnError);
      const kilnErr = err as KilnError;
      expect(kilnErr.code).toBe("WEBHOOK_TOOL_FAILED");
      expect(kilnErr.retryable).toBe(false);
    });

    it("throws WEBHOOK_TOOL_FAILED for unconfigured tool", async () => {
      const err = await executor
        .execute("nonexistent", { x: 1 })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(KilnError);
      const kilnErr = err as KilnError;
      expect(kilnErr.code).toBe("WEBHOOK_TOOL_FAILED");
      expect(kilnErr.message).toContain("not configured");
      expect(kilnErr.retryable).toBe(false);
    });

    it("throws WEBHOOK_TOOL_FAILED on network error", async () => {
      mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

      const err = await executor
        .execute("create_ticket", { title: "Test" })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(KilnError);
      const kilnErr = err as KilnError;
      expect(kilnErr.code).toBe("WEBHOOK_TOOL_FAILED");
      expect(kilnErr.message).toContain("fetch failed");
      expect(kilnErr.retryable).toBe(true);
    });

    it("throws WEBHOOK_TOOL_FAILED on timeout (AbortError)", async () => {
      const abortError = new DOMException("The operation was aborted", "AbortError");
      mockFetch.mockRejectedValueOnce(abortError);

      const err = await executor
        .execute("create_ticket", { title: "Test" })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(KilnError);
      const kilnErr = err as KilnError;
      expect(kilnErr.code).toBe("WEBHOOK_TOOL_FAILED");
      expect(kilnErr.message).toContain("timed out");
      expect(kilnErr.retryable).toBe(true);
    });
  });

  describe("getToolDefinitions()", () => {
    it("returns correct ToolDefinition array", () => {
      const defs = executor.getToolDefinitions();

      expect(defs).toHaveLength(2);

      const ticket = defs.find((d) => d.name === "create_ticket")!;
      expect(ticket.description).toBe("Create a support ticket");
      expect(ticket.inputSchema).toEqual({
        type: "object",
        properties: { title: { type: "string" } },
      });
      expect(ticket.tags).toEqual(new Set());

      const email = defs.find((d) => d.name === "send_email")!;
      expect(email.description).toBe("Send an email notification");
      expect(email.inputSchema).toEqual({});
      expect(email.tags).toEqual(new Set());
    });
  });
});
