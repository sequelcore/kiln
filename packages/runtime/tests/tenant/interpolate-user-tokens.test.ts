import { describe, it, expect } from "vitest";
import { interpolateUserTokens } from "../../src/tenant/interpolate-user-tokens.js";

describe("interpolateUserTokens", () => {
  it("replaces {{user.role}} with the context value", () => {
    expect(interpolateUserTokens("Role: {{user.role}}", { role: "admin" })).toBe("Role: admin");
  });

  it("replaces {{user.name}} with the context value", () => {
    expect(interpolateUserTokens("Hi {{user.name}}", { name: "John" })).toBe("Hi John");
  });

  it("replaces unknown token with empty string", () => {
    expect(interpolateUserTokens("{{user.unknown}}", { role: "admin" })).toBe("");
  });

  it("returns string unchanged when no tokens present", () => {
    expect(interpolateUserTokens("no tokens", { role: "admin" })).toBe("no tokens");
  });

  it("returns template unchanged when userContext is undefined", () => {
    expect(interpolateUserTokens("{{user.role}}", undefined)).toBe("{{user.role}}");
  });

  it("does not replace non-user namespaced tokens like {{payload.event}}", () => {
    expect(interpolateUserTokens("{{payload.event}}", { role: "admin" })).toBe("{{payload.event}}");
  });
});
