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
  tools: [{ tool: "read", action: "allow" }],
  commands: [{ pattern: "git status*", action: "allow" }],
  fileGovernance: { denyGlobs: ["**/.env"] },
  dataFirewall: [{ destination: "logs", action: "redact" }],
  agentScopes: [{ agent: "planner", inherit: false }],
};

const fullAccessPolicy: KilnPermissionPolicy = {
  approval: "never",
  sandbox: "danger-full-access",
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
        // Claude settings carry defaultMode and an ask list. Kiln computes both
        // and previously wrote neither, so the granular rules it classified as
        // natively representable never reached the harness.
        permissions: {
          allow: ["Read", "WebFetch", "Bash(git status*)"],
          deny: [],
          ask: [],
          defaultMode: "default",
        },
      },
    });
    const kiln = asRecord(projection.document.kiln);
    expect(kiln.existingKey).toBe("keep-me");
    expect(asRecord(kiln.permissionSync).backend).toBe("claude");
  });

  it("lowers a canonical tool name into each harness vocabulary", () => {
    const policy: KilnPermissionPolicy = {
      approval: "on-request",
      sandbox: "workspace-write",
      tools: [{ tool: "web_fetch", action: "deny" }],
    };

    const claude = translateClaudePermissionProjection({ policy, existingDocument: {} });
    const opencode = translateOpenCodePermissionProjection({ policy, existingDocument: {} });

    expect(asRecord(claude.document.permissions).deny).toContain("WebFetch");
    expect(asRecord(opencode.document.permission).webfetch).toBe("deny");
  });

  it("refuses to lower a tool name outside the canonical vocabulary", () => {
    const policy: KilnPermissionPolicy = {
      approval: "on-request",
      sandbox: "workspace-write",
      // Claude's casing, not Kiln's vocabulary. Emitting it verbatim would
      // produce a rule OpenCode never matches, so it must degrade to a stated
      // constraint instead of a silently inert native rule.
      tools: [{ tool: "Read", action: "allow" }],
    };

    const opencode = translateOpenCodePermissionProjection({ policy, existingDocument: {} });

    expect(asRecord(opencode.document.permission).Read).toBeUndefined();
    expect(opencode.integrity.semanticLoss.some((loss) => loss.includes("Read"))).toBe(true);
  });

  it("writes the Claude permission mode the policy resolves to", () => {
    const projection = translateClaudePermissionProjection({
      policy: fullAccessPolicy,
      existingDocument: {},
    });

    expect(asRecord(projection.document.permissions).defaultMode).toBe("bypassPermissions");
  });

  it("reports Claude full-access projection as lossy trusted evidence rather than Codex-equivalent sandboxing", () => {
    const projection = translateClaudePermissionProjection({
      policy: fullAccessPolicy,
      existingDocument: {},
    });

    expect(projection.integrity).toMatchObject({
      harness: "claude-code",
      desired: {
        profile: "trusted-full-access",
        source: "operator-local-config",
        proof: "proven",
      },
      persistedNative: {
        profile: "trusted-full-access",
        source: "native-config",
        projectionOwnership: "kiln-managed",
      },
      enforcement: {
        approvalControl: "enforced",
        filesystemSandbox: "not-enforced",
        strength: "rules-only",
      },
      classification: "unsupported-semantic-translation",
      remediationRequiresApproval: true,
    });
    expect(projection.integrity.effectiveRuntime).toBeUndefined();
    expect(projection.integrity.semanticLoss.join(" ")).toContain("bypassPermissions");
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
    expect(projection.integrity.classification).toBe("unsupported-semantic-translation");
    expect(projection.integrity.semanticLoss.join(" ")).toContain("granular permission rule");
  });

  it("reports Codex Full Access native projection separately from unproven runtime authority", () => {
    const projection = translateCodexPermissionProjection({
      policy: fullAccessPolicy,
      existingDocument: {},
    });

    expect(projection.document.approval_policy).toBe("never");
    expect(projection.document.sandbox_mode).toBe("danger-full-access");
    expect(projection.integrity).toMatchObject({
      harness: "codex",
      desired: {
        profile: "trusted-full-access",
        source: "operator-local-config",
        proof: "proven",
      },
      persistedNative: {
        profile: "trusted-full-access",
        source: "native-config",
        projectionOwnership: "kiln-managed",
      },
      enforcement: {
        approvalControl: "enforced",
        filesystemSandbox: "enforced",
        strength: "strong",
      },
      classification: "effective-policy-unproven",
      remediationRequiresApproval: true,
    });
    expect(projection.integrity.effectiveRuntime).toBeUndefined();
  });

  it("projects OpenCode permission defaults while preserving unmanaged JSON keys", () => {
    const projection = translateOpenCodePermissionProjection({
      policy: granularPolicy,
      existingDocument: {
        theme: "ocean",
        kiln: { legacyFlag: true },
      },
    });

    // OpenCode keys permission rules by tool action and normalizes a bare
    // action to `"*"`. A `default` key is read as a rule for a tool named
    // "default", which matches nothing, so the whole projection is inert.
    expect(projection).toMatchObject({
      targetId: "opencode-config",
      managedFields: ["permission"],
      document: {
        theme: "ocean",
        permission: {
          "*": "ask",
          // The canonical `read` rule and the file-governance glob address the
          // same OpenCode action, so the tool-wide grant becomes that action's
          // own wildcard and the narrower glob still overrides it.
          read: { "*": "allow", "**/.env": "deny" },
          bash: { "git status*": "allow" },
          edit: { "**/.env": "deny" },
        },
      },
    });
    expect(projection.document.kiln).toBeUndefined();
  });

  it("orders the OpenCode wildcard rule first so specific rules win", () => {
    const projection = translateOpenCodePermissionProjection({
      policy: granularPolicy,
      existingDocument: {},
    });

    // OpenCode resolves a rule with findLast, so the broad rule must be
    // written before the specific ones or it overrides all of them.
    expect(Object.keys(asRecord(projection.document.permission))[0]).toBe("*");
  });

  it("reports OpenCode allow as permission-rule resolution without sandbox enforcement", () => {
    const projection = translateOpenCodePermissionProjection({
      policy: fullAccessPolicy,
      existingDocument: {},
    });

    expect(projection.document.permission).toEqual({ "*": "allow" });
    expect(projection.integrity).toMatchObject({
      harness: "opencode",
      desired: {
        profile: "trusted-full-access",
        source: "operator-local-config",
      },
      persistedNative: {
        profile: "trusted-full-access",
        source: "native-config",
      },
      enforcement: {
        approvalControl: "enforced",
        filesystemSandbox: "not-enforced",
        networkBoundary: "not-enforced",
        strength: "rules-only",
      },
      classification: "unsupported-semantic-translation",
      remediationRequiresApproval: true,
    });
    expect(projection.integrity.semanticLoss.join(" ")).toContain("OpenCode allow");
  });
});
