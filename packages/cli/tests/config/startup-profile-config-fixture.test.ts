import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { defaultGlobalConfig, validateGlobalConfig } from "../../src/config/global-config.js";

const FIXTURE_PATH = resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "scripts",
  "fixtures",
  "startup-profile-global-config.yaml",
);

function readFixture(): Record<string, unknown> {
  return parse(readFileSync(FIXTURE_PATH, "utf8")) as Record<string, unknown>;
}

/**
 * The GUI startup profile measures a configured operator environment, so it runs
 * against a committed fixture rather than whatever the host has. These cases keep
 * that fixture honest: a schema change or a change to the canonical defaults must
 * fail here, not silently degrade the benchmark.
 */
describe("startup profile global configuration fixture", () => {
  it("satisfies the canonical global configuration contract", () => {
    expect(() => validateGlobalConfig(readFixture())).not.toThrow();
  });

  it("differs from the canonical defaults only by the execution target it must name", () => {
    const { targetCatalog, targetRouting, ...rest } = readFixture();

    expect(targetCatalog, "the fixture exists to supply a direct target").toBeDefined();
    expect(targetRouting).toBeDefined();
    expect(rest).toEqual(defaultGlobalConfig());
  });

  it("routes to a direct target that the catalog actually declares", () => {
    const fixture = readFixture() as {
      targetCatalog: { targets: readonly { id: string; kind: string }[] };
      targetRouting: { defaultTargetId: string };
    };

    expect(fixture.targetCatalog.targets).toContainEqual(
      expect.objectContaining({ id: fixture.targetRouting.defaultTargetId, kind: "direct" }),
    );
  });
});
