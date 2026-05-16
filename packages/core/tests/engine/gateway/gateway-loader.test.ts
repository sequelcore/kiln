import { afterEach, describe, it, expect } from "vitest";
import { parseGatewayYaml, GatewayLoaderError } from "../../../src/engine/gateway/gateway-loader.js";

const VALID_YAML = `
port: 5000
apps:
  - name: test-app
    config: apps/test.yaml
    workspace: /workspaces/test
    channels:
      - type: api
        path: /api/test
      - type: web
  - name: other-app
    config: apps/other.yaml
    channels:
      - type: whatsapp
        phoneNumber: "+521234567890"
`;

describe("parseGatewayYaml", () => {
  it("parses a valid gateway.yaml with all fields", () => {
    const config = parseGatewayYaml(VALID_YAML);
    expect(config.port).toBe(5000);
    expect(config.apps).toHaveLength(2);

    const first = config.apps[0]!;
    expect(first.name).toBe("test-app");
    expect(first.config).toBe("apps/test.yaml");
    expect(first.workspace).toBe("/workspaces/test");
    expect(first.channels).toHaveLength(2);
    expect(first.channels[0]!.type).toBe("api");
    expect(first.channels[0]!.path).toBe("/api/test");
    expect(first.channels[1]!.type).toBe("web");

    const second = config.apps[1]!;
    expect(second.name).toBe("other-app");
    expect(second.config).toBe("apps/other.yaml");
    expect(second.workspace).toBeUndefined();
    expect(second.channels[0]!.type).toBe("whatsapp");
    expect(second.channels[0]!.phoneNumber).toBe("+521234567890");
  });

  it("defaults port to 4800 when omitted", () => {
    const yaml = `
apps:
  - name: my-app
    config: app.yaml
    channels:
      - type: web
`;
    const config = parseGatewayYaml(yaml);
    expect(config.port).toBe(4800);
  });

  it("throws GatewayLoaderError on invalid YAML syntax", () => {
    const badYaml = `port: [\nthis is not valid yaml:::`;
    expect(() => parseGatewayYaml(badYaml)).toThrow(GatewayLoaderError);
  });

  it("includes yaml field in error on syntax failure", () => {
    const badYaml = `port: [\nthis is not valid yaml:::`;
    try {
      parseGatewayYaml(badYaml);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GatewayLoaderError);
      const loaderErr = err as GatewayLoaderError;
      expect(loaderErr.errors.some((e) => e.field === "yaml")).toBe(true);
    }
  });

  it("throws GatewayLoaderError on validation errors (duplicate app names)", () => {
    const yaml = `
port: 4800
apps:
  - name: duplicate
    config: a.yaml
    channels:
      - type: api
        path: /api/a
  - name: duplicate
    config: b.yaml
    channels:
      - type: web
`;
    expect(() => parseGatewayYaml(yaml)).toThrow(GatewayLoaderError);
  });

  it("preserves channel binding path property", () => {
    const yaml = `
port: 4800
apps:
  - name: api-app
    config: app.yaml
    channels:
      - type: api
        path: /api/v1
`;
    const config = parseGatewayYaml(yaml);
    expect(config.apps[0]!.channels[0]!.path).toBe("/api/v1");
  });

  it("preserves phoneNumber on whatsapp channel", () => {
    const yaml = `
port: 4800
apps:
  - name: wa-app
    config: app.yaml
    channels:
      - type: whatsapp
        phoneNumber: "+521112223333"
`;
    const config = parseGatewayYaml(yaml);
    expect(config.apps[0]!.channels[0]!.phoneNumber).toBe("+521112223333");
  });

  it("preserves public media env bindings for channel delivery", () => {
    const yaml = `
port: 4800
apps:
  - name: wa-app
    config: app.yaml
    channels:
      - type: whatsapp
        publicMediaBaseUrlEnv: GATEWAY_PUBLIC_URL
        publicMediaSigningSecretEnv: GATEWAY_MEDIA_SIGNING_SECRET
`;
    const config = parseGatewayYaml(yaml);
    const channel = config.apps[0]!.channels[0]!;
    expect(channel.publicMediaBaseUrlEnv).toBe("GATEWAY_PUBLIC_URL");
    expect(channel.publicMediaSigningSecretEnv).toBe("GATEWAY_MEDIA_SIGNING_SECRET");
  });

  it("preserves workspace field when present", () => {
    const yaml = `
port: 4800
apps:
  - name: ws-app
    config: app.yaml
    workspace: /workspaces/ws-app
    channels:
      - type: cli
`;
    const config = parseGatewayYaml(yaml);
    expect(config.apps[0]!.workspace).toBe("/workspaces/ws-app");
  });

  it("omits workspace field when not present", () => {
    const yaml = `
port: 4800
apps:
  - name: no-ws-app
    config: app.yaml
    channels:
      - type: cli
`;
    const config = parseGatewayYaml(yaml);
    expect(config.apps[0]!.workspace).toBeUndefined();
  });

  it("throws GatewayLoaderError when root is not an object", () => {
    expect(() => parseGatewayYaml("- item1\n- item2")).toThrow(GatewayLoaderError);
  });

  it("throws GatewayLoaderError when apps is not an array", () => {
    const yaml = `
port: 4800
apps: "not-an-array"
`;
    expect(() => parseGatewayYaml(yaml)).toThrow(GatewayLoaderError);
  });

  it("GatewayLoaderError message includes field and message", () => {
    const yaml = `
port: 4800
apps: []
`;
    try {
      parseGatewayYaml(yaml);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GatewayLoaderError);
      const loaderErr = err as GatewayLoaderError;
      expect(loaderErr.message).toContain("gateway YAML");
      expect(loaderErr.errors.length).toBeGreaterThan(0);
    }
  });

  // ---------------------------------------------------------------------------
  // Observability block
  // ---------------------------------------------------------------------------

  it("leaves config.observability undefined when observability block is omitted", () => {
    const yaml = `
port: 4800
apps:
  - name: no-obs-app
    config: app.yaml
    channels:
      - type: web
`;
    const config = parseGatewayYaml(yaml);
    expect(config.observability).toBeUndefined();
  });

  it("parses a valid console observability block", () => {
    const yaml = `
port: 4800
apps:
  - name: my-app
    config: app.yaml
    channels:
      - type: web
observability:
  exporter: console
  serviceName: my-kiln-service
`;
    const config = parseGatewayYaml(yaml);
    expect(config.observability).toBeDefined();
    expect(config.observability?.exporter).toBe("console");
    expect(config.observability?.serviceName).toBe("my-kiln-service");
    expect(config.observability?.enabled).toBe(true);
  });

  it("parses a valid otlp observability block with endpoint and attributes", () => {
    const yaml = `
port: 4800
apps:
  - name: my-app
    config: app.yaml
    channels:
      - type: web
observability:
  exporter: otlp
  endpoint: "http://collector:4318/v1/traces"
  serviceName: my-service
  attributes:
    env: production
    region: us-east-1
`;
    const config = parseGatewayYaml(yaml);
    expect(config.observability?.exporter).toBe("otlp");
    expect(config.observability?.endpoint).toBe("http://collector:4318/v1/traces");
    expect(config.observability?.attributes?.["env"]).toBe("production");
  });

  it("respects explicit enabled: false", () => {
    const yaml = `
port: 4800
apps:
  - name: my-app
    config: app.yaml
    channels:
      - type: web
observability:
  enabled: false
  exporter: console
  serviceName: my-service
`;
    const config = parseGatewayYaml(yaml);
    expect(config.observability?.enabled).toBe(false);
  });

  it("throws GatewayLoaderError when observability exporter is otlp but endpoint is missing", () => {
    const yaml = `
port: 4800
apps:
  - name: my-app
    config: app.yaml
    channels:
      - type: web
observability:
  exporter: otlp
  serviceName: my-service
`;
    expect(() => parseGatewayYaml(yaml)).toThrow(GatewayLoaderError);
  });

  it("throws GatewayLoaderError when observability serviceName is missing", () => {
    const yaml = `
port: 4800
apps:
  - name: my-app
    config: app.yaml
    channels:
      - type: web
observability:
  exporter: console
`;
    expect(() => parseGatewayYaml(yaml)).toThrow(GatewayLoaderError);
  });
});

