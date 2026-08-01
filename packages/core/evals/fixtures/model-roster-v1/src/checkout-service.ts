import type { ReservationRequest } from "./contracts.js";
import { InventoryService } from "./inventory-service.js";

export class CheckoutService {
  constructor(private readonly inventory: InventoryService) {}

  checkout(request: ReservationRequest): void {
    this.inventory.reserve(request);
  }
}
