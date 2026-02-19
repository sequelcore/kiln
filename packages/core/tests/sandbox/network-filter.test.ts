import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { createPolicy } from "../../src/sandbox/policies.js";
import { NetworkFilter } from "../../src/sandbox/network-filter.js";

const PROJECT = resolve("/tmp/test-project");

describe("NetworkFilter", () => {
  it("allows package manager URL for worker", () => {
    const policy = createPolicy("worker", PROJECT);
    const filter = new NetworkFilter({ policy });
    const result = filter.validateUrl("https://registry.npmjs.org/package");
    expect(result.allowed).toBe(true);
  });

  it("blocks non-allowed URL for worker", () => {
    const policy = createPolicy("worker", PROJECT);
    const filter = new NetworkFilter({ policy });
    const result = filter.validateUrl("https://evil.com/malware");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Network access denied");
  });

  it("allows any URL for full policy (researcher)", () => {
    const policy = createPolicy("researcher", PROJECT);
    const filter = new NetworkFilter({ policy });
    const result = filter.validateUrl("https://anything.example.com/api");
    expect(result.allowed).toBe(true);
  });

  it("blocks all URLs for none policy (optimizer)", () => {
    const policy = createPolicy("optimizer", PROJECT);
    const filter = new NetworkFilter({ policy });
    const result = filter.validateUrl("https://registry.npmjs.org/package");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Network access denied");
  });

  it("validates domain extraction from URL", () => {
    const policy = createPolicy("worker", PROJECT);
    const filter = new NetworkFilter({ policy });
    const result = filter.validateDomain("registry.npmjs.org");
    expect(result.allowed).toBe(true);
  });

  it("handles invalid URL gracefully", () => {
    const policy = createPolicy("worker", PROJECT);
    const filter = new NetworkFilter({ policy });
    const result = filter.validateUrl("not-a-valid-url");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Invalid URL");
  });
});