describe("parseGatewayYaml -- auth block", () => {
  const originalEnv = process.env;
  const BASE = `
port: 4800
apps:
  - name: my-app
    config: app.yaml
    channels:
      - type: api
        path: /api/v1
`;

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("omits auth when auth block is absent (backward compat)", () => {
    const config = parseGatewayYaml(BASE);
    expect(config.auth).toBeUndefined();
  });

  it("parses valid RS256 auth block", () => {
    const yaml = BASE + `auth:\n  algorithm: RS256\n  jwksUri: "https://auth.example.com/.well-known/jwks.json"\n`;
    const config = parseGatewayYaml(yaml);
    expect(config.auth).toBeDefined();
    expect(config.auth!.algorithm).toBe("RS256");
    expect(config.auth!.jwksUri).toBe("https://auth.example.com/.well-known/jwks.json");
    expect(config.auth!.secretEnv).toBeUndefined();
  });

  it("resolves RS256 jwksUri from environment when prefixed with $", () => {
    process.env = { ...originalEnv, JWT_JWKS_URI: "https://auth.example.com/.well-known/jwks.json" };
    const yaml = BASE + `auth:\n  algorithm: RS256\n  jwksUri: $JWT_JWKS_URI\n`;
    const config = parseGatewayYaml(yaml);
    expect(config.auth).toBeDefined();
    expect(config.auth!.jwksUri).toBe("https://auth.example.com/.well-known/jwks.json");
  });

  it("parses valid HS256 auth block", () => {
    const yaml = BASE + `auth:\n  algorithm: HS256\n  secretEnv: JWT_SECRET\n`;
    const config = parseGatewayYaml(yaml);
    expect(config.auth!.algorithm).toBe("HS256");
    expect(config.auth!.secretEnv).toBe("JWT_SECRET");
  });

  it("parses optional issuer and audience", () => {
    const yaml =
      BASE +
      `auth:\n  algorithm: RS256\n  jwksUri: "https://auth.example.com/.well-known/jwks.json"\n  issuer: "https://auth.example.com"\n  audience: my-api\n  clockToleranceSeconds: 45\n`;
    const config = parseGatewayYaml(yaml);
    expect(config.auth!.issuer).toBe("https://auth.example.com");
    expect(config.auth!.audience).toBe("my-api");
    expect(config.auth!.clockToleranceSeconds).toBe(45);
  });

  it("throws GatewayLoaderError when auth is not an object", () => {
    const yaml = BASE + `auth: "not-an-object"\n`;
    expect(() => parseGatewayYaml(yaml)).toThrow(GatewayLoaderError);
  });

  it("throws GatewayLoaderError when RS256 is missing jwksUri", () => {
    const yaml = BASE + `auth:\n  algorithm: RS256\n`;
    expect(() => parseGatewayYaml(yaml)).toThrow(GatewayLoaderError);
  });

  it("throws GatewayLoaderError when RS256 jwksUri env var is missing", () => {
    process.env = { ...originalEnv, JWT_JWKS_URI: "" };
    const yaml = BASE + `auth:\n  algorithm: RS256\n  jwksUri: $JWT_JWKS_URI\n`;
    expect(() => parseGatewayYaml(yaml)).toThrow(GatewayLoaderError);
  });

  it("throws GatewayLoaderError when HS256 is missing secretEnv", () => {
    const yaml = BASE + `auth:\n  algorithm: HS256\n`;
    expect(() => parseGatewayYaml(yaml)).toThrow(GatewayLoaderError);
  });

  it("throws GatewayLoaderError on unknown algorithm", () => {
    const yaml = BASE + `auth:\n  algorithm: ES256\n`;
    expect(() => parseGatewayYaml(yaml)).toThrow(GatewayLoaderError);
  });

  it("throws GatewayLoaderError on negative clock tolerance", () => {
    const yaml = BASE + `auth:\n  algorithm: RS256\n  jwksUri: "https://auth.example.com/.well-known/jwks.json"\n  clockToleranceSeconds: -1\n`;
    expect(() => parseGatewayYaml(yaml)).toThrow(GatewayLoaderError);
  });
});

