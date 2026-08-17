import { describe, expect, it } from "vitest";
import { createDefaultBuiltinToolSurface } from "../../../src/tools/default-tool-surface.js";
import { MemoryArtifactResourceStore } from "../../../src/tools/infrastructure/artifact-resource-store.js";

describe("resource tools", () => {
  it("passes resource_read range options through the shared registry and returns model-visible nextCursor controls", async () => {
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

    const first = await resourceReadTool?.execute({ name: "resource_read", input: { uri, limit: 2 } });
    expect(first).toMatchObject({
      isError: false,
      output: expect.stringContaining("line 1\nline 2"),
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
    const firstOutput = String(first?.output);
    expect(firstOutput).toContain('"resource_read"');
    expect(firstOutput).toContain('"nextCursor"');
    const firstMetadata = first?.metadata;
    if (firstMetadata?.kind !== "resource") throw new Error("expected resource metadata");
    expect(firstOutput).toContain(String(firstMetadata.nextCursor));

    const second = await resourceReadTool?.execute({
      name: "resource_read",
      input: {
        uri,
        cursor: readModelVisibleNextCursor(firstOutput),
        limit: 2,
      },
    });

    expect(second).toMatchObject({
      isError: false,
      output: expect.stringContaining("line 3"),
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
    const secondOutput = String(second?.output);
    expect(secondOutput).toContain('"resource_read"');
    expect(secondOutput).not.toContain('"nextCursor"');
  });

  it("adds model-visible continuation controls for paginated blob resources", async () => {
    const artifactStore = new MemoryArtifactResourceStore({
      now: () => "2026-05-26T12:00:00.000Z",
    });
    const artifact = artifactStore.put({
      namespace: "managed-invocations",
      title: "Binary transcript",
      mimeType: "application/octet-stream",
      content: { type: "blob", blob: Buffer.from("abcdef").toString("base64") },
      producer: { kind: "test", name: "resource-tools" },
      retention: { scope: "session" },
    });
    const surface = createDefaultBuiltinToolSurface({
      artifactResources: { store: artifactStore },
    });
    const resourceReadTool = surface.tools.find((tool) => tool.name === "resource_read");
    const uri = `kiln://artifacts/managed-invocations/${artifact.id}/content`;

    const first = await resourceReadTool?.execute({ name: "resource_read", input: { uri, limit: 2 } });

    expect(first).toMatchObject({
      isError: false,
      output: expect.stringContaining('"blob"'),
      metadata: {
        range: {
          unit: "byte",
          offset: 0,
          limit: 2,
          returned: 2,
          total: 6,
          truncated: true,
        },
        nextCursor: expect.any(String),
      },
    });
    const firstOutput = String(first?.output);
    expect(firstOutput).toContain('"resource_read"');
    const firstMetadata = first?.metadata;
    if (firstMetadata?.kind !== "resource") throw new Error("expected resource metadata");
    expect(firstOutput).toContain(String(firstMetadata.nextCursor));

    const second = await resourceReadTool?.execute({
      name: "resource_read",
      input: {
        uri,
        cursor: readModelVisibleNextCursor(firstOutput),
        limit: 4,
      },
    });

    expect(second).toMatchObject({
      isError: false,
      metadata: {
        range: {
          unit: "byte",
          offset: 2,
          limit: 4,
          returned: 4,
          total: 6,
          truncated: false,
        },
      },
    });
    expect(String(second?.output)).toContain('"resource_read"');
  });
});

function readModelVisibleNextCursor(output: string): string {
  const marker = "\n\n--- resource_read ---\n";
  const markerIndex = output.lastIndexOf(marker);
  expect(markerIndex).toBeGreaterThan(-1);
  const controls = JSON.parse(output.slice(markerIndex + marker.length)) as {
    readonly resource_read?: {
      readonly nextCursor?: unknown;
    };
  };
  const nextCursor = controls.resource_read?.nextCursor;
  if (typeof nextCursor !== "string") {
    throw new Error("expected resource_read nextCursor");
  }
  return nextCursor;
}
