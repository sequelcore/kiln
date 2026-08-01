export interface ReservationRequest {
  readonly orderId: string;
  readonly sku: string;
  readonly units: number;
}
