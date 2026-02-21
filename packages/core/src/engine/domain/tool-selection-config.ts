// ToolSelectionConfig types -- YAML configuration for tool selection strategy

export type ToolSelectionStrategy = "all" | "rag";

export interface ToolSelectionConfig {
  readonly strategy: ToolSelectionStrategy;
  readonly maxTools?: number;
  readonly threshold?: number;
}

export interface ToolSelectionValidationError {
  readonly field: string;
  readonly message: string;
}

export function validateToolSelectionConfig(config: ToolSelectionConfig): ToolSelectionValidationError[] {
  const errors: ToolSelectionValidationError[] = [];

  if (!config.strategy || !["all", "rag"].includes(config.strategy)) {
    errors.push({ field: "strategy", message: "must be 'all' or 'rag'" });
  }

  if (config.maxTools !== undefined) {
    if (typeof config.maxTools !== "number" || config.maxTools <= 0) {
      errors.push({ field: "maxTools", message: "must be a positive number" });
    }
  }

  if (config.threshold !== undefined) {
    if (typeof config.threshold !== "number" || config.threshold <= 0) {
      errors.push({ field: "threshold", message: "must be a positive number" });
    }
  }

  if (config.maxTools !== undefined && config.threshold !== undefined && config.maxTools >= config.threshold) {
    errors.push({ field: "maxTools", message: "must be less than threshold" });
  }

  return errors;
}
