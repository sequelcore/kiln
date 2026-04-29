// Mock e-commerce data for TechShop support agent

export interface Order {
  orderId: string;
  customerEmail: string;
  status: "processing" | "shipped" | "delivered" | "cancelled" | "returned";
  items: { name: string; quantity: number; price: number }[];
  total: number;
  trackingNumber?: string;
  estimatedDelivery?: string;
  orderDate: string;
}

export interface Account {
  email: string;
  name: string;
  memberSince: string;
  tier: "standard" | "premium";
  orders: string[];
  address: string;
}

export interface Ticket {
  ticketId: string;
  subject: string;
  priority: "low" | "medium" | "high";
  details: string;
  createdAt: string;
}

// -- Orders --

const orders = new Map<string, Order>([
  [
    "ORD-1001",
    {
      orderId: "ORD-1001",
      customerEmail: "alice@example.com",
      status: "delivered",
      items: [{ name: 'Monitor 27" 4K', quantity: 1, price: 349.99 }],
      total: 349.99,
      trackingNumber: "1Z999AA10123456784",
      orderDate: "2026-02-15",
    },
  ],
  [
    "ORD-1002",
    {
      orderId: "ORD-1002",
      customerEmail: "alice@example.com",
      status: "shipped",
      items: [
        { name: "Mechanical Keyboard", quantity: 1, price: 129.99 },
        { name: "Mouse Pad XL", quantity: 1, price: 24.99 },
      ],
      total: 154.98,
      trackingNumber: "1Z999AA10123456785",
      estimatedDelivery: "2026-03-05",
      orderDate: "2026-02-28",
    },
  ],
  [
    "ORD-1003",
    {
      orderId: "ORD-1003",
      customerEmail: "bob@example.com",
      status: "processing",
      items: [{ name: "Wireless Headphones", quantity: 2, price: 79.99 }],
      total: 159.98,
      estimatedDelivery: "2026-03-08",
      orderDate: "2026-03-01",
    },
  ],
  [
    "ORD-1004",
    {
      orderId: "ORD-1004",
      customerEmail: "bob@example.com",
      status: "cancelled",
      items: [{ name: "USB-C Hub", quantity: 1, price: 49.99 }],
      total: 49.99,
      orderDate: "2026-02-20",
    },
  ],
  [
    "ORD-1005",
    {
      orderId: "ORD-1005",
      customerEmail: "carol@example.com",
      status: "returned",
      items: [{ name: "Laptop Stand", quantity: 1, price: 69.99 }],
      total: 69.99,
      trackingNumber: "1Z999AA10123456786",
      orderDate: "2026-02-10",
    },
  ],
]);

// -- Accounts --

const accounts = new Map<string, Account>([
  [
    "alice@example.com",
    {
      email: "alice@example.com",
      name: "Alice Johnson",
      memberSince: "2024-03-15",
      tier: "premium",
      orders: ["ORD-1001", "ORD-1002"],
      address: "742 Evergreen Terrace, Springfield",
    },
  ],
  [
    "bob@example.com",
    {
      email: "bob@example.com",
      name: "Bob Smith",
      memberSince: "2025-01-20",
      tier: "standard",
      orders: ["ORD-1003", "ORD-1004"],
      address: "1600 Pennsylvania Ave, Washington DC",
    },
  ],
  [
    "carol@example.com",
    {
      email: "carol@example.com",
      name: "Carol Williams",
      memberSince: "2025-08-10",
      tier: "standard",
      orders: ["ORD-1005"],
      address: "221B Baker Street, London",
    },
  ],
]);

// -- Tickets (mutable) --

let ticketCounter = 1000;
const tickets: Ticket[] = [];

// -- Public API --

export function checkOrderStatus(orderId: string): Order | { error: string } {
  const order = orders.get(orderId.toUpperCase());
  if (!order) return { error: `Order ${orderId} not found. Valid format: ORD-XXXX` };
  return order;
}

export function getAccountInfo(email: string): Account | { error: string } {
  const account = accounts.get(email.toLowerCase());
  if (!account) return { error: `No account found for ${email}` };
  return account;
}

export function createSupportTicket(
  subject: string,
  priority: "low" | "medium" | "high",
  details: string,
): Ticket {
  const ticket: Ticket = {
    ticketId: `TK-${++ticketCounter}`,
    subject,
    priority,
    details,
    createdAt: new Date().toISOString(),
  };
  tickets.push(ticket);
  return ticket;
}
