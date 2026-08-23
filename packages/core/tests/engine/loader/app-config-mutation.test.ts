import { describe, expect, it } from "vitest";
import {
  addAppScheduleTrigger,
  removeAppScheduleTrigger,
} from "../../../src/engine/loader/app-config-mutation.js";
import { parseAppYaml } from "../../../src/engine/loader/app-loader.js";

const BASE = `# operator-owned app comment
name: app
router:
  fallback: primary
teams:
  primary:
    agents:
      worker: { name: Worker, role: Helper, goal: Help, tier: fast, tools: [] }
    capabilities: []
triggers:
  # keep this trigger comment
  - name: existing
    type: schedule
    team: primary
    cron: "0 1 * * *"
`;

describe("app configuration mutation", () => {
  it("adds a schedule through an AST mutation and preserves unrelated presentation", () => {
    const result = addAppScheduleTrigger(BASE, {
      name: "nightly",
      cron: "0 2 * * *",
      task: "Run checks",
      timezone: "UTC",
    }, "fixtures/app.yaml");
    expect(result.changed).toBe(true);
    expect(result.bytes).toContain("# operator-owned app comment");
    expect(result.bytes).toContain("router:");
    expect(result.bytes).toContain("# keep this trigger comment");
    expect(parseAppYaml(result.bytes).triggers?.map((trigger) => trigger.name)).toEqual(["existing", "nightly"]);
    expect(parseAppYaml(result.bytes).triggers?.[1]?.team).toBe("primary");
  });

  it("reports duplicate and missing names without changing bytes", () => {
    expect(addAppScheduleTrigger(BASE, {
      name: "existing",
      cron: "0 2 * * *",
      task: "Run checks",
      timezone: "UTC",
    }).changed).toBe(false);
    expect(removeAppScheduleTrigger(BASE, "missing").changed).toBe(false);
  });

  it("removes only the selected schedule and preserves the document comment", () => {
    const result = removeAppScheduleTrigger(BASE, "existing", "fixtures/app.yaml");
    expect(result.changed).toBe(true);
    expect(result.bytes).toContain("# operator-owned app comment");
    expect(parseAppYaml(result.bytes).triggers).toBeUndefined();
  });
});
