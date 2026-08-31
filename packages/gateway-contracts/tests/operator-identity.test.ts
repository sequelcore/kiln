import { describe, expect, it } from "vitest";
import {
  operatorIdentityInitials,
  projectAgentProfileIdentity,
  projectManagedAgentIdentity,
  projectMessageIdentity,
} from "../src/operator-identity.js";

describe("operator identity projection", () => {
  it("uses child identity as the stable managed-agent avatar source", () => {
    expect(projectManagedAgentIdentity({
      agentId: "codex-oauth:read-only",
      access: "read-only",
      providerRoute: {
        providerId: "codex-oauth",
        model: "gpt-5.4-mini",
        surface: "direct-provider",
      },
      capabilitySnapshot: {
        snapshotId: "inv-1:capability-snapshot",
        capturedAt: "2026-05-07T08:00:00.000Z",
        routeId: "codex-mini",
        routeSource: "resolved-config",
        routeHealth: { status: "healthy", reason: "Route probe succeeded." },
        providerModelProof: { status: "live-proven", source: "provider-authoritative" },
        providerRoute: {
          providerId: "codex-oauth",
          model: "gpt-5.4-mini",
          surface: "direct-provider",
        },
        adapterKind: "direct",
        executionMode: "direct-provider",
        adapterDescriptor: {},
        authorityProfile: {},
        contextMode: "isolated",
        resourcePlane: { available: true, resourceUris: [] },
        resourceLease: {
          leaseId: "inv-1:resource-lease",
          createdAt: "2026-05-07T08:00:00.000Z",
          healthStatus: "healthy",
          cleanupStatus: "not-required",
          workingDirectoryPath: "C:/workspace/kiln",
          workingDirectoryMode: "read-only",
          resourceUris: [],
          diagnosticUris: [],
        },
        childIdentity: {
          agentId: "codex-oauth:read-only",
          displayName: "Piama",
          admittedAgentProfile: "architecture-reviewer",
        },
      },
    })).toEqual({
      kind: "agent",
      id: "codex-oauth:read-only",
      label: "Piama",
      seed: "agent:codex-oauth:read-only",
      subtitle: "codex-oauth/gpt-5.4-mini (direct-provider)",
    });
  });

  it("falls back to profile identity when a work item has only an assigned profile", () => {
    expect(projectAgentProfileIdentity("planner")).toEqual({
      kind: "agent_profile",
      id: "planner",
      label: "planner",
      seed: "agent-profile:planner",
    });
  });

  it("projects chat participant identities without surface dependencies", () => {
    expect(projectMessageIdentity({ role: "user", userId: "local-user-1" })).toMatchObject({
      kind: "operator",
      id: "local-user-1",
      seed: "operator:local-user-1",
    });
    expect(projectMessageIdentity({ role: "assistant", provider: "codex-oauth", model: "gpt-5.4" })).toMatchObject({
      kind: "assistant",
      id: "codex-oauth:gpt-5.4",
      seed: "assistant:codex-oauth:gpt-5.4",
    });
  });

  it("formats deterministic initials for text-only surfaces", () => {
    expect(operatorIdentityInitials("Piama")).toBe("PI");
    expect(operatorIdentityInitials("codex-oauth:read-only")).toBe("CO");
  });
});
