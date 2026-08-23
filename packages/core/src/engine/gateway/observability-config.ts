// Engine type: ObservabilityConfig -- optional top-level OTel observability configuration for gateway.yaml

import type { GatewayValidationError } from "./gateway-config.js";
import type { ObservabilityConfig, ObservabilityExporter } from "./gateway-config-schema.js";

/** Schema-derived gateway observability configuration and exporter types. */
export type { ObservabilityConfig, ObservabilityExporter } from "./gateway-config-schema.js";

/** Validate an ObservabilityConfig. Returns array of errors; empty means valid. */
export function validateObservabilityConfig(config: ObservabilityConfig): GatewayValidationError[] {
    const errors: GatewayValidationError[] = [];
    const prefix = "observability";

    if (!config.serviceName || typeof config.serviceName !== "string" || config.serviceName.trim() === "") {
        errors.push({ field: `${prefix}.serviceName`, message: "must be a non-empty string" });
    }

    const validExporters: ObservabilityExporter[] = ["otlp", "console", "none"];
    if (!validExporters.includes(config.exporter)) {
        errors.push({ field: `${prefix}.exporter`, message: `must be one of: ${validExporters.join(", ")}` });
    }

    if (config.exporter === "otlp") {
        if (!config.endpoint || typeof config.endpoint !== "string" || config.endpoint.trim() === "") {
            errors.push({ field: `${prefix}.endpoint`, message: "required when exporter is \"otlp\"" });
        }
    }

    if (config.attributes !== undefined) {
        for (const [key, value] of Object.entries(config.attributes)) {
            if (typeof value !== "string") {
                errors.push({ field: `${prefix}.attributes.${key}`, message: "attribute values must be strings" });
            }
        }
    }

    return errors;
}
