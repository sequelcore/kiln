import { describe, expect, it } from "vitest";
import {
  classifyNativeRouteIntegrity,
  resolveNativeDefaultRouteProjection,
} from "../../src/config/native-route-integrity.js";

describe("native-route-integrity", () => {
  it("classifies the OpenCode stale ambient fallback incident without blaming credentials", () => {
    const diagnostic = classifyNativeRouteIntegrity({
      harness: "opencode",
      canonicalRoute: { providerId: "opencode-go", model: "deepseek-v4-flash" },
      nativeConfiguredDefault: { providerId: "opencode-go", model: "deepseek-v4-flash-free" },
      selectedRuntimeRoute: { providerId: "opencode-go", model: "deepseek-v4-flash-free" },
      explicitProbe: { status: "succeeded", credentialSource: "kiln-auth-store" },
      catalogStatus: { status: "unknown-model", providerId: "opencode-go", model: "deepseek-v4-flash-free" },
      observedError: { message: "Invalid API key" },
    });

    expect(diagnostic.classification).toBe("ambient-fallback-mismatch");
    expect(diagnostic.credentialStatus).toBe("valid");
    expect(diagnostic.routeStatus).toBe("native-default-invalid");
    expect(diagnostic.message).toContain("native default selected opencode-go/deepseek-v4-flash-free");
    expect(diagnostic.message).not.toContain("credential is invalid");
  });

  it("distinguishes invalid credentials for a valid route", () => {
    const diagnostic = classifyNativeRouteIntegrity({
      harness: "opencode",
      canonicalRoute: { providerId: "opencode-go", model: "deepseek-v4-flash" },
      nativeConfiguredDefault: { providerId: "opencode-go", model: "deepseek-v4-flash" },
      selectedRuntimeRoute: { providerId: "opencode-go", model: "deepseek-v4-flash" },
      explicitProbe: { status: "authentication-failed", credentialSource: "kiln-auth-store" },
      catalogStatus: { status: "available", providerId: "opencode-go", model: "deepseek-v4-flash" },
      observedError: { message: "Invalid API key" },
    });

    expect(diagnostic.classification).toBe("authentication-failure");
    expect(diagnostic.credentialStatus).toBe("invalid");
    expect(diagnostic.routeStatus).toBe("matches-canonical");
  });

  it("reports disabled providers before credential checks", () => {
    const diagnostic = classifyNativeRouteIntegrity({
      harness: "codex",
      canonicalRoute: { providerId: "codex-oauth", model: "gpt-5.4-mini" },
      explicitProbe: { status: "not-run", credentialSource: "none" },
      catalogStatus: { status: "disabled-provider", providerId: "codex-oauth", model: "gpt-5.4-mini" },
    });

    expect(diagnostic.classification).toBe("unavailable-route");
    expect(diagnostic.credentialStatus).toBe("not-tested");
  });

  it("requires a model before projecting a native default", () => {
    const projection = resolveNativeDefaultRouteProjection("opencode", {
      version: "1",
      provider: "opencode-go",
    });

    expect(projection.status).toBe("missing-default");
    expect(projection.managedFields).toEqual(["model"]);
  });

  it("encodes only supported native default route syntax", () => {
    expect(resolveNativeDefaultRouteProjection("codex", {
      version: "1",
      provider: "codex-oauth",
      model: { default: "gpt-5.4-mini" },
    })).toMatchObject({
      status: "project",
      nativeModel: "gpt-5.4-mini",
    });

    expect(resolveNativeDefaultRouteProjection("opencode", {
      version: "1",
      provider: "opencode-go",
      model: { default: "deepseek-v4-flash" },
    })).toMatchObject({
      status: "project",
      nativeModel: "opencode-go/deepseek-v4-flash",
    });

    expect(resolveNativeDefaultRouteProjection("codex", {
      version: "1",
      provider: "opencode-go",
      model: { default: "deepseek-v4-flash" },
    })).toMatchObject({
      status: "remove-stale",
    });
  });
});
