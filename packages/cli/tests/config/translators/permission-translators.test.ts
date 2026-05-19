import { describe, expect, it } from "vitest";
import {
  translateClaudePermissionProjection,
} from "../../../src/config/translators/claude-translator.js";
import {
  translateCodexPermissionProjection,
} from "../../../src/config/translators/codex-translator.js";
import {
  translateOpenCodePermissionProjection,
} from "../../../src/config/translators/opencode-translator.js";
import type { KilnPermissionPolicy } from "../../../src/wrapper/session.js";

const granularPolicy: KilnPermissionPolicy = {
  approval: "on-request",
  sandbox: "workspace-write",
  tools: [{ tool: "Read", action: "allow" }],
  commands: [{ pattern: "git status*", action: "allow" }],
  fileGovernance: { denyGlobs: ["**/.env"] },
  dataFirewall: [{ destination: "logs", action: "redact" }],
  agentScopes: [{ agent: "planner", inherit: false }],
};

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

describe("permission projection translators", () => {
  it("projects Claude permissions while preserving unmanaged settings", () => {
    const projection = translateClaudePermissionProjection({
      policy: granularPolicy,
      existingDocument: {
        mcpServers: { kiln: { command: "node", args: ["entry.js"] } },
        uiTheme: "dark",
        kiln: { existingKey: "keep-me" },
      },
    });

    expect(projection).toMatchObject({
      targetId: "claude-settings",
      managedFields: ["permissions", "kiln.permissionSync"],
      document: {
        mcpServers: { kiln: { command: "node", args: ["entry.js"] } },
        uiTheme: "dark",
        permissions: { allow: ["Read", "WebFetch"], deny: [] },
      },
    });
    const kiln = asRecord(projection.document.kiln);
    expect(kiln.existingKey).toBe("keep-me");
    expect(asRecord(kiln.permissionSync).backend).toBe("claude");
  });

  it("projects Codex approval and sandbox fields while preserving unmanaged TOML sections", () => {
    const projection = translateCodexPermissionProjection({
      policy: granularPolicy,
      existingDocument: {
        model: "gpt-5.4",
        projects: { default: "kiln" },
        kiln: { legacy: "keep" },
      },
    });

    expect(projection.targetId).toBe("codex-config");
    expect(projection.managedFields).toEqual([
      "approval_policy",
      "sandbox_mode",
      "kiln.permission_sync",
    ]);
    expect(projection.document.model).toBe("gpt-5.4");
    expect(projection.document.projects).toEqual({ default: "kiln" });
    expect(projection.document.approval_policy).toBe("on-request");
    expect(projection.document.sandbox_mode).toBe("workspace-write");
    const kiln = asRecord(projection.document.kiln);
    expect(kiln.legacy).toBe("keep");
    expect(asRecord(kiln.permission_sync).backend).toBe("codex");
  });

  it("projects OpenCode permission defaults while preserving unmanaged JSON keys", () => {
    const projection = translateOpenCodePermissionProjection({
      policy: granularPolicy,
      existingDocument: {
        theme: "ocean",
        kiln: { legacyFlag: true },
      },
    });

    expect(projection).toMatchObject({
      targetId: "opencode-config",
      managedFields: ["permission"],
      document: {
        theme: "ocean",
        permission: { default: "ask" },
      },
    });
    expect(projection.document.kiln).toBeUndefined();
  });
});
