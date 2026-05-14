import { describe, expect, it } from "vitest";
import {
  planMultimodalRoute,
  type MultimodalArtifact,
  type ProviderModalityCapabilities,
} from "../../../src/engine/domain/multimodal-routing.js";

const imageArtifact: MultimodalArtifact = {
  uri: "kiln://artifacts/tool-results/artifact_1/content",
  modality: "image",
  mimeType: "image/png",
  sizeBytes: 1024,
  checksum: {
    algorithm: "sha256",
    value: "abc123",
  },
  source: {
    kind: "tool-output",
    id: "view_image:call_1",
  },
  retention: {
    scope: "session",
  },
  replay: {
    uri: "kiln://artifacts/tool-results/artifact_1/content",
  },
  dimensions: {
    width: 320,
    height: 200,
  },
};

const textArtifact: MultimodalArtifact = {
  uri: "kiln://artifacts/context/artifact_text/content",
  modality: "text",
  mimeType: "text/plain",
  sizeBytes: 128,
  checksum: {
    algorithm: "sha256",
    value: "text123",
  },
  source: {
    kind: "local-file",
    id: "notes.txt",
  },
  retention: {
    scope: "session",
  },
  replay: {
    uri: "kiln://artifacts/context/artifact_text/content",
  },
};

const documentArtifact: MultimodalArtifact = {
  uri: "kiln://artifacts/uploads/document_1/content",
  modality: "document",
  mimeType: "application/pdf",
  sizeBytes: 2048,
  checksum: {
    algorithm: "sha256",
    value: "doc123",
  },
  source: {
    kind: "uploaded-file",
    id: "report.pdf",
  },
  retention: {
    scope: "session",
  },
  replay: {
    uri: "kiln://artifacts/uploads/document_1/content",
  },
};

const visionModel: ProviderModalityCapabilities = {
  provider: "openai",
  model: "gpt-5.4",
  supportedCapabilities: ["vision", "screenshot-review"],
  inputModalities: ["text", "image"],
  outputModalities: ["text"],
  toolResultModalities: ["text", "image"],
  constraints: {
    supportsBase64: true,
    supportsUrl: true,
    supportsDocuments: false,
    maxInputArtifacts: 8,
    maxBytesPerArtifact: 4_000_000,
  },
  degradationBehavior: [],
};

const textOnlyModel: ProviderModalityCapabilities = {
  ...visionModel,
  provider: "deepseek",
  model: "deepseek-chat",
  supportedCapabilities: ["vision"],
  inputModalities: ["text"],
  toolResultModalities: ["text"],
  constraints: {
    supportsBase64: false,
    supportsUrl: false,
    supportsDocuments: false,
  },
};

