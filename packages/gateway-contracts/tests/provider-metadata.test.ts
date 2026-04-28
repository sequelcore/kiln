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
});
