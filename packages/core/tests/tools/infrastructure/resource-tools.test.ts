import { describe, expect, it } from "vitest";
import { createDefaultBuiltinToolSurface } from "../../../src/tools/default-tool-surface.js";
import { MemoryArtifactResourceStore } from "../../../src/tools/infrastructure/artifact-resource-store.js";

describe("resource tools", () => {
  it("passes resource_read range options through the shared registry and returns nextCursor metadata", async () => {
    const artifactStore = new MemoryArtifactResourceStore({
      now: () => "2026-05-26T12:00:00.000Z",
    });
    const artifact = artifactStore.put({
      namespace: "transcripts",
      title: "Managed child transcript",
      mimeType: "text/plain",
      content: { type: "text", text: ["line 1", "line 2", "line 3"].join("\n") },
      producer: { kind: "managed-agent", name: "child-1" },
      retention: { scope: "session" },
    });
    const surface = createDefaultBuiltinToolSurface({
      artifactResources: { store: artifactStore },
    });
    const uri = `kiln://artifacts/transcripts/${artifact.id}/content`;
    const resourceReadTool = surface.registry.lookup("resource_read");

    const first = await resourceReadTool?.execute({ input: { uri, limit: 2 } });
    expect(first).toMatchObject({
      isError: false,
      output: "line 1\nline 2",
      metadata: {
        toolName: "resource_read",
        kind: "resource",
        operation: "read",
        uri,
        range: {
          unit: "line",
          offset: 0,
          limit: 2,
          returned: 2,
          total: 3,
          truncated: true,
        },
        nextCursor: expect.any(String),
      },
    });

    const second = await resourceReadTool?.execute({
      input: {
        uri,
        cursor: first?.metadata?.nextCursor,
        limit: 2,
      },
    });

    expect(second).toMatchObject({
      isError: false,
      output: "line 3",
      metadata: {
        range: {
          unit: "line",
          offset: 2,
          returned: 1,
          total: 3,
          truncated: false,
        },
      },
    });
  });
});
