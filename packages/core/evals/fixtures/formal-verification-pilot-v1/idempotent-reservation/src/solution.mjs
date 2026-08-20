export function reserveStock(state, sku, quantity, requestId) {
  state.stock[sku] -= quantity;
  return { sku, quantity, remaining: state.stock[sku], requestId };
}
