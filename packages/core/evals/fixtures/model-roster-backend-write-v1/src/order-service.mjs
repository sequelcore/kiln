export function reserveStock(state, sku, quantity, requestId) {
  const remaining = state.stock[sku] - quantity;
  state.stock[sku] = remaining;

  if (remaining < 0) {
    throw new Error("Insufficient stock");
  }

  const reservation = { sku, quantity, remaining, requestId };
  state.reservations[requestId] = reservation;
  return reservation;
}
