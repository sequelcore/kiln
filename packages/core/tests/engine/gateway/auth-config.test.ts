import { describe, it, expect } from "vitest";
import { validateGatewayAuthConfig } from "../../../src/engine/gateway/auth-config.js";
import type { GatewayAuthConfig } from "../../../src/engine/gateway/auth-config.js";

describe("validateGatewayAuthConfig", () => {
  describe("RS256", () => {
    it("accepts valid RS256 config with jwksUri", () => {
      const config: GatewayAuthConfig = {
        algorithm: "RS256",
        jwksUri: "https://auth.example.com/.well-known/jwks.json",
      };
      expect(validateGatewayAuthConfig(config)).toHaveLength(0);
    });

    it("accepts RS256 with optional issuer and audience", () => {
      const config: GatewayAuthConfig = {
        algorithm: "RS256",
        jwksUri: "https://auth.example.com/.well-known/jwks.json",
        issuer: "https://auth.example.com",
        audience: "my-api",
        clockToleranceSeconds: 30,
      };
      expect(validateGatewayAuthConfig(config)).toHaveLength(0);
    });

    it("rejects RS256 missing jwksUri", () => {
      const config: GatewayAuthConfig = { algorithm: "RS256" };
      const errors = validateGatewayAuthConfig(config);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.field).toBe("auth.jwksUri");
    });

    it("rejects RS256 with secretEnv set", () => {
      const config: GatewayAuthConfig = {
        algorithm: "RS256",
        jwksUri: "https://auth.example.com/.well-known/jwks.json",
        secretEnv: "JWT_SECRET",
      };
      const errors = validateGatewayAuthConfig(config);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.field).toBe("auth.secretEnv");
    });
  });

  describe("HS256", () => {
    it("accepts valid HS256 config with secretEnv", () => {
      const config: GatewayAuthConfig = { algorithm: "HS256", secretEnv: "JWT_SECRET" };
      expect(validateGatewayAuthConfig(config)).toHaveLength(0);
    });

    it("accepts HS256 with optional issuer and audience", () => {
      const config: GatewayAuthConfig = {
        algorithm: "HS256",
        secretEnv: "JWT_SECRET",
        issuer: "my-service",
        audience: "my-api",
        clockToleranceSeconds: 30,
      };
      expect(validateGatewayAuthConfig(config)).toHaveLength(0);
    });

    it("rejects HS256 missing secretEnv", () => {
      const config: GatewayAuthConfig = { algorithm: "HS256" };
      const errors = validateGatewayAuthConfig(config);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.field).toBe("auth.secretEnv");
    });

    it("rejects HS256 with jwksUri set", () => {
      const config: GatewayAuthConfig = {
        algorithm: "HS256",
        secretEnv: "JWT_SECRET",
        jwksUri: "https://auth.example.com/.well-known/jwks.json",
      };
      const errors = validateGatewayAuthConfig(config);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.field).toBe("auth.jwksUri");
    });
  });

  it("rejects unknown algorithm", () => {
    const config = { algorithm: "ES256" } as unknown as GatewayAuthConfig;
    const errors = validateGatewayAuthConfig(config);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.field).toBe("auth.algorithm");
  });

  it("rejects negative clock tolerance", () => {
    const config = {
      algorithm: "RS256",
      jwksUri: "https://auth.example.com/.well-known/jwks.json",
      clockToleranceSeconds: -1,
    } as GatewayAuthConfig;
    const errors = validateGatewayAuthConfig(config);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.field).toBe("auth.clockToleranceSeconds");
  });
});
