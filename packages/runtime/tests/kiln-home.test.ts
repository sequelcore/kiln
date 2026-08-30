import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "C:/Users/operator"),
}));

import { resolveRuntimeKilnHome, resolveRuntimeStoreRoot } from "../src/kiln-home.js";

const homedirMock = homedir as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.unstubAllEnvs();
  homedirMock.mockReset();
  homedirMock.mockReturnValue("C:/Users/operator");
});

describe("resolveRuntimeKilnHome", () => {
  it("returns a trimmed explicit home without normalizing it", () => {
    vi.stubEnv("XDG_CONFIG_HOME", "C:/ambient-xdg");

    expect(resolveRuntimeKilnHome("  C:/operator/../kiln-home  ")).toBe("C:/operator/../kiln-home");
    expect(homedirMock).not.toHaveBeenCalled();
  });

  it("uses the trimmed XDG config home before the host home", () => {
    vi.stubEnv("XDG_CONFIG_HOME", "  C:/xdg  ");

    expect(resolveRuntimeKilnHome()).toBe(join("C:/xdg", "kiln"));
    expect(homedirMock).not.toHaveBeenCalled();
  });

  it("uses the host home when XDG_CONFIG_HOME is blank", () => {
    vi.stubEnv("XDG_CONFIG_HOME", "  ");

    expect(resolveRuntimeKilnHome()).toBe(join("C:/Users/operator", ".kiln"));
  });

  it("keeps explicit store roots ahead of the resolved home", () => {
    vi.stubEnv("XDG_CONFIG_HOME", "C:/xdg");

    expect(resolveRuntimeStoreRoot({ rootDir: "  C:/exact-root  ", kilnHome: "C:/ignored" }, "auth"))
      .toBe("C:/exact-root");
    expect(resolveRuntimeStoreRoot({ kilnHome: "C:/operator-kiln" }, "auth"))
      .toBe(join("C:/operator-kiln", "auth"));
  });
});
