import { describe, expect, it } from "vitest";
import { getGuiProviderMetadata, isGuiProviderModeless } from "../src/index.js";

describe("getGuiProviderMetadata", () => {
  it("returns undefined for unknown provider ids instead of synthesizing fallback metadata", () => {
    expect(getGuiProviderMetadata("unknown-provider")).toBeUndefined();
  });

  it("keeps model-less provider policy in shared provider metadata", () => {
    expect(isGuiProviderModeless("claude")).toBe(true);
    expect(isGuiProviderModeless("codex")).toBe(false);
    expect(isGuiProviderModeless("unknown-provider")).toBe(false);
  });

  it("exposes interactive auth only for providers that consume Kiln-managed credentials", () => {
    expect(getGuiProviderMetadata("codex")?.authMethod).toBeUndefined();
    expect(getGuiProviderMetadata("opencode")?.authMethod).toBeUndefined();
    expect(getGuiProviderMetadata("codex-oauth")?.authMethod).toBe("device_code");
    expect(getGuiProviderMetadata("opencode-go")?.authMethod).toBe("api_key");
    expect(getGuiProviderMetadata("opencode-zen")?.authMethod).toBe("api_key");
  });

  it("separates provider brand identity from route access", () => {
    expect(getGuiProviderMetadata("codex")).toMatchObject({ brandId: "codex", access: "harness" });
    expect(getGuiProviderMetadata("codex-oauth")).toMatchObject({ brandId: "codex", access: "subscription" });
    expect(getGuiProviderMetadata("opencode-go")).toMatchObject({ brandId: "opencode", access: "subscription" });
    expect(getGuiProviderMetadata("opencode-zen")).toMatchObject({ brandId: "opencode", access: "api" });
    expect(getGuiProviderMetadata("openai")).toMatchObject({ brandId: "openai", access: "api" });
    expect(getGuiProviderMetadata("ollama")).toMatchObject({ brandId: "ollama", access: "local" });
    expect(getGuiProviderMetadata("lmstudio")).toMatchObject({ brandId: "lmstudio", access: "local" });
  });
});
