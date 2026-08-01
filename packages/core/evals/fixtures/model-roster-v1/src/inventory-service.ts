import type { ReservationRequest } from "./contracts.js";

export class InventoryService {
  private readonly reservedUnits = new Map<string, number>();

  reserve(request: ReservationRequest): void {
    const key = `${request.orderId}:${request.sku}`;
    const current = this.reservedUnits.get(key) ?? 0;
    this.reservedUnits.set(key, current + request.units);
  }

  reserved(orderId: string, sku: string): number {
    return this.reservedUnits.get(`${orderId}:${sku}`) ?? 0;
  }
}
