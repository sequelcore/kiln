export function applyInventoryEvent(state, event) {
  state.stock[event.sku] = (state.stock[event.sku] ?? 0) + event.delta;
  return state.stock[event.sku];
}
