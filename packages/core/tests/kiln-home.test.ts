import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { resolveKilnHome, type KilnHomeResolutionInput } from "../src/kiln-home.js";

describe("resolveKilnHome", () => {
  const readUserHome = () => "C:/Users/operator";

  it.each(
    [
      {
        name: "prefers a trimmed explicit home without normalizing it",
        input: {
          explicitKilnHome: "  C:/operator/../kiln-home  ",
          xdgConfigHome: "C:/xdg",
          userHome: "C:/Users/operator",
        },
        expected: "C:/operator/../kiln-home",
      },
      {
        name: "uses a trimmed XDG config home when explicit is blank",
        input: {
          explicitKilnHome: "   ",
          xdgConfigHome: "  C:/xdg  ",
          userHome: "C:/Users/operator",
        },
        expected: join("C:/xdg", "kiln"),
      },
      {
        name: "falls back to the user home when explicit and XDG are blank",
        input: {
          explicitKilnHome: "\t",
          xdgConfigHome: "  ",
          userHome: "C:/Users/operator",
        },
        expected: join("C:/Users/operator", ".kiln"),
      },
    ] satisfies ReadonlyArray<{
      readonly name: string;
      readonly input: KilnHomeResolutionInput;
      readonly expected: string;
    }>,
  )(
    "resolves $name",
    ({ input, expected }) => {
      expect(resolveKilnHome(input)).toBe(expected);
    },
  );

  it.each(
    [
      {
        name: "explicit home",
        input: { explicitKilnHome: " C:/explicit ", xdgConfigHome: "C:/xdg" },
        expected: "C:/explicit",
        reads: 0,
      },
      {
        name: "XDG config home",
        input: { explicitKilnHome: " ", xdgConfigHome: " C:/xdg " },
        expected: join("C:/xdg", "kiln"),
        reads: 0,
      },
      {
        name: "user-home fallback",
        input: { explicitKilnHome: " ", xdgConfigHome: " " },
        expected: join("C:/Users/operator", ".kiln"),
        reads: 1,
      },
    ] satisfies ReadonlyArray<{
      readonly name: string;
      readonly input: Omit<KilnHomeResolutionInput, "readUserHome" | "userHome">;
      readonly expected: string;
      readonly reads: number;
    }>,
  )(
    "reads the fallback home $name only when selected",
    ({ input, expected, reads }) => {
      const reader = vi.fn(readUserHome);

      expect(resolveKilnHome({ ...input, readUserHome: reader })).toBe(expected);
      expect(reader).toHaveBeenCalledTimes(reads);
    },
  );
});
