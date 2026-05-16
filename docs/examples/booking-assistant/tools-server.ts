// MCP Tools Server for booking assistant
// Implements MCP Streamable HTTP (JSON-RPC over HTTP POST)

import { listAvailableSlots, createBooking, cancelBooking, getServices } from "./mock-calendar.js";

const PORT = 3200;

// -- MCP Tool Definitions --

const TOOLS = [
  {
    name: "list_available_slots",
    description: "List available appointment slots for a given date and optional service filter",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Date in YYYY-MM-DD format" },
        service: { type: "string", description: "Optional service name to filter by" },
      },
      required: ["date"],
    },
  },
  {
    name: "create_booking",
    description: "Book an appointment slot for a customer",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Date in YYYY-MM-DD format" },
        time: { type: "string", description: "Time in HH:MM format (24h)" },
        service: { type: "string", description: "Service name" },
        customerName: { type: "string", description: "Customer's full name" },
        customerPhone: { type: "string", description: "Customer's phone number (optional)" },
      },
      required: ["date", "time", "service", "customerName"],
    },
  },
  {
    name: "cancel_booking",
    description: "Cancel an existing booking by its booking ID",
    inputSchema: {
      type: "object",
      properties: {
        bookingId: { type: "string", description: "Booking ID (e.g., BK-1001)" },
      },
      required: ["bookingId"],
    },
  },
];

// -- Tool Execution --

async function executeTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "list_available_slots": {
      const result = listAvailableSlots(String(args.date), args.service ? String(args.service) : undefined);
      // Include service menu for context
      if (!("error" in result)) {
        return { services: getServices(), slots: result };
      }
      return result;
    }
    case "create_booking":
      return createBooking(
        String(args.date),
        String(args.time),
        String(args.service),
        String(args.customerName),
        args.customerPhone ? String(args.customerPhone) : undefined,
      );
    case "cancel_booking":
      return cancelBooking(String(args.bookingId));
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
        serverInfo: { name: "booking-tools", version: "2.1.0" },
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

    if (req.method === "GET") {
      return Response.json({ status: "ok", tools: TOOLS.map((t) => t.name) });
    }

    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const body = await req.json();

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

console.log(`MCP booking tools server listening on http://localhost:${PORT}/mcp`);
