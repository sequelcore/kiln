import { describe, expect, it } from "vitest";
import {
  VerifiedEfficiencyEvidenceProjectionSchema,
  formatVerifiedEfficiencyEvidence,
} from "../src/index.js";
import type {
  AuthorityStateRecord,
  AuthorityStateSnapshot,
  EffectiveTurnAuthoritySnapshot,
  GoalRunSnapshot,
  InspectableWorkItemSnapshotResource,
  OperatorResourceReadRequest,
  OperatorResourceReadResult,
  PlanStateSnapshot,
  ToolResourceDescriptor,
  ToolResourceDisplayDescriptor,
  ToolResourceReadResult,
  WorkItemSnapshot,
  VerifiedEfficiencyEvidenceProjection,
} from "../src/index.js";

describe("resource SDK exports", () => {
  it("exports resource registry and display contracts for consumer code", () => {
    const descriptor: ToolResourceDescriptor = {
      uri: "kiln://tools/catalog",
      name: "tool_catalog",
      mimeType: "application/json",
    };
    const display: ToolResourceDisplayDescriptor = {
      uri: descriptor.uri,
      mimeType: descriptor.mimeType,
    };
    const readResult: ToolResourceReadResult = {
      contents: [{ uri: descriptor.uri, mimeType: descriptor.mimeType, text: "{}" }],
    };
    const operatorReadRequest: OperatorResourceReadRequest = {
      uri: descriptor.uri,
      target: {
        gatewayTargetId: "app-gateway:support",
        resourceUri: descriptor.uri,
      },
    };
    const operatorReadResult: OperatorResourceReadResult = {
      uri: descriptor.uri,
      target: operatorReadRequest.target,
      contents: [{ kind: "text", uri: descriptor.uri, mimeType: descriptor.mimeType, text: "{}" }],
    };

    expect(display.uri).toBe("kiln://tools/catalog");
    expect(readResult.contents[0]?.uri).toBe(descriptor.uri);
    expect(operatorReadResult.target?.gatewayTargetId).toBe("app-gateway:support");
  });

  it("exports the canonical efficiency schema, formatter, and DTO", () => {
    const projection: VerifiedEfficiencyEvidenceProjection = {
      schemaVersion: "verified-efficiency-evidence-v1",
      sessionId: "session-sdk",
      observedAt: "2026-07-14T20:00:00.000Z",
      provider: { providerId: "codex-oauth", modelId: "gpt-5.6-terra", billingMode: "subscription" },
      policy: {
        owner: "ContextGovernor",
        policyId: "context-whole-block-static-v1",
        configurationHash: `sha256:${"a".repeat(64)}`,
      },
      totals: {
        providerTotalTokens: 10,
        providerTotalCostUsd: 0,
        measured: { tokens: 2, costUsd: 0 },
        estimated: { tokens: 0, costUsd: 0 },
        cached: { tokens: 3, costUsd: 0 },
        unknown: { tokens: 5, costUsd: 0 },
        cacheWritten: { tokens: 0, costUsd: 0 },
        avoided: { tokens: 0, costUsd: 0 },
      },
      outcome: "succeeded",
      verification: { status: "not_run", results: [] },
      actions: [],
      savings: [],
      evidenceUris: [],
    };

    expect(VerifiedEfficiencyEvidenceProjectionSchema.parse(projection)).toEqual(projection);
    expect(formatVerifiedEfficiencyEvidence(projection)).toContain("3 cached");
  });

  it("exports typed workflow snapshot contracts for SDK resource consumers", () => {
    const authority: EffectiveTurnAuthoritySnapshot = {
      executionMode: "execute",
      requestedAuthority: "auto",
      admittedAuthority: "audited",
      sourcePolicy: "runtime_surface_projection",
      reason: "Authority admitted from runtime policy.",
      completeness: "authoritative",
      toolCount: 12,
      deniedToolCount: 2,
    };
    const authorityRecord: AuthorityStateRecord = {
      id: "authority_1",
      recordedAt: "2026-05-12T22:30:00.000Z",
      source: "runtime",
      authority,
      sequence: 1,
    };
    const authoritySnapshot: AuthorityStateSnapshot = {
      authorities: [authorityRecord],
      latest: authorityRecord,
      sequence: 1,
    };
    const planSnapshot: PlanStateSnapshot = { plans: [], sequence: 0 };
    const goalSnapshot: GoalRunSnapshot = { goals: [], sequence: 0 };
    const workItemSnapshot: WorkItemSnapshot = { items: [], sequence: 0 };
    const inspectableWorkItemSnapshot: InspectableWorkItemSnapshotResource = {
      sequence: 1,
      items: [
        {
          id: "work-1",
          summary: "Verify governed resource projection",
          status: "in_progress",
          workflowProfile: "sequel-engineering",
          risk: "low",
          triggers: ["sdk-resource-export"],
          surface: "sdk",
          assignedAgentProfile: "coder",
          routeId: "local",
          authorityProfile: "audited",
          expectedEvidence: ["tests", "residual-risk"],
          providedEvidence: ["tests"],
          verificationGates: ["typecheck"],
          skippedVerificationGates: [],
          verificationGateResults: [],
          dependencies: [],
          createdAt: "2026-06-24T00:00:00.000Z",
          updatedAt: "2026-06-24T00:01:00.000Z",
          sequence: 1,
          executionAttempts: [],
          resourceUri: "kiln://session/work-items/work-1",
          missingEvidence: ["residual-risk"],
        },
      ],
    };

    expect(authoritySnapshot.latest?.authority.admittedAuthority).toBe("audited");
    expect(planSnapshot.plans).toEqual([]);
    expect(goalSnapshot.goals).toEqual([]);
    expect(workItemSnapshot.items).toEqual([]);
    expect(inspectableWorkItemSnapshot.items[0]?.resourceUri).toBe("kiln://session/work-items/work-1");
    expect(inspectableWorkItemSnapshot.items[0]?.missingEvidence).toEqual(["residual-risk"]);
  });
});
