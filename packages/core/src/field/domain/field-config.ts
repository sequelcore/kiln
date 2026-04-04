export interface FieldConfig {
  readonly minValue?: number;
  readonly maxValue?: number;
  readonly defaultConfidence?: number;
  readonly dominantRegionLimit?: number;
}

export const DEFAULT_FIELD_CONFIG: Required<FieldConfig> = {
  minValue: 0,
  maxValue: 1,
  defaultConfidence: 1,
  dominantRegionLimit: 5,
};
