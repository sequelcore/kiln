import { describe, expect, it } from "vitest";
import {
  RuntimeManagedAgentInvocationService,
  type ManagedInvocationAgentCatalogEntry,
  type ManagedInvocationToolAttachment,
  type ManagedInvocationToolRoute,
} from "@kilnai/runtime";
import { resolveConfiguredVisionCapability } from "../../src/wrapper/configured-vision-capability.js";

const EVALUATED_AT = "2026-08-31T12:00:00.000Z";

describe("configured vision capability", () => {
  it("contributes one exact implementation for one executable configured specialist", () => {
    const resolution = resolveConfiguredVisionCapability(attachment([visionAgent("vision-worker")]), EVALUATED_AT);

    expect(resolution.selection).toEqual({
      capabilityId: "vision.analyze",
      agentProfile: "vision-worker",
      routeId: "vision-route",
      providerRoute: { providerId: "openai", model: "gpt-vision" },
      externalRuntimeAttachment: {
        kind: "external-runtime",
        runtimeId: "vision-runtime",
        attachmentId: "vision-instance",
      },
      implementationIdentityDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(resolution.discovery.catalog.descriptors).toMatchObject([{
      capabilityId: "vision.analyze",
      revision: "v1",
      kind: "agent-backed",
      freshness: { status: "available" },
      implementationReferences: [{
        kind: "agent",
        identityDigest: resolution.selection?.implementationIdentityDigest,
      }],
    }]);
  });

  it("fails closed when multiple configured specialists would make selection ambiguous", () => {
    const resolution = resolveConfiguredVisionCapability(
      attachment([visionAgent("vision-a"), visionAgent("vision-b")]),
      EVALUATED_AT,
    );

    expect(resolution.selection).toBeUndefined();
    expect(resolution.discovery.catalog.descriptors).toEqual([]);
    expect(resolution.discovery.diagnostics).toEqual([{
      capabilityId: "vision.analyze",
      status: "validation_failed",
      diagnostic: { code: "invalid_declaration" },
    }]);
  });

  it("does not advertise prose-only, text-only, write-capable, or ownerless declarations", () => {
    const textOnly = { ...visionAgent("text-worker"), modalities: ["text"] };
    const ownerless = attachment([visionAgent("vision-worker")], false);

    expect(resolveConfiguredVisionCapability(attachment([textOnly]), EVALUATED_AT).selection).toBeUndefined();
    expect(resolveConfiguredVisionCapability(ownerless, EVALUATED_AT).selection).toBeUndefined();
  });

  it.each([
    ["provider", { providerId: "other-provider", model: "gpt-vision" }],
    ["model", { providerId: "openai", model: "other-model" }],
  ])("rejects an agent provider-route %s hint that contradicts its selected route", (_kind, providerRoute) => {
    const agent = { ...visionAgent("vision-worker"), providerRoute };

    expect(resolveConfiguredVisionCapability(attachment([agent]), EVALUATED_AT).selection).toBeUndefined();
  });

  it.each([
    ["the physical route attachment", (route: ManagedInvocationToolRoute) => ({
      ...route,
      externalRuntimeAttachment: undefined,
    })],
    ["the capability attachment", (route: ManagedInvocationToolRoute) => ({
      ...route,
      capability: { ...route.capability, externalRuntimeAttachment: undefined },
    })],
    ["the capability attachment identity", (route: ManagedInvocationToolRoute) => ({
      ...route,
      capability: {
        ...route.capability,
        externalRuntimeAttachment: {
          kind: "external-runtime" as const,
          runtimeId: "vision-runtime",
          attachmentId: "other-instance",
        },
      },
    })],
  ])("rejects attachment support without an exact match for %s", (_kind, mutate) => {
    const route = mutate(visionRoute());

    expect(resolveConfiguredVisionCapability(attachment([visionAgent("vision-worker")], true, route), EVALUATED_AT).selection)
      .toBeUndefined();
  });
});

function attachment(
  agents: readonly ManagedInvocationAgentCatalogEntry[],
  withService = true,
  route: ManagedInvocationToolRoute = visionRoute(),
): ManagedInvocationToolAttachment {
  return {
    options: {
      routes: [route],
      agentCatalog: agents,
      ...(withService ? { invocationService: new RuntimeManagedAgentInvocationService() } : {}),
    },
    callerIdentity: {
      kind: "kiln-runtime",
      surface: "test",
      attachmentId: "attachment:vision-test",
    },
  };
}

function visionAgent(name: string): ManagedInvocationAgentCatalogEntry {
  return {
    name,
    role: "Vision specialist",
    goal: "Analyze governed images",
    tier: "reasoning",
    authorityProfileId: "authority:vision-readonly",
    access: "read-only",
    modalities: ["text", "image"],
    structured: true,
    routeId: "vision-route",
    providerRoute: { providerId: "openai", model: "gpt-vision" },
  };
}

function visionRoute(): ManagedInvocationToolRoute {
  return {
    routeId: "vision-route",
    routeSource: "explicit-managed-route",
    providerId: "openai",
    model: "gpt-vision",
    capability: {
      identity: { routeId: "vision-route", revision: "vision-route-v1" },
      target: { providerId: "openai", modelId: "gpt-vision" },
      adapter: { kind: "direct-provider", capabilityId: "direct-runtime", capabilityVersion: "v1" },
      authorityCeiling: "read_only",
      toolNames: [],
      supportsRecursion: false,
      supportsAttachments: true,
      supportsWrite: false,
      externalRuntimeAttachment: {
        kind: "external-runtime",
        runtimeId: "vision-runtime",
        attachmentId: "vision-instance",
      },
      proof: {
        status: "configured",
        source: "configured-vision-test",
        provenAccess: ["read-only"],
      },
      capacity: { kind: "accountless" },
      settlement: { kind: "not-required" },
    },
    createAdapter: async () => undefined,
    externalRuntimeAttachment: {
      kind: "external-runtime",
      runtimeId: "vision-runtime",
      attachmentId: "vision-instance",
    },
    profiles: [{
      authorityProfileId: "authority:vision-readonly",
      access: "read-only",
      allowedToolNames: [],
      workingDirectory: { path: "C:/repo", mode: "read-only" },
      timeoutMs: 60_000,
      credentialRoute: { mode: "credentialless" },
      memoryScope: { scope: { kind: "project", id: "vision-test" }, access: "none" },
    }],
  };
}
