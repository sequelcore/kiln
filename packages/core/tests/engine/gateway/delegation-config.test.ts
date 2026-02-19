import { describe, it, expect } from "vitest";
import type { AppDelegation, DelegationValidationError } from "../../../src/engine/gateway/delegation-config.js";
import { validateDelegation, isDelegationCapability } from "../../../src/engine/gateway/delegation-config.js";
import type { Capability } from "../../../src/engine/domain/capability.js";
import { parseAppYaml, AppLoaderError } from "../../../src/engine/loader/app-loader.js";

function makeDelegation(overrides: Partial<AppDelegation> = {}): AppDelegation {
  return {
    fromApp: "temper",
    toApp: "arete-ai",
    task: "Analyze user workout data and return recommendations",
    schema: { type: "object", properties: { recommendations: { type: "array" } } },
    ...overrides,
  };
}

function makeDelegationCapability(overrides: Partial<Capability> = {}): Capability {
  return {
    name: "delegate_to_arete",
    description: "Delegate workout analysis to arete-ai",
    schema: {},
    tags: ["delegation"],
    type: "delegation",
    targetApp: "arete-ai",
    task: "Analyze workout data",
    ...overrides,
  };
}

describe("validateDelegation", () => {
  it("returns empty array for a valid delegation with all required fields", () => {
    expect(validateDelegation(makeDelegation())).toEqual([]);
  });

  it("accepts delegation without optional fields (no context, no priority, no timeout)", () => {
    const delegation = makeDelegation();
    expect(validateDelegation(delegation)).toEqual([]);
    expect(delegation.context).toBeUndefined();
    expect(delegation.priority).toBeUndefined();
    expect(delegation.timeout).toBeUndefined();
  });

  it("reports error for empty fromApp", () => {
    const errors = validateDelegation(makeDelegation({ fromApp: "" }));
    expect(errors.some((e: DelegationValidationError) => e.field === "fromApp")).toBe(true);
  });

  it("reports error for empty toApp", () => {
    const errors = validateDelegation(makeDelegation({ toApp: "" }));
    expect(errors.some((e: DelegationValidationError) => e.field === "toApp")).toBe(true);
  });

  it("reports error for self-delegation (fromApp === toApp)", () => {
    const errors = validateDelegation(makeDelegation({ fromApp: "temper", toApp: "temper" }));
    expect(errors.some((e: DelegationValidationError) => e.field === "toApp" && e.message.includes("self-delegation"))).toBe(true);
  });

  it("reports error for empty task", () => {
    const errors = validateDelegation(makeDelegation({ task: "" }));
    expect(errors.some((e: DelegationValidationError) => e.field === "task")).toBe(true);
  });

  it("reports error for null schema", () => {
    const errors = validateDelegation(makeDelegation({ schema: null as unknown as Record<string, unknown> }));
    expect(errors.some((e: DelegationValidationError) => e.field === "schema")).toBe(true);
  });

  it("reports error for array schema (not object)", () => {
    const errors = validateDelegation(makeDelegation({ schema: [] as unknown as Record<string, unknown> }));
    expect(errors.some((e: DelegationValidationError) => e.field === "schema")).toBe(true);
  });

  it("reports error for negative timeout", () => {
    const errors = validateDelegation(makeDelegation({ timeout: -1 }));
    expect(errors.some((e: DelegationValidationError) => e.field === "timeout")).toBe(true);
  });

  it("reports error for timeout = 0", () => {
    const errors = validateDelegation(makeDelegation({ timeout: 0 }));
    expect(errors.some((e: DelegationValidationError) => e.field === "timeout")).toBe(true);
  });

  it("reports error for priority < 0", () => {
    const errors = validateDelegation(makeDelegation({ priority: -1 }));
    expect(errors.some((e: DelegationValidationError) => e.field === "priority")).toBe(true);
  });

  it("reports error for priority > 10", () => {
    const errors = validateDelegation(makeDelegation({ priority: 11 }));
    expect(errors.some((e: DelegationValidationError) => e.field === "priority")).toBe(true);
  });

  it("accumulates multiple errors", () => {
    const errors = validateDelegation(makeDelegation({ fromApp: "", toApp: "", task: "" }));
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it("accepts valid optional fields (context, priority, timeout)", () => {
    const errors = validateDelegation(makeDelegation({ context: "user session", priority: 7, timeout: 60_000 }));
    expect(errors).toEqual([]);
  });
});

describe("isDelegationCapability", () => {
  it("returns true for a valid delegation capability", () => {
    expect(isDelegationCapability(makeDelegationCapability())).toBe(true);
  });

  it("returns false for a regular capability (no type field)", () => {
    const cap: Capability = {
      name: "code_edit",
      description: "Edit code files",
      schema: {},
      tags: ["coding"],
    };
    expect(isDelegationCapability(cap)).toBe(false);
  });

  it("returns false when type is 'delegation' but targetApp is missing", () => {
    expect(isDelegationCapability(makeDelegationCapability({ targetApp: undefined }))).toBe(false);
  });

  it("returns false when type is 'delegation' but targetApp is empty string", () => {
    expect(isDelegationCapability(makeDelegationCapability({ targetApp: "" }))).toBe(false);
  });

  it("returns false when type is 'delegation' but task is missing", () => {
    expect(isDelegationCapability(makeDelegationCapability({ task: undefined }))).toBe(false);
  });

  it("returns false when type is 'delegation' but task is empty string", () => {
    expect(isDelegationCapability(makeDelegationCapability({ task: "" }))).toBe(false);
  });

  it("returns false when type is a different string", () => {
    expect(isDelegationCapability(makeDelegationCapability({ type: "tool" }))).toBe(false);
  });
});

describe("parseAppYaml -- delegation capabilities", () => {
  const DELEGATION_APP_YAML = `
name: temper
channels: [cli]

memory:
  scopes: [user]
  backend: sqlite+fts5

router:
  fallback: main

teams:
  main:
    agents:
      worker:
        tier: coding
        tools: [delegate_to_arete]
    workflow:
      phases: [analyze, implement]
      gates: {}
    capabilities:
      - name: delegate_to_arete
        description: Delegate workout analysis to arete-ai
        tags: [delegation]
        type: delegation
        targetApp: arete-ai
        task: Analyze workout data and return personalized recommendations
        timeout: 30
`;

  it("parses a delegation capability with type, targetApp, task, timeout", () => {
    const app = parseAppYaml(DELEGATION_APP_YAML);
    const cap = app.teams["main"]!.capabilities[0]!;
    expect(cap.type).toBe("delegation");
    expect(cap.targetApp).toBe("arete-ai");
    expect(cap.task).toBe("Analyze workout data and return personalized recommendations");
    expect(cap.timeout).toBe(30);
  });

  it("throws AppLoaderError when delegation capability is missing targetApp", () => {
    const yaml = DELEGATION_APP_YAML.replace("        targetApp: arete-ai\n", "");
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError when delegation capability is missing task", () => {
    const yaml = DELEGATION_APP_YAML.replace(
      "        task: Analyze workout data and return personalized recommendations\n",
      "",
    );
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });
});
