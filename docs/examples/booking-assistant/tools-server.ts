import { listAvailableSlots, createBooking, cancelBooking, getServices } from "./mock-calendar.js";
import { startStrictMcpToolServer } from "../shared/strict-mcp-tool-server.js";

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
] as const;

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

startStrictMcpToolServer({
  port: PORT,
  name: "booking-tools",
  version: "2.1.0",
  tools: TOOLS,
  executeTool,
});
