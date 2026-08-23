import { describe, it, expect } from "vitest";
import { parseAppYaml, AppLoaderError } from "../../../src/engine/loader/app-loader.js";

function makeYaml(safetyBlock: string): string {
  return `
name: test-app
teams:
  support:
    agents:
      helper:
        name: Helper
        role: Support agent
        goal: Help users
        tier: fast
router:
  fallback: support
${safetyBlock}
`;
}

describe("parseAppYaml - safety block", () => {
  it("parses valid safety block with pii config", () => {
    const yaml = makeYaml(`
safety:
  pii:
    detect: [email, phone]
    action: redact
`);
    const app = parseAppYaml(yaml);

    expect(app.safety).toBeDefined();
    expect(app.safety!.pii).toBeDefined();
    expect(app.safety!.pii!.detect).toContain("email");
    expect(app.safety!.pii!.detect).toContain("phone");
    expect(app.safety!.pii!.action).toBe("redact");
  });

  it("parses valid safety block with content config", () => {
    const yaml = makeYaml(`
safety:
  content:
    enabled: true
    categories:
      hate:
        threshold: 0.7
        action: block
      violence:
        threshold: 0.8
        action: warn
`);
    const app = parseAppYaml(yaml);

    expect(app.safety).toBeDefined();
    expect(app.safety!.content).toBeDefined();
    expect(app.safety!.content!.enabled).toBe(true);
    expect(app.safety!.content!.categories.hate).toEqual({ threshold: 0.7, action: "block" });
    expect(app.safety!.content!.categories.violence).toEqual({ threshold: 0.8, action: "warn" });
  });

  it("parses valid safety block with rails (all 4 types)", () => {
    const yaml = makeYaml(`
safety:
  rails:
    - type: topic
      block: [politics, religion]
      escalate: [urgent]
    - type: competitor
      competitors: [acme, widgets-inc]
      response: We don't discuss competitors.
    - type: escalation
      triggers: [emergency, critical]
    - type: compliance
      required: [disclaimer]
      forbid: [guarantee]
`);
    const app = parseAppYaml(yaml);

    expect(app.safety).toBeDefined();
    const rails = app.safety!.rails!;
    expect(rails).toHaveLength(4);

    const topic = rails.find((r) => r.type === "topic");
    expect(topic).toBeDefined();
    expect((topic as { type: "topic"; block?: string[] }).block).toContain("politics");

    const competitor = rails.find((r) => r.type === "competitor");
    if (competitor?.type !== "competitor") throw new Error("expected competitor rail");
    expect(competitor.competitors).toContain("acme");

    const escalation = rails.find((r) => r.type === "escalation");
    expect(escalation).toBeDefined();
    expect((escalation as { type: "escalation"; triggers: string[] }).triggers).toContain("emergency");

    const compliance = rails.find((r) => r.type === "compliance");
    expect(compliance).toBeDefined();
    expect((compliance as { type: "compliance"; required?: string[] }).required).toContain("disclaimer");
  });

  it("safety block is optional: no safety key -> app.safety is undefined", () => {
    const yaml = makeYaml(""); // no safety block
    const app = parseAppYaml(yaml);

    expect(app.safety).toBeUndefined();
  });

  it("invalid PII config (missing detect array) produces AppLoaderError", () => {
    const yaml = makeYaml(`
safety:
  pii:
    detect: []
    action: block
`);
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("invalid rail type produces AppLoaderError", () => {
    const yaml = makeYaml(`
safety:
  rails:
    - type: unknown_rail_type
      block: [something]
`);
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("parses safety with all sections combined", () => {
    const yaml = makeYaml(`
safety:
  pii:
    detect: [email, ssn, credit_card]
    action: block
    allowlist: [no-reply@example.com]
  content:
    enabled: true
    categories:
      hate:
        threshold: 0.5
        action: block
      sexual:
        threshold: 0.8
        action: block
  rails:
    - type: topic
      block: [competitor-a]
    - type: escalation
      triggers: [refund, legal]
`);
    const app = parseAppYaml(yaml);

    expect(app.safety).toBeDefined();
    expect(app.safety!.pii).toBeDefined();
    expect(app.safety!.pii!.detect).toHaveLength(3);
    expect(app.safety!.pii!.allowlist).toContain("no-reply@example.com");
    expect(app.safety!.content).toBeDefined();
    expect(app.safety!.content!.categories.hate).toBeDefined();
    expect(app.safety!.rails).toHaveLength(2);
  });
});
