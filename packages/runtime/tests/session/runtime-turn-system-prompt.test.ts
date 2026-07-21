import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  sha256ContentIdentity,
  type ContextAuditEntry,
  type TurnTemporalContext,
} from "@kilnai/core";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import {
  buildRuntimeTurnSystemPrompt,
  reconcileRuntimeInvocationPromptManifest,
} from "../../src/session/support/context/runtime-turn-system-prompt.js";

function audit(): ContextAuditEntry {
  return {
    governor: "DefaultContextGovernor",
    selectedBlockIds: ["standards"],
    deferredBlockIds: ["reference"],
    requiredBlockIds: [],
    preservedRequiredBlockIds: [],
    selectedTokens: 4,
    requiredTokens: 0,
    tokenBudget: 4,
    overflow: false,
    allocationMode: "whole-block",
    positionProfile: "balanced",
    requiredOverflowPolicy: "reject",
    blocks: [
      {
        id: "standards",
        kind: "instruction",
        source: "profile",
        required: false,
        estimatedTokens: 4,
        baseScore: 1,
        effectiveScore: 1,
        decision: "admitted",
        reason: "within-budget",
        order: 0,
      },
      {
        id: "reference",
        kind: "knowledge",
        source: "docs",
        required: false,
        estimatedTokens: 12,
        baseScore: 0,
        effectiveScore: 0,
        decision: "deferred",
        reason: "budget-cap",
        order: 1,
      },
    ],
  };
}

describe("runtime turn system prompt manifest", () => {
  it("preserves the provider prompt and separates base, governed, temporal, and deferred components", () => {
    const session = new RuntimeSession({
      appName: "app",
      tenantId: "tenant",
      userId: "user",
      systemPrompt: "Base prompt.",
    });
    const temporalContext: TurnTemporalContext = {
      observedAt: "2026-07-21T12:00:00.000Z",
      localDate: "2026-07-21",
      timeZone: "America/Hermosillo",
    };

    const manifest = buildRuntimeTurnSystemPrompt(
      session,
      { content: "Use repository evidence.", audit: audit() },
      temporalContext,
    );

    expect(manifest.finalPrompt).toContain(
      "Base prompt.\n\n--- Governed Context ---\nUse repository evidence." +
      "\n\n--- Turn Temporal Context ---\nObserved at (UTC): 2026-07-21T12:00:00.000Z" +
      "\nOperator-local date: 2026-07-21 (America/Hermosillo)",
    );
    expect(manifest.finalPrompt).toContain("Progressive Exact-Date Web Research");
    expect(manifest.components.map(({ id, scope }) => ({ id, scope }))).toEqual([
      { id: "runtime-base-prompt", scope: "static" },
      { id: "runtime-governed-context", scope: "dynamic" },
      { id: "runtime-turn-temporal-context", scope: "dynamic" },
      { id: "reference", scope: "deferred" },
    ]);
    expect(manifest.components.find((component) => component.id === "reference"))
      .not.toHaveProperty("content");
    for (const component of manifest.components) {
      if (component.scope !== "deferred") {
        expect(component.revision).toBe(sha256ContentIdentity(component.content));
      }
    }
    const deferred = manifest.components.find((component) => component.id === "reference");
    expect(deferred?.revision).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(deferred?.revision).not.toContain("reference");
    expect(deferred?.revision).not.toContain("docs");
  });

  it("adds a routing suffix component and hashes the exact routed prompt", () => {
    const session = new RuntimeSession({
      appName: "app",
      tenantId: "tenant",
      userId: "user",
      systemPrompt: "Base prompt.",
    });
    const initial = buildRuntimeTurnSystemPrompt(session, undefined);
    const routed = `${initial.finalPrompt}\n\n[KILN EXECUTION IDENTITY]\nprovider: mock`;

    const reconciled = reconcileRuntimeInvocationPromptManifest(initial, routed);

    expect(reconciled.finalPrompt).toBe(routed);
    expect(reconciled.finalPromptHash).toBe(
      `sha256:${createHash("sha256").update(routed).digest("hex")}`,
    );
    expect(reconciled.components.at(-1)).toMatchObject({
      id: "runtime-routing-suffix",
      scope: "dynamic",
      revision: sha256ContentIdentity(routed.slice(initial.finalPrompt.length)),
    });
  });

  it("fails safely to one exact content component when routing replaces the prompt", () => {
    const session = new RuntimeSession({
      appName: "app",
      tenantId: "tenant",
      userId: "user",
      systemPrompt: "Base prompt.",
    });
    const initial = buildRuntimeTurnSystemPrompt(session, { audit: audit() });

    const reconciled = reconcileRuntimeInvocationPromptManifest(initial, "Replacement prompt.");

    expect(reconciled.finalPrompt).toBe("Replacement prompt.");
    expect(reconciled.components.filter((component) => component.scope !== "deferred"))
      .toHaveLength(1);
    expect(reconciled.components.filter((component) => component.scope === "deferred"))
      .toHaveLength(1);
  });

  it("changes mutable component revision identities when content changes", () => {
    const first = new RuntimeSession({
      appName: "app",
      tenantId: "tenant",
      userId: "user",
      systemPrompt: "First base.",
    });
    const second = new RuntimeSession({
      appName: "app",
      tenantId: "tenant",
      userId: "user",
      systemPrompt: "Second base.",
    });

    const firstManifest = buildRuntimeTurnSystemPrompt(first, {
      content: "First governed content.",
      audit: audit(),
    });
    const secondManifest = buildRuntimeTurnSystemPrompt(second, {
      content: "Second governed content.",
      audit: audit(),
    });

    expect(firstManifest.components[0]?.revision).not.toBe(secondManifest.components[0]?.revision);
    expect(firstManifest.components[1]?.revision).not.toBe(secondManifest.components[1]?.revision);
  });
});
