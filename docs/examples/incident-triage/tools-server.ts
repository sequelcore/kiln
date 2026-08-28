import { appendTimelineNote, getRunbook, getServiceStatus, listServices, openIncident } from "./mock-ops.js";
import { startStrictMcpToolServer } from "../shared/strict-mcp-tool-server.js";

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
] as const;

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

startStrictMcpToolServer({
  port: PORT,
  name: "incident-tools",
  version: "2.1.0",
  tools: TOOLS,
  executeTool,
});
