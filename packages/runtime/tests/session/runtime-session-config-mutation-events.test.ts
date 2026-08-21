import { describe, expect, it } from "vitest";
import { textParts } from "@kilnai/core/engine";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { appendCanonicalTurnEvents } from "../../src/session/runtime-session-event-ledger.js";

describe("runtime config mutation session events", () => {
  it("projects config proposal and apply tool results into canonical events", () => {
    const session = new RuntimeSession({
      appName: "kiln",
      tenantId: "test-tenant",
      userId: "operator",
      systemPrompt: "test",
    });
    session.addUserMessage(textParts("Add a skill"));

    const startedAt = new Date("2026-05-07T12:00:00.000Z");
    const proposedAt = new Date("2026-05-07T12:00:01.000Z");
    const appliedAt = new Date("2026-05-07T12:00:02.000Z");
    const events = appendCanonicalTurnEvents({
      session,
      channel: "cli",
      userMessageContent: "Add a skill",
      assistantMessageContent: "Config mutation complete.",
      turnOutcome: "completed",
      queued: false,
      turnStartedAt: startedAt,
      turnCompletedAt: appliedAt,
      continuity: { strategy: "new-session" },
      runtimeEvents: [
        {
          type: "tool_result",
          toolCallScopeId: "turn-1:response:1",
          toolCallId: "tool-config-propose",
          sessionId: session.id,
          timestamp: proposedAt,
          toolName: "kiln_config.propose_change",
          durationMs: 15,
          success: true,
          output: JSON.stringify({
            proposalId: "cfg_skill",
            operation: "skill.upsert",
            status: "valid",
            affectedCanonicalPaths: ["C:/repo/.kiln/skills/repo-review/SKILL.md"],
            authorityImpact: "none",
          }),
        },
        {
          type: "tool_result",
          toolCallScopeId: "turn-1:response:1",
          toolCallId: "tool-config-apply",
          sessionId: session.id,
          timestamp: appliedAt,
          toolName: "kiln_config.apply_change",
          durationMs: 20,
          success: true,
          output: JSON.stringify({
            settlement: {
              proposalId: "cfg_skill",
              approvalId: "cfgap_skill",
              scope: "project",
              operation: "skill.upsert",
              outcome: "committed",
              appliedWrites: [
                {
                  path: "C:/repo/.kiln/skills/repo-review/SKILL.md",
                  previousHash: null,
                  nextHash: "sha256-next",
                },
              ],
              reconciliationEffects: [
                {
                  target: "native-skills",
                  status: "ok",
                  summary: "1 native skill projections synced",
                  errors: [],
                },
              ],
              diagnostics: [],
            },
            replayed: false,
          }),
        },
      ],
    });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "config_change_proposed",
        proposalId: "cfg_skill",
        operation: "skill.upsert",
        status: "valid",
        affectedCanonicalPaths: ["C:/repo/.kiln/skills/repo-review/SKILL.md"],
        authorityImpact: "none",
      }),
      expect.objectContaining({
        kind: "config_change_applied",
        proposalId: "cfg_skill",
        approvalId: "cfgap_skill",
        appliedWrites: ["C:/repo/.kiln/skills/repo-review/SKILL.md"],
        projectionEffects: ["native-skills:ok"],
        outcome: "committed",
        reconciliationErrors: [],
      }),
    ]));
  });

  it("projects a committed change whose reconciliation failed as applied, never as failed", () => {
    const session = new RuntimeSession({
      appName: "kiln",
      tenantId: "test-tenant",
      userId: "operator",
      systemPrompt: "test",
    });
    session.addUserMessage(textParts("Apply config"));

    const timestamp = new Date("2026-05-07T12:00:00.000Z");
    const events = appendCanonicalTurnEvents({
      session,
      channel: "cli",
      userMessageContent: "Apply config",
      assistantMessageContent: "Config mutation committed with failed reconciliation.",
      turnOutcome: "completed",
      queued: false,
      turnStartedAt: timestamp,
      turnCompletedAt: timestamp,
      continuity: { strategy: "new-session" },
      runtimeEvents: [
        {
          type: "tool_result",
          toolCallScopeId: "turn-1:response:1",
          toolCallId: "tool-config-apply",
          sessionId: session.id,
          timestamp,
          toolName: "kiln_config.apply_change",
          durationMs: 20,
          success: true,
          output: JSON.stringify({
            settlement: {
              proposalId: "cfg_skill",
              approvalId: "cfgap_skill",
              scope: "project",
              operation: "skill.upsert",
              outcome: "committed-reconciliation-failed",
              appliedWrites: [
                {
                  path: "C:/repo/.kiln/skills/repo-review/SKILL.md",
                  previousHash: null,
                  nextHash: "sha256-next",
                },
              ],
              reconciliationEffects: [
                {
                  target: "native-skills",
                  status: "failed",
                  summary: "0 native skill projections synced",
                  errors: ["harness unavailable"],
                },
              ],
              diagnostics: [
                { severity: "warning", field: "native-skills", message: "harness unavailable" },
              ],
            },
            replayed: false,
          }),
        },
      ],
    });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "config_change_applied",
        proposalId: "cfg_skill",
        projectionEffects: ["native-skills:failed"],
        outcome: "committed-reconciliation-failed",
        reconciliationErrors: ["harness unavailable"],
      }),
    ]));
    expect(events.some((event) => event.kind === "config_change_failed")).toBe(false);
  });

  it("projects failed config apply results into canonical failure events", () => {
    const session = new RuntimeSession({
      appName: "kiln",
      tenantId: "test-tenant",
      userId: "operator",
      systemPrompt: "test",
    });
    session.addUserMessage(textParts("Apply config"));

    const timestamp = new Date("2026-05-07T12:00:00.000Z");
    const events = appendCanonicalTurnEvents({
      session,
      channel: "cli",
      userMessageContent: "Apply config",
      assistantMessageContent: "Config mutation failed.",
      turnOutcome: "completed",
      queued: false,
      turnStartedAt: timestamp,
      turnCompletedAt: timestamp,
      continuity: { strategy: "new-session" },
      runtimeEvents: [
        {
          type: "tool_result",
          toolCallScopeId: "turn-1:response:1",
          toolCallId: "tool-config-apply-failed",
          sessionId: session.id,
          timestamp,
          toolName: "kiln_config.apply_change",
          durationMs: 20,
          success: false,
          output: JSON.stringify({
            settlement: {
              proposalId: "cfg_skill",
              approvalId: "cfgap_skill",
              scope: "project",
              operation: "skill.upsert",
              outcome: "rejected",
              appliedWrites: [],
              reconciliationEffects: [],
              diagnostics: [
                {
                  severity: "error",
                  field: "approvalId",
                  message: "Config approval does not match the stored proposal.",
                },
              ],
            },
            replayed: false,
          }),
        },
      ],
    });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "config_change_failed",
        proposalId: "cfg_skill",
        approvalId: "cfgap_skill",
        errorMessage: "Config approval does not match the stored proposal.",
      }),
    ]));
  });
});
