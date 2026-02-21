import { describe, it, expect } from "vitest";
import { validateObservabilityConfig } from "../../../src/engine/gateway/observability-config.js";
import type { ObservabilityConfig } from "../../../src/engine/gateway/observability-config.js";

// Valid base config for mutation tests
const VALID_OTLP: ObservabilityConfig = {
    enabled: true,
    exporter: "otlp",
    endpoint: "http://collector:4318/v1/traces",
    serviceName: "my-service",
};

const VALID_CONSOLE: ObservabilityConfig = {
    enabled: true,
    exporter: "console",
    serviceName: "my-service",
};

const VALID_NONE: ObservabilityConfig = {
    enabled: false,
    exporter: "none",
    serviceName: "my-service",
};

describe("validateObservabilityConfig", () => {
    describe("valid configs", () => {
        it("returns no errors for a valid console config", () => {
            expect(validateObservabilityConfig(VALID_CONSOLE)).toEqual([]);
        });

        it("returns no errors for a valid otlp config with endpoint", () => {
            expect(validateObservabilityConfig(VALID_OTLP)).toEqual([]);
        });

        it("returns no errors for exporter:none", () => {
            expect(validateObservabilityConfig(VALID_NONE)).toEqual([]);
        });

        it("accepts optional attributes as record of strings", () => {
            const config: ObservabilityConfig = {
                ...VALID_CONSOLE,
                attributes: { env: "production", region: "us-east-1" },
            };
            expect(validateObservabilityConfig(config)).toEqual([]);
        });
    });

    describe("serviceName validation", () => {
        it("returns error when serviceName is empty string", () => {
            const errors = validateObservabilityConfig({ ...VALID_CONSOLE, serviceName: "" });
            expect(errors.some((e) => e.field === "observability.serviceName")).toBe(true);
        });

        it("returns error when serviceName is whitespace only", () => {
            const errors = validateObservabilityConfig({ ...VALID_CONSOLE, serviceName: "   " });
            expect(errors.some((e) => e.field === "observability.serviceName")).toBe(true);
        });
    });

    describe("exporter validation", () => {
        it("returns error for unknown exporter value", () => {
            const errors = validateObservabilityConfig({
                ...VALID_CONSOLE,
                exporter: "datadog" as ObservabilityConfig["exporter"],
            });
            expect(errors.some((e) => e.field === "observability.exporter")).toBe(true);
        });
    });

    describe("endpoint validation", () => {
        it("requires endpoint when exporter is otlp", () => {
            const errors = validateObservabilityConfig({
                ...VALID_OTLP,
                endpoint: undefined,
            });
            expect(errors.some((e) => e.field === "observability.endpoint")).toBe(true);
        });

        it("requires endpoint to be non-empty when exporter is otlp", () => {
            const errors = validateObservabilityConfig({ ...VALID_OTLP, endpoint: "" });
            expect(errors.some((e) => e.field === "observability.endpoint")).toBe(true);
        });

        it("does not require endpoint for console exporter", () => {
            const errors = validateObservabilityConfig({ ...VALID_CONSOLE, endpoint: undefined });
            expect(errors.every((e) => e.field !== "observability.endpoint")).toBe(true);
        });

        it("does not require endpoint for none exporter", () => {
            const errors = validateObservabilityConfig({ ...VALID_NONE, endpoint: undefined });
            expect(errors.every((e) => e.field !== "observability.endpoint")).toBe(true);
        });
    });

    describe("attributes validation", () => {
        it("returns error when an attribute value is not a string", () => {
            const config = {
                ...VALID_CONSOLE,
                attributes: { env: 42 as unknown as string },
            };
            const errors = validateObservabilityConfig(config);
            expect(errors.some((e) => e.field === "observability.attributes.env")).toBe(true);
        });
    });
});
