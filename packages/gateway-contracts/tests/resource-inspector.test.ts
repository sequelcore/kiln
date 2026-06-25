import { describe, expect, it } from "vitest";
import {
  OperatorResourceReadResultSchema,
  projectOperatorResourceReadResult,
} from "../src/resource-inspector.js";

describe("resource inspector contract", () => {
  it("projects provider text reads into a target-aware operator resource result", () => {
    const result = projectOperatorResourceReadResult({
      uri: "kiln://session/work-items/work-1",
      target: {
        gatewayTargetId: "gateway:local-app",
        instanceId: "local-app:instance",
        sessionId: "session-1",
        resourceUri: "kiln://session/work-items/work-1",
      },
      readResult: {
        contents: [
          {
            uri: "kiln://session/work-items/work-1",
            mimeType: "text/markdown",
            text: "# Work item",
            _meta: {
              range: {
                unit: "line",
                offset: 0,
                limit: 100,
                returned: 1,
                total: 1,
                truncated: false,
              },
            },
          },
        ],
        nextCursor: "line:100",
      },
    });

    expect(OperatorResourceReadResultSchema.parse(result)).toEqual({
      uri: "kiln://session/work-items/work-1",
      target: {
        gatewayTargetId: "gateway:local-app",
        instanceId: "local-app:instance",
        sessionId: "session-1",
        resourceUri: "kiln://session/work-items/work-1",
      },
      contents: [
        {
          kind: "text",
          uri: "kiln://session/work-items/work-1",
          mimeType: "text/markdown",
          text: "# Work item",
          meta: {
            range: {
              unit: "line",
              offset: 0,
              limit: 100,
              returned: 1,
              total: 1,
              truncated: false,
            },
          },
        },
      ],
      nextCursor: "line:100",
    });
  });

  it("projects provider blob reads without baking GUI data URLs into the shared contract", () => {
    const result = projectOperatorResourceReadResult({
      uri: "kiln://artifacts/capture",
      readResult: {
        contents: [
          {
            uri: "kiln://artifacts/capture",
            mimeType: "image/png",
            blob: "iVBORw0KGgo=",
          },
        ],
      },
    });

    expect(result.contents).toEqual([
      {
        kind: "blob",
        uri: "kiln://artifacts/capture",
        mimeType: "image/png",
        blob: "iVBORw0KGgo=",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("data:image/png");
  });
});
