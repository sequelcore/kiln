import { appendTimelineNote, getRunbook, getServiceStatus, listServices, openIncident } from "./mock-ops.js";

const PORT = 3500;

const TOOLS = [
  {
    name: "list_services",
    description: "List services known to the operations catalog",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_service_status",
    description: "Read current mock health and signals for one service",
    inputSchema: {
      type: "object",
      properties: { service: { type: "string", description: "Service ID from list_services" } },
      required: ["service"],
    },
  },
  {
    name: "get_runbook",
    description: "Read the runbook for a service and symptom",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Service ID" },
        symptom: { type: "string", description: "Incident symptom or alert name" },
      },
      required: ["service", "symptom"],
    },
  },
  {
    name: "open_incident",
    description: "Open an incident record for operator follow-up",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Service ID" },
        severity: { type: "string", enum: ["sev1", "sev2", "sev3"], description: "Incident severity" },
        summary: { type: "string", description: "Operator-facing incident summary" },
      },
      required: ["service", "severity", "summary"],
    },
  },
  {
    name: "append_timeline_note",
    description: "Append an auditable timeline note to an incident record",
    inputSchema: {
      type: "object",
      properties: {
        incidentId: { type: "string", description: "Incident ID returned by open_incident" },
        note: { type: "string", description: "Timeline note" },
      },
      required: ["incidentId", "note"],
    },
  },
];

async function executeTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "list_services":
      return listServices();
    case "get_service_status":
      return getServiceStatus(String(args.service ?? ""));
    case "get_runbook":
      return getRunbook(String(args.service ?? ""), String(args.symptom ?? ""));
    case "open_incident":
      return openIncident(String(args.service ?? ""), String(args.severity ?? ""), String(args.summary ?? ""));
    case "append_timeline_note":
      return appendTimelineNote(String(args.incidentId ?? ""), String(args.note ?? ""));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function jsonRpc(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handleMessage(body: Record<string, unknown>): Promise<Response> {
  const { method, params, id } = body as { method: string; params?: Record<string, unknown>; id?: unknown };

  switch (method) {
    case "initialize":
      return jsonRpc(id, {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "incident-tools", version: "2.1.0" },
      });
    case "notifications/initialized":
      return new Response(null, { status: 202 });
    case "tools/list":
      return jsonRpc(id, { tools: TOOLS });
    case "tools/call": {
      const p = params as { name: string; arguments: Record<string, unknown> };
      try {
        const result = await executeTool(p.name, p.arguments ?? {});
        return jsonRpc(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (err) {
        return jsonRpc(id, { content: [{ type: "text", text: `Error: ${err}` }], isError: true });
      }
    }
    case "ping":
      return jsonRpc(id, {});
    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });
    if (req.method === "GET") return Response.json({ status: "ok", tools: TOOLS.map((tool) => tool.name) });
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const body = await req.json();
    if (Array.isArray(body)) {
      const responses = await Promise.all(body.map(handleMessage));
      const jsonResponses = responses.filter((response) => response.status !== 202);
      if (jsonResponses.length === 0) return new Response(null, { status: 202 });
      return Response.json(await Promise.all(jsonResponses.map((response) => response.json())));
    }

    return handleMessage(body);
  },
});

console.log(`Incident tools server listening on http://localhost:${PORT}/mcp`);