describe("planMultimodalRoute", () => {
  it("prefers native handling when the active model supports the required modality", () => {
    const decision = planMultimodalRoute({
      requestedCapability: "vision",
      requiredInputModalities: ["image"],
      artifacts: [imageArtifact],
      activeRoute: visionModel,
      policy: {
        allowNative: true,
        allowDelegation: true,
        allowTransforms: true,
      },
    });

    expect(decision.strategy).toBe("native");
    expect(decision.reason.code).toBe("native_supported");
    expect(decision.native).toEqual({
      provider: "openai",
      model: "gpt-5.4",
      serializedModalities: ["image"],
    });
  });

  it("delegates to an auxiliary managed route when native support is unavailable", () => {
    const decision = planMultimodalRoute({
      requestedCapability: "vision",
      requiredInputModalities: ["image"],
      artifacts: [imageArtifact],
      activeRoute: textOnlyModel,
      policy: {
        allowNative: true,
        allowDelegation: true,
        allowTransforms: true,
      },
      auxiliaryRoutes: [
        {
          routeId: "vision-describer",
          provider: "codex-oauth",
          model: "gpt-5.4-mini",
          agentProfile: "vision-describer",
          authorityProfileId: "foundation-readonly-plan",
          routeHealth: {
            status: "healthy",
            evidence: "live-proof",
          },
          capabilities: visionModel,
        },
      ],
    });

    expect(decision.strategy).toBe("delegated");
    expect(decision.reason.code).toBe("delegation_route_available");
    expect(decision.delegation).toEqual({
      routeId: "vision-describer",
      provider: "codex-oauth",
      model: "gpt-5.4-mini",
      agentProfile: "vision-describer",
      authorityProfileId: "foundation-readonly-plan",
      routeHealth: {
        status: "healthy",
        evidence: "live-proof",
      },
      policyDecision: {
        allowed: true,
        reason: "Managed auxiliary delegation is allowed by policy.",
      },
      costBudgetDecision: {
        status: "not-evaluated",
        evidence: "No cost budget input was provided to the modality planner.",
      },
      expectedResult: {
        format: "structured-handoff",
        requiredFields: ["summary", "artifactUris", "uncertainty", "limitations"],
      },
      uncertainty: {
        level: "unknown",
        limitations: ["Auxiliary route has not executed yet."],
      },
      artifactUris: [imageArtifact.uri],
      requestedCapability: "vision",
    });
  });

  it("rejects a route that accepts the artifact modality but lacks the requested capability", () => {
    const audioIngestOnlyModel: ProviderModalityCapabilities = {
      provider: "example",
      model: "audio-ingest-only",
      supportedCapabilities: ["vision"],
      inputModalities: ["text", "audio"],
      outputModalities: ["text"],
      toolResultModalities: ["text", "audio"],
      constraints: {
        supportsBase64: true,
        supportsUrl: true,
        supportsDocuments: false,
      },
      degradationBehavior: [],
    };

    const decision = planMultimodalRoute({
      requestedCapability: "transcription",
      requiredInputModalities: ["audio"],
      artifacts: [{
        ...imageArtifact,
        uri: "kiln://artifacts/tool-results/audio_1/content",
        modality: "audio",
        mimeType: "audio/ogg",
        durationMs: 1200,
        dimensions: undefined,
      }],
      activeRoute: audioIngestOnlyModel,
      policy: {
        allowNative: true,
        allowDelegation: false,
        allowTransforms: false,
      },
    });

    expect(decision.strategy).toBe("unsupported");
    expect(decision.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "native_route_missing_capability",
          severity: "info",
        }),
      ]),
    );
  });

  it("checks tool-result modality support only for artifacts that came from tool results", () => {
    const route = {
      ...visionModel,
      toolResultModalities: ["image"],
    } satisfies ProviderModalityCapabilities;

    const decision = planMultimodalRoute({
      requestedCapability: "vision",
      requiredInputModalities: ["text", "image"],
      artifacts: [textArtifact, imageArtifact],
      activeRoute: route,
      policy: {
        allowNative: true,
        allowDelegation: false,
        allowTransforms: false,
      },
    });

    expect(decision.strategy).toBe("native");
    expect(decision.native).toEqual({
      provider: "openai",
      model: "gpt-5.4",
      serializedModalities: ["text", "image"],
    });
  });

  it("records artifact-derived modalities in native route evidence", () => {
    const decision = planMultimodalRoute({
      requestedCapability: "vision",
      requiredInputModalities: [],
      artifacts: [textArtifact, imageArtifact],
      activeRoute: visionModel,
      policy: {
        allowNative: true,
        allowDelegation: false,
        allowTransforms: false,
      },
    });

    expect(decision.strategy).toBe("native");
    expect(decision.native?.serializedModalities).toEqual(["text", "image"]);
  });

  it("fails closed when the artifact set contains a document the active route disallows", () => {
    const documentInputRoute: ProviderModalityCapabilities = {
      ...visionModel,
      supportedCapabilities: ["document"],
      inputModalities: ["text", "document"],
      toolResultModalities: ["text"],
      constraints: {
        ...visionModel.constraints,
        supportsDocuments: false,
      },
    };

    const decision = planMultimodalRoute({
      requestedCapability: "document",
      requiredInputModalities: ["text"],
      artifacts: [textArtifact, documentArtifact],
      activeRoute: documentInputRoute,
      policy: {
        allowNative: true,
        allowDelegation: false,
        allowTransforms: false,
      },
    });

    expect(decision.strategy).toBe("unsupported");
    expect(decision.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "native_route_document_unsupported",
          severity: "info",
        }),
      ]),
    );
  });

  it("uses an explicit transform when neither native nor delegated handling is available", () => {
    const decision = planMultimodalRoute({
      requestedCapability: "vision",
      requiredInputModalities: ["image"],
      artifacts: [imageArtifact],
      activeRoute: textOnlyModel,
      policy: {
        allowNative: true,
        allowDelegation: true,
        allowTransforms: true,
      },
      transforms: [
        {
          transform: "ocr",
          sourceModalities: ["image"],
          outputModality: "text",
          available: true,
          provenance: "configured-ocr-backend",
          degradation: "extracts visible text only; original image remains a sidecar artifact",
        },
      ],
    });

    expect(decision.strategy).toBe("transform");
    expect(decision.reason.code).toBe("transform_available");
    expect(decision.transform).toEqual({
      transform: "ocr",
      sourceArtifactUris: [imageArtifact.uri],
      outputModality: "text",
      provenance: "configured-ocr-backend",
      degradation: "extracts visible text only; original image remains a sidecar artifact",
    });
  });

  it("matches transforms only against modalities that the active route cannot already accept", () => {
    const decision = planMultimodalRoute({
      requestedCapability: "vision",
      requiredInputModalities: ["text", "image"],
      artifacts: [textArtifact, { ...imageArtifact, source: { kind: "local-file", id: "diagram.png" } }],
      activeRoute: textOnlyModel,
      policy: {
        allowNative: true,
        allowDelegation: false,
        allowTransforms: true,
      },
      transforms: [
        {
          transform: "ocr",
          sourceModalities: ["image"],
          outputModality: "text",
          available: true,
          provenance: "configured-ocr-backend",
          degradation: "extracts visible text only; original image remains a sidecar artifact",
        },
      ],
    });

    expect(decision.strategy).toBe("transform");
    expect(decision.transform?.sourceArtifactUris).toEqual([
      imageArtifact.uri,
    ]);
  });

  it("selects downsample when the active route accepts images but rejects the artifact size", () => {
    const constrainedVisionModel = {
      ...visionModel,
      constraints: {
        ...visionModel.constraints,
        maxBytesPerArtifact: 512,
      },
    } satisfies ProviderModalityCapabilities;

    const decision = planMultimodalRoute({
      requestedCapability: "vision",
      requiredInputModalities: ["image"],
      artifacts: [{ ...imageArtifact, sizeBytes: 2048 }],
      activeRoute: constrainedVisionModel,
      policy: {
        allowNative: true,
        allowDelegation: false,
        allowTransforms: true,
      },
      transforms: [
        {
          transform: "downsample",
          sourceModalities: ["image"],
          outputModality: "image",
          available: true,
          provenance: "sharp",
          degradation: "reduces image dimensions and quality before model transport",
        },
      ],
    });

    expect(decision.strategy).toBe("transform");
    expect(decision.transform).toEqual({
      transform: "downsample",
      sourceArtifactUris: [imageArtifact.uri],
      outputModality: "image",
      provenance: "sharp",
      degradation: "reduces image dimensions and quality before model transport",
    });
  });

  it("selects document extraction when the active route accepts text but not document artifacts", () => {
    const decision = planMultimodalRoute({
      requestedCapability: "document",
      requiredInputModalities: ["document"],
      artifacts: [documentArtifact],
      activeRoute: textOnlyModel,
      policy: {
        allowNative: true,
        allowDelegation: false,
        allowTransforms: true,
      },
      transforms: [
        {
          transform: "document-extraction",
          sourceModalities: ["document"],
          outputModality: "text",
          available: true,
          provenance: "unpdf",
          degradation: "extracts PDF text before model transport; formatting and images are not preserved",
        },
      ],
    });

    expect(decision.strategy).toBe("transform");
    expect(decision.transform).toEqual({
      transform: "document-extraction",
      sourceArtifactUris: [documentArtifact.uri],
      outputModality: "text",
      provenance: "unpdf",
      degradation: "extracts PDF text before model transport; formatting and images are not preserved",
    });
  });

  it("fails closed when no governed route can satisfy the modality", () => {
    const decision = planMultimodalRoute({
      requestedCapability: "vision",
      requiredInputModalities: ["image"],
      artifacts: [imageArtifact],
      activeRoute: textOnlyModel,
      policy: {
        allowNative: true,
        allowDelegation: true,
        allowTransforms: true,
      },
    });

    expect(decision.strategy).toBe("unsupported");
    expect(decision.reason.code).toBe("unsupported_modality");
    expect(decision.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "native_route_missing_modality",
          severity: "info",
        }),
        expect.objectContaining({
          code: "delegation_route_unavailable",
          severity: "info",
        }),
        expect.objectContaining({
          code: "transform_unavailable",
          severity: "info",
        }),
      ]),
    );
  });
});
