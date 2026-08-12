import { describe, expect, it } from "vitest";
import { KILN_FIRST_PARTY_AGENT_DEFAULTS } from "./first-party-agent-defaults.js";

describe("first-party agent defaults", () => {
  it("keeps repository scouting and external research procedures separate", () => {
    const scout = KILN_FIRST_PARTY_AGENT_DEFAULTS.find((agent) => agent.name === "scout");
    const researcher = KILN_FIRST_PARTY_AGENT_DEFAULTS.find((agent) => agent.name === "researcher");

    expect(scout?.skills).toEqual(["codebase-scouting"]);
    expect(scout?.taskAffinity).not.toContain("research");
    expect(researcher?.skills).toEqual(["research-workflow"]);
    expect(researcher?.taskAffinity).toEqual(["research"]);
  });
});
