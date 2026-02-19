import { describe, it, expect, vi } from "vitest";
import type { ProviderAdapter } from "../../src/agents/index.js";
import { ProviderRegistry } from "../../src/agents/provider-registry.js";

function makeMockAdapter(name: string): ProviderAdapter {
  return {
    name,
    createMessage: vi.fn(),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

describe("ProviderRegistry", () => {
  it("register and get adapter", () => {
    const registry = new ProviderRegistry();
    const adapter = makeMockAdapter("mock-a");

    registry.register("mock-a", adapter);

    expect(registry.get("mock-a")).toBe(adapter);
  });

  it("get returns undefined for unregistered provider", () => {
    const registry = new ProviderRegistry();

    expect(registry.get("unknown")).toBeUndefined();
  });

  it("setRoleProvider assigns provider to role", () => {
    const registry = new ProviderRegistry();
    const adapter = makeMockAdapter("mock-a");

    registry.register("mock-a", adapter);
    registry.setRoleProvider("architect", "mock-a");

    expect(registry.getForRole("architect")).toBe(adapter);
  });

  it("getForRole returns role-specific provider", () => {
    const registry = new ProviderRegistry();
    const adapterA = makeMockAdapter("mock-a");
    const adapterB = makeMockAdapter("mock-b");

    registry.register("mock-a", adapterA);
    registry.register("mock-b", adapterB);
    registry.setRoleProvider("architect", "mock-a");
    registry.setRoleProvider("worker", "mock-b");

    expect(registry.getForRole("architect")).toBe(adapterA);
    expect(registry.getForRole("worker")).toBe(adapterB);
  });

  it("getForRole falls back to default", () => {
    const registry = new ProviderRegistry();
    const adapterA = makeMockAdapter("mock-a");
    const adapterB = makeMockAdapter("mock-b");

    registry.register("mock-a", adapterA);
    registry.register("mock-b", adapterB);
    registry.defaultProvider("mock-b");

    expect(registry.getForRole("optimizer")).toBe(adapterB);
  });

  it("getForRole falls back to first registered", () => {
    const registry = new ProviderRegistry();
    const adapterA = makeMockAdapter("mock-a");

    registry.register("mock-a", adapterA);

    expect(registry.getForRole("worker")).toBe(adapterA);
  });

  it("getForRole throws when nothing available", () => {
    const registry = new ProviderRegistry();

    expect(() => registry.getForRole("architect")).toThrow(
      "No provider available for role: architect",
    );
  });

  it("setRoleProvider throws for unregistered provider", () => {
    const registry = new ProviderRegistry();

    expect(() => registry.setRoleProvider("worker", "ghost")).toThrow(
      "Provider not registered: ghost",
    );
  });

  it("defaultProvider throws for unregistered provider", () => {
    const registry = new ProviderRegistry();

    expect(() => registry.defaultProvider("ghost")).toThrow(
      "Provider not registered: ghost",
    );
  });

  it("defaultProvider sets fallback", () => {
    const registry = new ProviderRegistry();
    const adapter = makeMockAdapter("mock-a");

    registry.register("mock-a", adapter);
    registry.defaultProvider("mock-a");

    // Asking for any role without a mapping falls back to default
    expect(registry.getForRole("architect")).toBe(adapter);
    expect(registry.getForRole("worker")).toBe(adapter);
    expect(registry.getForRole("optimizer")).toBe(adapter);
  });

  it("all() returns copy of registered adapters", () => {
    const registry = new ProviderRegistry();
    const adapterA = makeMockAdapter("mock-a");
    const adapterB = makeMockAdapter("mock-b");

    registry.register("mock-a", adapterA);
    registry.register("mock-b", adapterB);

    const all = registry.all();
    expect(all.size).toBe(2);
    expect(all.get("mock-a")).toBe(adapterA);
    expect(all.get("mock-b")).toBe(adapterB);
  });

  it("roles() returns copy of role mappings", () => {
    const registry = new ProviderRegistry();
    const adapter = makeMockAdapter("mock-a");

    registry.register("mock-a", adapter);
    registry.setRoleProvider("architect", "mock-a");

    const roles = registry.roles();
    expect(roles.size).toBe(1);
    expect(roles.get("architect")).toBe("mock-a");
  });
});
