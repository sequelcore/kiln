import { describe, expect, it } from "vitest";
import type { AuthorityDescriptor, Capability, ToolDefinition } from "@kilnai/core";
import type { PerCallToolConfig } from "../../src/session/runtime-session-orchestrator.js";
import { projectEffectiveTurnAuthorityPerCallConfig } from "../../src/session/effective-turn-authority.js";

describe("projectEffectiveTurnAuthorityPerCallConfig", () => {
  it("applies configured tenant/session/route min-policy before admitting tools", () => {
    const config = projectEffectiveTurnAuthorityPerCallConfig({
      config: toolConfig(),
      executionMode: "execute",
      requestedAuthority: "audited",
      reason: "test authority admission",
      authorityContext: {
        sessionPolicy: {
          maximumAuthority: "audited",
          reason: "Session allows audited turns.",
        },
        tenantPolicy: {
          subjectId: "tenant-1",
          maximumAuthority: "read_only",
          reason: "Tenant narrows this surface to read-only.",
        },
        routePolicy: {
          subjectId: "route-1",
          maximumAuthority: "audited",
          reason: "Route allows audited turns.",
        },
      },
    });

    expect(Array.from(config?.toolAllowlist ?? [])).toEqual(["read_file"]);
    expect(config?.effectiveTurnAuthority).toMatchObject({
      requestedAuthority: "audited",
      admittedAuthority: "read_only",
      completeness: "authoritative",
      toolCount: 1,
      deniedToolCount: 2,
    });
    expect(config?.effectiveTurnAuthority?.policyInputs).toEqual([
      expect.objectContaining({ source: "requested_authority", status: "applied", requestedAuthority: "audited" }),
      expect.objectContaining({ source: "session_policy", status: "applied", admittedAuthority: "audited" }),
      expect.objectContaining({
        source: "tenant_policy",
        status: "applied",
        subjectId: "tenant-1",
        admittedAuthority: "read_only",
      }),
      expect.objectContaining({ source: "route_policy", status: "applied", admittedAuthority: "audited" }),
      expect.objectContaining({ source: "parent_authority", status: "not_applicable" }),
      expect.objectContaining({ source: "plan_approval", status: "not_applicable" }),
      expect.objectContaining({ source: "goal_envelope", status: "not_applicable" }),
      expect.objectContaining({ source: "work_item_authority", status: "not_applicable" }),
    ]);
  });

  it("fails closed for destructive operator authority without goal and work-item envelopes", () => {
    const config = projectEffectiveTurnAuthorityPerCallConfig({
      config: toolConfig(),
      executionMode: "execute",
      requestedAuthority: "destructive",
      reason: "test destructive admission",
      authorityContext: {
        tenantPolicy: {
          subjectId: "tenant-1",
          maximumAuthority: "destructive",
          reason: "Tenant allows destructive only when governed envelopes are present.",
        },
        routePolicy: {
          subjectId: "route-1",
          maximumAuthority: "destructive",
          reason: "Route allows destructive only when governed envelopes are present.",
        },
      },
    });

    expect(config?.toolAllowlist?.size).toBe(0);
    expect(config?.toolAuthority?.size).toBe(0);
    expect(config?.effectiveTurnAuthority).toMatchObject({
      requestedAuthority: "destructive",
      admittedAuthority: "fail_closed",
      completeness: "authoritative",
      toolCount: 0,
      deniedToolCount: 3,
    });
    expect(config?.effectiveTurnAuthority?.policyInputs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "goal_envelope",
        status: "unresolved",
      }),
      expect.objectContaining({
        source: "work_item_authority",
        status: "unresolved",
      }),
    ]));
  });

  it("admits attended operator destructive authority without managed-work envelopes", () => {
    const config = projectEffectiveTurnAuthorityPerCallConfig({
      config: toolConfig(),
      executionMode: "execute",
      requestedAuthority: "destructive",
      reason: "test attended operator admission",
      authorityContext: {
        executionUse: "operator_interactive",
        sessionPolicy: {
          maximumAuthority: "destructive",
          reason: "The operator explicitly selected Full Access for this session.",
        },
        tenantPolicy: {
          subjectId: "tenant-1",
          maximumAuthority: "destructive",
          reason: "Tenant policy permits attended local mutation.",
        },
        routePolicy: {
          subjectId: "gui-runtime",
          maximumAuthority: "destructive",
          reason: "The GUI runtime enforces the selected turn authority.",
        },
      },
    });

    expect(Array.from(config?.toolAllowlist ?? [])).toEqual(["read_file", "write_file", "shell_command"]);
    expect(config?.effectiveTurnAuthority).toMatchObject({
      requestedAuthority: "destructive",
      admittedAuthority: "destructive",
      completeness: "authoritative",
      toolCount: 3,
      deniedToolCount: 0,
    });
  });

  it("fails closed when attended operator authority lacks runtime policy bounds", () => {
    const config = projectEffectiveTurnAuthorityPerCallConfig({
      config: toolConfig(),
      executionMode: "execute",
      requestedAuthority: "destructive",
      reason: "test incomplete attended operator admission",
      authorityContext: { executionUse: "operator_interactive" },
    });

    expect(config?.toolAllowlist?.size).toBe(0);
    expect(config?.effectiveTurnAuthority).toMatchObject({
      requestedAuthority: "destructive",
      admittedAuthority: "fail_closed",
      completeness: "authoritative",
    });
  });

  it("admits destructive operator authority only when policy and governed envelopes allow it", () => {
    const config = projectEffectiveTurnAuthorityPerCallConfig({
      config: toolConfig(),
      executionMode: "execute",
      requestedAuthority: "destructive",
      reason: "test destructive admission",
      authorityContext: {
        sessionPolicy: {
          maximumAuthority: "destructive",
          reason: "Session allows governed destructive work.",
        },
        tenantPolicy: {
          subjectId: "tenant-1",
          maximumAuthority: "destructive",
          reason: "Tenant allows governed destructive work.",
        },
        routePolicy: {
          subjectId: "route-1",
          maximumAuthority: "destructive",
          reason: "Route allows governed destructive work.",
        },
        goalEnvelope: {
          goalRunId: "goal-1",
          maximumAuthority: "destructive",
          reason: "Approved goal permits destructive execution.",
        },
        workItemAuthority: {
          workItemId: "work-1",
          maximumAuthority: "destructive",
          reason: "Materialized work item permits destructive execution.",
        },
      },
    });

    expect(Array.from(config?.toolAllowlist ?? [])).toEqual(["read_file", "write_file", "shell_command"]);
    expect(config?.effectiveTurnAuthority).toMatchObject({
      requestedAuthority: "destructive",
      admittedAuthority: "destructive",
      completeness: "authoritative",
      toolCount: 3,
      deniedToolCount: 0,
    });
    expect(config?.effectiveTurnAuthority?.policyInputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "goal_envelope", status: "applied", subjectId: "goal-1" }),
      expect.objectContaining({ source: "work_item_authority", status: "applied", subjectId: "work-1" }),
    ]));
  });
});

