import { describe, expect, it } from "vitest";
import {
  OperatorElicitationTool,
  type OperatorElicitationResponder,
} from "../../../src/tools/infrastructure/operator-elicitation-tool.js";

describe("OperatorElicitationTool", () => {
  it("fails closed when no operator responder is configured", async () => {
    const tool = new OperatorElicitationTool();

    await expect(tool.execute({
      name: "operator_elicit",
      input: {
        mode: "form",
        message: "Choose an option",
        schema: { type: "object" },
      },
    })).resolves.toMatchObject({
      isError: true,
      metadata: {
        toolName: "operator_elicit",
        kind: "elicitation",
        operation: "elicit",
        mode: "form",
        outcome: "unsupported",
        errorCode: "responder_not_configured",
      },
    });
  });

  it("rejects sensitive form collection and requires URL mode", async () => {
    const tool = new OperatorElicitationTool();

    await expect(tool.execute({
      name: "operator_elicit",
      input: {
        mode: "form",
        message: "Enter credentials",
        sensitive: true,
        schema: {
          type: "object",
          properties: {
            apiKey: { type: "string" },
          },
        },
      },
    })).resolves.toMatchObject({
      isError: true,
      output: expect.stringContaining("URL mode"),
      metadata: {
        errorCode: "sensitive_form_denied",
      },
    });
  });

  it("submits form elicitation through the configured responder without logging values in metadata", async () => {
    const requests: unknown[] = [];
    const responder: OperatorElicitationResponder = {
      elicit: async (request) => {
        requests.push(request);
        return {
          outcome: "submitted",
          values: { choice: "yes" },
          surface: "test",
        };
      },
    };
    const tool = new OperatorElicitationTool({ responder });

    const result = await tool.execute({
      name: "operator_elicit",
      input: {
        mode: "form",
        message: "Continue?",
        schema: {
          type: "object",
          properties: {
            choice: { enum: ["yes", "no"] },
          },
        },
        verbosity: "structured",
      },
    });

    expect(result.isError).toBe(false);
    expect(requests).toEqual([{
      mode: "form",
      message: "Continue?",
      schema: {
        type: "object",
        properties: {
          choice: { enum: ["yes", "no"] },
        },
      },
      sensitive: false,
    }]);
    expect(JSON.parse(result.output)).toEqual({
      outcome: "submitted",
      values: { choice: "yes" },
      surface: "test",
    });
    expect(result.metadata).toMatchObject({
      toolName: "operator_elicit",
      kind: "elicitation",
      operation: "elicit",
      mode: "form",
      outcome: "submitted",
      schemaProvided: true,
      sensitive: false,
      valueKeys: ["choice"],
      surface: "test",
    });
    expect(JSON.stringify(result.metadata)).not.toContain("yes");
  });

  it("requires and validates URL handoff targets", async () => {
    const responder: OperatorElicitationResponder = {
      elicit: async () => ({ outcome: "submitted", surface: "test" }),
    };
    const tool = new OperatorElicitationTool({ responder });

    await expect(tool.execute({
      name: "operator_elicit",
      input: {
        mode: "url",
        message: "Open provider login",
        url: "http://example.com/login",
        sensitive: true,
      },
    })).resolves.toMatchObject({
      isError: true,
      output: expect.stringContaining("HTTPS"),
    });

    await expect(tool.execute({
      name: "operator_elicit",
      input: {
        mode: "url",
        message: "Open provider login",
        url: "https://example.com/login",
        sensitive: true,
        verbosity: "summary",
      },
    })).resolves.toMatchObject({
      isError: false,
      output: "operator elicitation submitted",
      metadata: {
        mode: "url",
        outcome: "submitted",
        sensitive: true,
        url: "https://example.com/login",
      },
    });
  });

  it("can use an MCP-provided elicitation responder from the execution context", async () => {
    const tool = new OperatorElicitationTool();

    await expect(tool.execute({
      name: "operator_elicit",
      input: {
        mode: "form",
        message: "Pick branch",
        schema: { type: "object" },
      },
    }, {
      operatorElicitation: {
        elicit: async () => ({ outcome: "declined", surface: "mcp" }),
      },
    })).resolves.toMatchObject({
      isError: true,
      metadata: {
        outcome: "declined",
        surface: "mcp",
      },
    });
  });
});
