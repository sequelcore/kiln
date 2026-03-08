import type { TenantAgentConfig, TenantRoutingConfig } from "../engine/gateway/tenant-config.js";

export interface RoutingTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: "service" | "ecommerce" | "support" | "hospitality";
  readonly agents: readonly TenantAgentConfig[];
  readonly routing: TenantRoutingConfig;
}

const ROUTING_TEMPLATES: readonly RoutingTemplate[] = [
  {
    id: "service-business",
    name: "Service Business",
    description: "For salons, clinics, repair shops — routes booking, general inquiries, and support",
    category: "service",
    agents: [
      {
        id: "booking",
        name: "Booking Agent",
        role: "Appointment scheduler",
        goal: "Help customers book, reschedule, and cancel appointments",
      },
      {
        id: "general",
        name: "General Inquiry Agent",
        role: "Information specialist",
        goal: "Answer questions about services, pricing, and business details",
      },
      {
        id: "support",
        name: "Support Agent",
        role: "Customer support",
        goal: "Resolve customer issues and complaints",
      },
    ],
    routing: {
      rules: [
        { match: "appointment|book|schedule|reserv|reschedule", agent: "booking" },
        { match: "problem|issue|complaint|broken|not working", agent: "support" },
      ],
      fallback: "general",
    },
  },
  {
    id: "ecommerce",
    name: "E-Commerce",
    description: "For online stores — routes sales, order support, and returns",
    category: "ecommerce",
    agents: [
      {
        id: "sales",
        name: "Sales Agent",
        role: "Sales specialist",
        goal: "Help customers find products and complete purchases",
      },
      {
        id: "order-support",
        name: "Order Support Agent",
        role: "Order specialist",
        goal: "Track orders, handle shipping inquiries, and resolve delivery issues",
      },
      {
        id: "returns",
        name: "Returns Agent",
        role: "Returns and refunds specialist",
        goal: "Process returns, exchanges, and refunds",
      },
    ],
    routing: {
      rules: [
        { match: "buy|purchase|price|quote|cost|product", agent: "sales" },
        { match: "cancel|refund|return|exchange", agent: "returns" },
        { match: "order|tracking|shipping|delivery|shipped", agent: "order-support" },
      ],
      fallback: "sales",
    },
  },
  {
    id: "customer-support",
    name: "Customer Support",
    description: "For multi-tier support — routes triage, technical issues, and billing",
    category: "support",
    agents: [
      {
        id: "triage",
        name: "Triage Agent",
        role: "First responder",
        goal: "Assess customer needs and route to the right specialist",
      },
      {
        id: "technical",
        name: "Technical Support Agent",
        role: "Technical specialist",
        goal: "Resolve technical issues, bugs, and errors",
      },
      {
        id: "billing",
        name: "Billing Agent",
        role: "Billing specialist",
        goal: "Handle invoices, payments, subscriptions, and billing disputes",
      },
    ],
    routing: {
      rules: [
        { match: "error|bug|crash|broken|not working|technical", agent: "technical" },
        { match: "invoice|charge|payment|billing|subscription|plan", agent: "billing" },
      ],
      fallback: "triage",
    },
  },
] as const;

export function getRoutingTemplate(id: string): RoutingTemplate | undefined {
  return ROUTING_TEMPLATES.find((t) => t.id === id);
}

export function listRoutingTemplates(): readonly RoutingTemplate[] {
  return ROUTING_TEMPLATES;
}
