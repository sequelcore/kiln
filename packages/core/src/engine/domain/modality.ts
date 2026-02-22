// Engine primitive: Modality -- supported content modalities for agents and channels
// Zero external dependencies

export type Modality = "text" | "image" | "audio" | "file";

export const VALID_MODALITIES: readonly Modality[] = ["text", "image", "audio", "file"];

/** Validate a modalities array. Returns error messages for invalid entries. */
export function validateModalities(modalities: readonly string[]): readonly string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const m of modalities) {
    if (!VALID_MODALITIES.includes(m as Modality)) {
      errors.push(`unknown modality "${m}", must be one of: ${VALID_MODALITIES.join(", ")}`);
    }
    if (seen.has(m)) {
      errors.push(`duplicate modality "${m}"`);
    }
    seen.add(m);
  }
  return errors;
}
