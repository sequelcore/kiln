import { checkOrderStatus, getAccountInfo, createSupportTicket } from "./mock-data.js";
import { startStrictMcpToolServer } from "../shared/strict-mcp-tool-server.js";

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
] as const;

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

startStrictMcpToolServer({
  port: PORT,
  name: "support-tools",
  version: "2.1.0",
  tools: TOOLS,
  executeTool,
});
