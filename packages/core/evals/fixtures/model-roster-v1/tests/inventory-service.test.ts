import { describe, expect, it } from "vitest";
import { InventoryService } from "../src/inventory-service.js";

describe("InventoryService", () => {
  it("reserves units", () => {
    const inventory = new InventoryService();
    inventory.reserve({ orderId: "order-1", sku: "sku-1", units: 2 });
    expect(inventory.reserved("order-1", "sku-1")).toBe(2);
  });
});
