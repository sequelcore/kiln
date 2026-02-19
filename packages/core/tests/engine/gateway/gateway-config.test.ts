import { describe, it, expect } from "vitest";
import type { GatewayConfig, GatewayAppBinding, GatewayChannelBinding } from "../../../src/engine/gateway/gateway-config.js";
import { validateGatewayConfig } from "../../../src/engine/gateway/gateway-config.js";

function makeChannelBinding(overrides: Partial<GatewayChannelBinding> = {}): GatewayChannelBinding {
  return { type: "api", path: "/api/test", ...overrides };
}

function makeAppBinding(overrides: Partial<GatewayAppBinding> = {}): GatewayAppBinding {
  return {
    name: "test-app",
    config: "apps/test.yaml",
    channels: [makeChannelBinding()],
    ...overrides,
  };
}

function makeConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    port: 4800,
    apps: [makeAppBinding()],
    ...overrides,
  };
}

describe("GatewayConfig", () => {
  describe("validateGatewayConfig", () => {
    it("returns empty array for a valid config", () => {
      expect(validateGatewayConfig(makeConfig())).toEqual([]);
    });

    it("accepts multiple valid apps with distinct names", () => {
      const config = makeConfig({
        apps: [
          makeAppBinding({ name: "app-a", channels: [{ type: "api", path: "/api/a" }] }),
          makeAppBinding({ name: "app-b", channels: [{ type: "whatsapp", phoneNumber: "+521234567890" }] }),
        ],
      });
      expect(validateGatewayConfig(config)).toEqual([]);
    });

    it("reports error for empty apps array", () => {
      const errors = validateGatewayConfig(makeConfig({ apps: [] }));
      expect(errors.some((e) => e.field === "apps")).toBe(true);
    });

    it("reports error for duplicate app names", () => {
      const config = makeConfig({
        apps: [
          makeAppBinding({ name: "duplicate", channels: [{ type: "api", path: "/api/a" }] }),
          makeAppBinding({ name: "duplicate", channels: [{ type: "web" }] }),
        ],
      });
      const errors = validateGatewayConfig(config);
      expect(errors.some((e) => e.field.includes("name") && e.message.includes("duplicate"))).toBe(true);
    });

    it("reports error for duplicate API paths", () => {
      const config = makeConfig({
        apps: [
          makeAppBinding({ name: "app-a", channels: [{ type: "api", path: "/api/shared" }] }),
          makeAppBinding({ name: "app-b", channels: [{ type: "api", path: "/api/shared" }] }),
        ],
      });
      const errors = validateGatewayConfig(config);
      expect(errors.some((e) => e.message.includes("/api/shared"))).toBe(true);
    });

    it("reports error for duplicate phone numbers", () => {
      const config = makeConfig({
        apps: [
          makeAppBinding({ name: "app-a", channels: [{ type: "whatsapp", phoneNumber: "+521234567890" }] }),
          makeAppBinding({ name: "app-b", channels: [{ type: "whatsapp", phoneNumber: "+521234567890" }] }),
        ],
      });
      const errors = validateGatewayConfig(config);
      expect(errors.some((e) => e.message.includes("+521234567890"))).toBe(true);
    });

    it("reports error for port 0", () => {
      const errors = validateGatewayConfig(makeConfig({ port: 0 }));
      expect(errors.some((e) => e.field === "port")).toBe(true);
    });

    it("reports error for negative port", () => {
      const errors = validateGatewayConfig(makeConfig({ port: -1 }));
      expect(errors.some((e) => e.field === "port")).toBe(true);
    });

    it("reports error for port above 65535", () => {
      const errors = validateGatewayConfig(makeConfig({ port: 70000 }));
      expect(errors.some((e) => e.field === "port")).toBe(true);
    });

    it("reports error for non-integer port", () => {
      const errors = validateGatewayConfig(makeConfig({ port: 3.14 }));
      expect(errors.some((e) => e.field === "port")).toBe(true);
    });

    it("reports error when app name is empty", () => {
      const config = makeConfig({
        apps: [makeAppBinding({ name: "" })],
      });
      const errors = validateGatewayConfig(config);
      expect(errors.some((e) => e.field.includes("name"))).toBe(true);
    });

    it("reports error when app config is empty", () => {
      const config = makeConfig({
        apps: [makeAppBinding({ config: "" })],
      });
      const errors = validateGatewayConfig(config);
      expect(errors.some((e) => e.field.includes("config"))).toBe(true);
    });

    it("reports error when app has no channel bindings", () => {
      const config = makeConfig({
        apps: [makeAppBinding({ channels: [] })],
      });
      const errors = validateGatewayConfig(config);
      expect(errors.some((e) => e.field.includes("channels"))).toBe(true);
    });

    it("accumulates multiple errors", () => {
      const config: GatewayConfig = {
        port: 0,
        apps: [
          { name: "", config: "", channels: [] },
          { name: "same", config: "a.yaml", channels: [{ type: "web" }] },
          { name: "same", config: "b.yaml", channels: [{ type: "api", path: "/shared" }] },
          { name: "other", config: "c.yaml", channels: [{ type: "api", path: "/shared" }] },
        ],
      };
      const errors = validateGatewayConfig(config);
      expect(errors.length).toBeGreaterThanOrEqual(4);
    });
  });
});
