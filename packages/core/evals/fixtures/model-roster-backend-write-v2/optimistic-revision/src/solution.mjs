export function applyRevision(state, id, expectedRevision, patch) {
  Object.assign(state.documents[id], patch);
  state.documents[id].revision += 1;
  return state.documents[id];
}
