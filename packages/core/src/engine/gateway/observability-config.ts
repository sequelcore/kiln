// Engine type: ObservabilityConfig -- optional top-level OTel observability configuration for gateway.yaml

import type { GatewayValidationError } from "./gateway-config.js";

/** Supported OTel exporter backends */
export type ObservabilityExporter = "otlp" | "console" | "none";

/** Top-level observability configuration for gateway.yaml */
export interface ObservabilityConfig {
    /** Whether observability is active. Defaults to true when the block is present. */
    readonly enabled: boolean;
    /** Which exporter to use: otlp (OTLP/HTTP), console (stdout), or none (disable). */
    readonly exporter: ObservabilityExporter;
    /** OTLP collector endpoint. Required when exporter is "otlp". */
    readonly endpoint?: string;
    /** Service name reported to the OTel backend. */
    readonly serviceName: string;
    /** Optional custom resource attributes attached to all spans. */
    readonly attributes?: Record<string, string>;
}

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
