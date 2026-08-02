import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("GUI root startup graph", () => {
  it("keeps router devtools out of the initial dev module graph", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../src/routes/__root.tsx"), "utf8");

    expect(source).not.toContain('from "@tanstack/react-router-devtools"');
    expect(source).toContain('import("@tanstack/react-router-devtools")');
  });
});
