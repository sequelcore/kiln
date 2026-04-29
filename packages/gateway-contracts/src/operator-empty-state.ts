export const OPERATOR_EMPTY_STATE_PHRASES = [
  "Job's live. Run it clean.",
  "Signal's hot. Take control.",
  "Patch the loop. Move sharp.",
  "No noise. Just execution.",
  "Dial the system. Burn bright.",
  "Ghosts in the wire. Cut through.",
  "Wake the circuit. Make it yours.",
  "Burn the static. Keep the signal.",
  "Break the script. Own the run.",
  "No masters in the loop. Ship it.",
] as const;

export type OperatorEmptyStatePhrase = typeof OPERATOR_EMPTY_STATE_PHRASES[number];

export function operatorEmptyStatePhraseAt(index: number): OperatorEmptyStatePhrase {
  const normalizedIndex = Number.isFinite(index)
    ? Math.abs(Math.trunc(index)) % OPERATOR_EMPTY_STATE_PHRASES.length
    : 0;
  return OPERATOR_EMPTY_STATE_PHRASES[normalizedIndex] ?? OPERATOR_EMPTY_STATE_PHRASES[0];
}
