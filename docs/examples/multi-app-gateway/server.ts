import { startGateway } from "@kilnai/runtime";
import { join } from "node:path";

const dir = import.meta.dir;

// Start gateway with multiple apps
const gateway = await startGateway(join(dir, "gateway.yaml"));

// Provision demo tenants
const tenantFiles = ["tenants/support-demo.json", "tenants/booking-demo.json"];

for (const file of tenantFiles) {
  try {
    const config = await Bun.file(join(dir, file)).json();
    const appName = config.appName;
    const res = await fetch(`http://localhost:3000/admin/${appName}/tenants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (res.ok) {
      console.log(`Tenant "${config.tenantId}" provisioned for app "${appName}"`);
    } else if (res.status === 409) {
      console.log(`Tenant "${config.tenantId}" already exists`);
    } else {
      console.warn(`Tenant "${config.tenantId}": ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.warn(`Failed to provision ${file}: ${err}`);
  }
}

console.log("\nMulti-app gateway ready:");
console.log("  Health:    http://localhost:3000/health");
console.log("  Support:   /apps/support/ws?widgetId=techshop-widget");
console.log("  Booking:   /apps/booking/ws?widgetId=bella-widget");
console.log("  API:       /api/support/message | /api/booking/message");
