import { describe, expect, it } from "vitest";
import { admittedCommunicationEvidence, configuredCommunicationCandidates, resolveConfiguredCommunication } from "./communication-policy.js";

describe("resolveConfiguredCommunication", () => {
  it("derives high-precedence candidates only from admitted production evidence", () => {
    const evidence = admittedCommunicationEvidence({
      outputSchema: "{\"type\":\"object\"}",
      projectedBlocks: [
        { source: "runtime-skill:C:/skills/review/SKILL.md", content: "Skill\nname: code-review-findings\ninstructions:\nReview." },
        { source: "project-context", content: "not a skill" },
      ],
      requestedAuthority: "destructive",
    });
    const resolution = resolveConfiguredCommunication(evidence);

    expect(evidence).toEqual({
      artifactContract: { artifactContract: { id: "structured-output-schema", revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) } },
      responseSkill: { responseSkills: [{ id: "code-review-findings", revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) }] },
      safetyAuthority: { requiredContent: ["approval-requirement"] },
    });
    expect(resolution.authority).toMatchObject({
      artifactContract: "artifact-contract",
      responseSkills: ["response-skill"],
      requiredContent: { "approval-requirement": ["safety-authority"] },
    });
  });

  it("retains configured source labels for Runtime surface composition", () => {
    expect(configuredCommunicationCandidates({
      global: { responseDetail: "standard" },
      project: { locale: "es-MX" },
    })).toEqual([
      { source: "project", intent: { locale: "es-MX" } },
      { source: "global", intent: { responseDetail: "standard" } },
    ]);
  });

  it("does not promote caller references without artifact or skill admission evidence", () => {
    const resolution = resolveConfiguredCommunication({
      invocation: {
        artifactContract: { id: "self-asserted", revision: "v1" },
        responseSkills: [{ id: "self-asserted", revision: "v1" }],
      },
    });
    expect(resolution.authority.artifactContract).toBe("invocation");
    expect(resolution.authority.responseSkills).toEqual(["invocation"]);
  });

  it("composes global, project, agent, invocation, artifact, and user intent with canonical precedence", () => {
    const resolution = resolveConfiguredCommunication({
      global: { responseDetail: "standard", requiredContent: ["warning"] },
      project: { responseDetail: "detailed", locale: "en-US" },
      agent: { interactionProfile: { id: "findings-first", revision: "v1", behaviors: ["findings-first"] } },
      invocation: { responseDetail: "concise", requiredContent: ["verification"] },
      artifactContract: { artifactContract: { id: "pull-request", revision: "v1" }, requiredContent: ["residual-risk"] },
      user: { responseDetail: "detailed", locale: "es-MX" },
      safetyAuthority: { requiredContent: ["approval-requirement"] },
    });

    expect(resolution.intent).toMatchObject({
      responseDetail: "detailed",
      locale: "es-MX",
      interactionProfile: { id: "findings-first" },
      artifactContract: { id: "pull-request" },
      requiredContent: ["approval-requirement", "residual-risk", "verification", "warning"],
    });
    expect(resolution.authority.responseDetail).toBe("user");
    expect(resolution.authority.locale).toBe("user");
  });

  it("returns provider-default without inventing a communication style", () => {
    expect(resolveConfiguredCommunication({}).intent).toEqual({
      responseDetail: "provider-default",
      requiredContent: [],
      responseSkills: [],
      onUnsupported: "deny",
    });
  });
});
