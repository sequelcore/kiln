// Mock billing server for booking assistant
// Tracks per-tenant token budgets and usage

const PORT = 3300;
const DEFAULT_BUDGET = 50_000; // tokens per tenant

// In-memory budget tracking
const budgets = new Map<string, { remaining: number; total: number; used: number }>();

function getBudget(tenantId: string) {
  if (!budgets.has(tenantId)) {
    budgets.set(tenantId, { remaining: DEFAULT_BUDGET, total: DEFAULT_BUDGET, used: 0 });
  }
  return budgets.get(tenantId)!;
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // GET /budget?tenantId=xxx -- check budget
    if (req.method === "GET" && url.pathname === "/budget") {
      const tenantId = url.searchParams.get("tenantId") ?? "default";
      const budget = getBudget(tenantId);

      return Response.json({
        allowed: budget.remaining > 0,
        remaining: budget.remaining,
        total: budget.total,
        used: budget.used,
        unit: "tokens",
        ...(budget.remaining <= 0 ? { reason: "Monthly token budget exhausted" } : {}),
      });
    }

    // POST /usage -- report usage
    if (req.method === "POST" && url.pathname === "/usage") {
      const body = (await req.json()) as { tenantId?: string; tokens?: number; model?: string };
      const tenantId = body.tenantId ?? "default";
      const tokens = body.tokens ?? 0;

      const budget = getBudget(tenantId);
      budget.used += tokens;
      budget.remaining = Math.max(0, budget.remaining - tokens);

      console.log(`[billing] ${tenantId}: ${tokens} tokens used (${budget.remaining} remaining)`);

      return Response.json({ recorded: true, remaining: budget.remaining });
    }

    // GET /health
    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok", tenants: budgets.size });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Mock billing server listening on http://localhost:${PORT}`);
