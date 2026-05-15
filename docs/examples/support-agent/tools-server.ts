// MCP Tools Server for TechShop support agent
// Implements MCP Streamable HTTP (JSON-RPC over HTTP POST) -- no SDK needed on server side

import { checkOrderStatus, getAccountInfo, createSupportTicket } from "./mock-data.js";

const PORT = 3100;

// -- MCP Tool Definitions --

const TOOLS = [
  {
    name: "check_order_status",
    description: "Look up the current status of a customer order by order ID",
    inputSchema: {
      type: "object",
      properties: { orderId: { type: "string", description: "Order ID (e.g., ORD-1001)" } },
      required: ["orderId"],
    },
  },
  {
    name: "get_account_info",
    description: "Look up customer account details by email address",
    inputSchema: {
      type: "object",
      properties: { email: { type: "string", description: "Customer email address" } },
      required: ["email"],
    },
  },
  {
    name: "create_support_ticket",
    description: "Create a support ticket for issues that need follow-up",
    inputSchema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Brief description of the issue" },
        priority: { type: "string", enum: ["low", "medium", "high"], description: "Ticket priority level" },
        details: { type: "string", description: "Full description of the issue" },
      },
      required: ["subject", "priority", "details"],
    },
  },
];

// -- Tool Execution --

async function executeTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "check_order_status":
      return checkOrderStatus(String(args.orderId));
    case "get_account_info":
      return getAccountInfo(String(args.email));
    case "create_support_ticket":
      return createSupportTicket(
        String(args.subject),
        args.priority as "low" | "medium" | "high",
        String(args.details),
      );
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// -- JSON-RPC Helpers --

function jsonRpc(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}

// -- MCP Message Handler --

async function handleMessage(body: Record<string, unknown>): Promise<Response> {
  const { method, params, id } = body as { method: string; params?: Record<string, unknown>; id?: unknown };

  switch (method) {
    case "initialize":
      return jsonRpc(id, {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "support-tools", version: "2.0.0" },
      });

    case "notifications/initialized":
      return new Response(null, { status: 202 });

    case "tools/list":
      return jsonRpc(id, { tools: TOOLS });

    case "tools/call": {
      const p = params as { name: string; arguments: Record<string, unknown> };
      try {
        const result = await executeTool(p.name, p.arguments ?? {});
        return jsonRpc(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
      } catch (err) {
        return jsonRpc(id, {
          content: [{ type: "text", text: `Error: ${err}` }],
          isError: true,
        });
      }
    }

    case "ping":
      return jsonRpc(id, {});

    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}

// -- Bun HTTP Server --

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname !== "/mcp") {
      return new Response("Not found", { status: 404 });
    }

    // Health check
    if (req.method === "GET") {
      return Response.json({ status: "ok", tools: TOOLS.map((t) => t.name) });
    }

    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const body = await req.json();

    // Handle batch JSON-RPC
    if (Array.isArray(body)) {
      const responses = await Promise.all(body.map(handleMessage));
      const jsonResponses = responses.filter((r) => r.status !== 202);
      if (jsonResponses.length === 0) return new Response(null, { status: 202 });
      const results = await Promise.all(jsonResponses.map((r) => r.json()));
      return Response.json(results);
    }

    return handleMessage(body);
  },
});

console.log(`MCP tools server listening on http://localhost:${PORT}/mcp`);
