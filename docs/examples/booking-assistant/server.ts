import { startGateway } from "@kilnai/runtime";
import { join } from "node:path";

const dir = import.meta.dir;

// 1. Start MCP booking tools server
const toolsProc = Bun.spawn(["bun", "run", join(dir, "tools-server.ts")], {
  stdout: "inherit",
  stderr: "inherit",
});

// 2. Start mock billing server
const billingProc = Bun.spawn(["bun", "run", join(dir, "mock-billing-server.ts")], {
  stdout: "inherit",
  stderr: "inherit",
});

// 3. Wait for both servers to be ready
async function waitForServer(url: string, name: string, maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        console.log(`${name} ready`);
        return;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  console.error(`${name} failed to start`);
  process.exit(1);
}

await Promise.all([
  waitForServer("http://localhost:3200/health", "Tools server"),
  waitForServer("http://localhost:3300/health", "Billing server"),
]);

// 4. Start gateway
const gateway = await startGateway(join(dir, "gateway.yaml"));

// 5. Provision demo tenant
try {
  const tenantConfig = await Bun.file(join(dir, "tenant-example.json")).json();
  const res = await fetch("http://localhost:3000/admin/booking-assistant/tenants", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tenantConfig),
  });
  if (res.ok) {
    console.log(`Demo tenant "${tenantConfig.tenantId}" provisioned`);
  } else if (res.status === 409) {
    console.log(`Demo tenant "${tenantConfig.tenantId}" already exists`);
  } else {
    console.warn(`Tenant provisioning: ${res.status} ${await res.text()}`);
  }
} catch (err) {
  console.warn(`Tenant provisioning failed: ${err}`);
}

console.log("\nBooking assistant ready:");
console.log("  Widget:  open index.html in browser");
console.log("  API:     POST http://localhost:3000/api/booking/message");
console.log("  Webhook: POST http://localhost:3000/webhooks/booking-assistant/hooks/confirmed");

// Clean up on exit
process.on("SIGINT", () => {
  toolsProc.kill();
  billingProc.kill();
  process.exit(0);
});
