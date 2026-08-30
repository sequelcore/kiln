import { describe, expect, it } from "vitest";
import {
  createSkillPortabilityMetadata,
  readSkillPortability,
} from "../../src/skill/index.js";

describe("skill portability", () => {
  it("round-trips a declared disconnected execution contract", () => {
    const metadata = createSkillPortabilityMetadata({
      harnessPortability: "agnostic",
      disconnectedExecution: "capability-dependent",
      requiredCapabilities: ["managed-delegation", "workspace-read"],
    });

    expect(readSkillPortability({ metadata })).toEqual({
      status: "declared",
      harnessPortability: "agnostic",
      disconnectedExecution: "capability-dependent",
      requiredCapabilities: ["managed-delegation", "workspace-read"],
    });
  });

  it("keeps absent or partial metadata explicitly unknown", () => {
    expect(readSkillPortability({ metadata: {} })).toMatchObject({ status: "unknown" });
    expect(readSkillPortability({
      metadata: { "kiln.harnessPortability": "agnostic" },
    })).toMatchObject({ status: "unknown" });
  });

  it("rejects invalid capability identities when creating canonical metadata", () => {
    expect(() => createSkillPortabilityMetadata({
      harnessPortability: "agnostic",
      disconnectedExecution: "supported",
      requiredCapabilities: ["Kiln MCP"],
    })).toThrow("capability identity");
  });
});
