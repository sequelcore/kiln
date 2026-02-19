import { describe, it, expect } from "vitest";
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
});
