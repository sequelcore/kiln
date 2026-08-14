export function transferFunds(state, from, to, amount, requestId) {
  state.balances[from] -= amount;
  state.balances[to] += amount;
  return { requestId, from, to, amount };
}