function toolConfig(): PerCallToolConfig {
  const additionalTools: ToolDefinition[] = [
    { name: "read_file", description: "Read a file.", inputSchema: { type: "object" } },
    { name: "write_file", description: "Write a file.", inputSchema: { type: "object" } },
    { name: "shell_command", description: "Run a command.", inputSchema: { type: "object" } },
  ];
  const capabilities = new Map<string, Capability>([
    ["read_file", { name: "read_file", description: "Read a file.", schema: { type: "object" }, annotations: { readOnly: true } }],
    ["write_file", { name: "write_file", description: "Write a file.", schema: { type: "object" } }],
    ["shell_command", { name: "shell_command", description: "Run a command.", schema: { type: "object" }, annotations: { destructive: true } }],
  ]);
  const toolAuthority = new Map<string, AuthorityDescriptor>([
    ["read_file", { level: 1, allowed: true, requiresApproval: false, reason: "Read-only tool." }],
    ["write_file", { level: 2, allowed: true, requiresApproval: false, reason: "Audited write." }],
    ["shell_command", { level: 4, allowed: true, requiresApproval: false, reason: "Governed destructive tool." }],
  ]);
  return {
    tenantId: "tenant-1",
    toolAllowlist: new Set(additionalTools.map((tool) => tool.name)),
    additionalTools,
    perCallCapabilities: capabilities,
    toolAuthority,
  };
}
