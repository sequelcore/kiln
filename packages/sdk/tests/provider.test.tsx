import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { KilnProvider, useKilnContext } from "../src/provider.js";
import type { ReactNode } from "react";

function createWrapper(baseUrl: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <KilnProvider config={{ baseUrl }}>{children}</KilnProvider>;
  };
}

describe("KilnProvider", () => {
  it("provides config and client", () => {
    const { result } = renderHook(() => useKilnContext(), {
      wrapper: createWrapper("http://localhost:4000"),
    });

    expect(result.current.config.baseUrl).toBe("http://localhost:4000");
    expect(result.current.client).toBeDefined();
  });

  it("throws when used outside provider", () => {
    expect(() => {
      renderHook(() => useKilnContext());
    }).toThrow("useKilnContext must be used within a KilnProvider");
  });
});
