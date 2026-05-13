import { describe, expect, it } from "vitest";
import {
  projectToolResourceDescriptor,
  projectToolResourceLink,
  projectToolResultResourceLinks,
} from "../../../src/tools/domain/tool-resource-display.js";

describe("tool resource display projection", () => {
  it("projects resource descriptors into a stable consumer display shape", () => {
    expect(projectToolResourceDescriptor({
      uri: "kiln://workspace/preview/server.log?offset=0&limit=10",
      name: "workspace_preview",
      title: "server.log preview",
      mimeType: "text/plain",
      size: 120,
      _meta: { truncated: true },
    })).toEqual({
      uri: "kiln://workspace/preview/server.log?offset=0&limit=10",
      name: "workspace_preview",
      title: "server.log preview",
      mimeType: "text/plain",
      size: 120,
      truncated: true,
    });
  });

  it("projects metadata resource links into the same display shape", () => {
    expect(projectToolResourceLink({
      uri: "kiln://artifacts/tool-results/artifact_1/content",
      title: "read_many full output",
      mimeType: "text/plain",
      size: 9_000,
      relation: "full_output",
      label: "Capture 1",
      sequence: 1,
    }, true)).toEqual({
      uri: "kiln://artifacts/tool-results/artifact_1/content",
      title: "read_many full output",
      mimeType: "text/plain",
      size: 9_000,
      relation: "full_output",
      label: "Capture 1",
      sequence: 1,
      truncated: true,
    });
  });

  it("projects tool result resource links without exposing large content", () => {
    expect(projectToolResultResourceLinks({
      output: "compact visible output",
      isError: false,
      metadata: {
        toolName: "read_many",
        kind: "file",
        operation: "read_many",
        truncated: true,
        resourceLinks: [{
          uri: "kiln://artifacts/tool-results/artifact_1/content",
          title: "read_many full output",
          mimeType: "text/plain",
          size: 9_000,
          relation: "full_output",
        }],
      },
    })).toEqual([{
      uri: "kiln://artifacts/tool-results/artifact_1/content",
      title: "read_many full output",
      mimeType: "text/plain",
      size: 9_000,
      relation: "full_output",
      truncated: true,
    }]);
  });
});
