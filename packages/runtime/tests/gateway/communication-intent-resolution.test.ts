import { describe, expect, it } from "vitest";
import { resolveOperatorCommunicationIntent } from "../../src/gateway/communication-intent-resolution.js";

describe("resolveOperatorCommunicationIntent", () => {
  it("preserves global and project provenance while giving user scalars precedence", () => {
    const resolution = resolveOperatorCommunicationIntent([
      {
        source: "global",
        intent: { responseDetail: "standard", requiredContent: ["verification"] },
      },
      {
        source: "project",
        intent: { locale: "es-MX", requiredContent: ["residual-risk"] },
      },
    ], {
      responseDetail: "detailed",
      requiredContent: ["finding"],
    });

    expect(resolution).toMatchObject({
      intent: {
        responseDetail: "detailed",
        locale: "es-MX",
        requiredContent: ["finding", "residual-risk", "verification"],
      },
      authority: {
        responseDetail: "user",
        locale: "project",
        requiredContent: {
          finding: ["user"],
          "residual-risk": ["project"],
          verification: ["global"],
        },
      },
    });
  });

  it("returns undefined when neither configured nor user intent exists", () => {
    expect(resolveOperatorCommunicationIntent(undefined, undefined)).toBeUndefined();
  });
});
