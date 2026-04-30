import { describe, expect, it } from "vitest";
import {
  formatOperatorEventValue,
  operatorEventTargetsSurface,
  presentOperatorEventPayload,
} from "../src/operator-event-presentation.js";

describe("operator event presentation", () => {
  it("presents plan lifecycle events without raw payload syntax", () => {
    const submitted = presentOperatorEventPayload("plan_submitted", {
      planId: "plan-1",
      mode: "plan",
      content: "1. Inspect contracts\n2. Add tests\n3. Implement shared execution mode",
    });
    const approved = presentOperatorEventPayload("plan_approved", {
      planId: "plan-1",
      fromMode: "plan",
      toMode: "execute",
    });

    expect(submitted.title).toBe("Plan submitted");
    expect(submitted.summary).toBe("1. Inspect contracts");
    expect(submitted.compactText).toBe("1. Inspect contracts");
    expect(submitted.surfaces).toEqual(["conversation_inline", "activity_panel", "inspector"]);
    expect(submitted.details).toEqual([
      { label: "Plan", value: "plan-1" },
      { label: "Mode", value: "plan" },
    ]);
    expect(JSON.stringify(submitted)).not.toContain("\\\"content\\\"");

    expect(approved.title).toBe("Plan approved");
    expect(approved.summary).toBe("plan -> execute");
    expect(approved.surfaces).toEqual(["conversation_inline", "activity_panel", "inspector"]);
  });

  it("presents provider routing without exposing raw payload syntax", () => {
    const presentation = presentOperatorEventPayload("provider_routed", {
      provider: {
        provider: "codex-oauth",
        model: "gpt-5.5",
      },
      reason: "Explicit model override",
    });

    expect(presentation.title).toBe("Provider routed");
    expect(presentation.summary).toBe("codex-oauth · gpt-5.5");
    expect(presentation.details).toEqual([
      { label: "Provider", value: "codex-oauth" },
      { label: "Model", value: "gpt-5.5" },
      { label: "Why", value: "Explicit model override" },
    ]);
    expect(JSON.stringify(presentation.details)).not.toContain("\\\"provider\\\"");
  });

  it("presents turn completion nested data as operator detail rows", () => {
    const presentation = presentOperatorEventPayload("turn_completed", {
      routedProvider: "codex-oauth",
      routedModel: "gpt-5.4-mini",
      outcome: "completed",
      runtimeContinuity: {
        strategy: "fallback-replay",
        selectionReason: "no-sources",
      },
      authorityStatus: {
        effective: "destructive",
      },
      inputTokens: 1398,
      outputTokens: 11,
    });

    expect(presentation.details).toEqual([
      { label: "Provider", value: "codex-oauth" },
      { label: "Model", value: "gpt-5.4-mini" },
      { label: "Outcome", value: "completed" },
      { label: "Continuity", value: "fallback-replay" },
      { label: "Why", value: "no-sources" },
      { label: "Authority", value: "destructive" },
      { label: "Input tokens", value: "1398" },
      { label: "Output tokens", value: "11" },
    ]);
  });

  it("formats nested values as structured values for compact surfaces", () => {
    expect(formatOperatorEventValue({ nested: true })).toBe("Structured value");
  });

  it("marks live tool calls as inline conversation events and audit events", () => {
    const started = presentOperatorEventPayload("tool_call_started", {
      toolCallId: "tool-1",
      toolName: "read_many",
      input: {
        paths: ["docs"],
        maxBytes: 200000,
      },
    });
    const completed = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "read_many",
      outputSummary: "24 files read, 109 skipped",
      status: { state: "succeeded" },
    });

    expect(started.title).toBe("Using read_many");
    expect(started.surfaces).toEqual(["conversation_inline", "activity_panel", "inspector"]);
    expect(operatorEventTargetsSurface(started, "conversation_inline")).toBe(true);

    expect(completed.title).toBe("Completed read_many");
    expect(completed.summary).toBe("24 files read, 109 skipped");
    expect(completed.surfaces).toEqual(["conversation_inline", "activity_panel", "inspector"]);
  });

  it("keeps low-signal runtime telemetry out of the inline transcript", () => {
    const routed = presentOperatorEventPayload("provider_routed", {
      provider: {
        provider: "codex-oauth",
        model: "gpt-5.5",
      },
    });
    const cost = presentOperatorEventPayload("cost_updated", {
      cost: { deltaUsd: 0.0012 },
      usage: { inputTokens: 100, outputTokens: 25 },
    });

    expect(operatorEventTargetsSurface(routed, "conversation_inline")).toBe(false);
    expect(operatorEventTargetsSurface(cost, "conversation_inline")).toBe(false);
    expect(operatorEventTargetsSurface(routed, "activity_panel")).toBe(true);
    expect(operatorEventTargetsSurface(cost, "activity_panel")).toBe(true);
  });

  it("summarizes JSON-shaped tool output before it reaches inline surfaces", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "read",
      outputSummary: JSON.stringify({
        output: "# Session Model\n\nKiln session identity is provider-agnostic.",
        isError: false,
        metadata: {
          toolName: "read",
          operation: "read",
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("# Session Model");
    expect(presentation.summary).not.toContain("\"output\"");
    expect(presentation.summary).not.toContain("metadata");
  });

  it("unwraps nested JSON tool envelopes before rendering read previews", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "read",
      outputSummary: JSON.stringify({
        output: JSON.stringify({
          output: "# Session Model\n\nKiln session identity is provider-agnostic.",
          isError: false,
          metadata: {
            toolName: "read",
            kind: "file",
            operation: "read",
            filePath: "docs/architecture/session-model.md",
          },
        }),
        isError: false,
        metadata: {
          toolName: "read",
          kind: "file",
          operation: "read",
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("# Session Model");
    expect(presentation.summary).not.toContain("\"output\"");
    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "markdown",
      title: "docs/architecture/session-model.md",
      summary: "# Session Model",
      preview: {
        text: "# Session Model\n\nKiln session identity is provider-agnostic.",
      },
    });
    expect(presentation.toolPresentation?.preview?.text).not.toContain("\"output\"");
  });

  it("uses the full live tool output envelope when outputSummary is a raw JSON summary slice", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "read",
      output: JSON.stringify({
        output: "# Session Model\n\nKiln session identity is provider-agnostic.",
        isError: false,
        metadata: {
          toolName: "read",
          kind: "file",
          operation: "read",
          filePath: "docs/architecture/session-model.md",
        },
      }),
      outputSummary: "{\"output\":\"# Session Model\\n\\nKiln session identity is provider-agnostic.\",\"isError\":false,\"metadata\":{\"toolName\":\"read\"",
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("# Session Model");
    expect(presentation.summary).not.toContain("\"output\"");
    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "markdown",
      title: "docs/architecture/session-model.md",
      preview: {
        text: "# Session Model\n\nKiln session identity is provider-agnostic.",
      },
    });
  });

  it("uses top-level persisted tool metadata when output is plain text", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-write",
      toolName: "write",
      output: "Wrote 32 characters to C:\\Proyectos\\Sequel\\kiln\\live_test_visibility.txt",
      outputSummary: "{\"output\":\"Wrote 32 characters",
      metadata: {
        toolName: "write",
        kind: "file",
        operation: "write",
        filePath: "C:\\Proyectos\\Sequel\\kiln\\live_test_visibility.txt",
        changeType: "modified",
        bytesWritten: 32,
        linesAdded: 1,
        linesRemoved: 1,
        diffPreview: "- kiln gui visibility baseline\n+ kiln gui visibility edit passed",
        diffTruncated: false,
      },
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("1 file changed, 1 addition, 1 removal");
    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "diff",
      title: "C:\\Proyectos\\Sequel\\kiln\\live_test_visibility.txt",
      preview: {
        text: "- kiln gui visibility baseline\n+ kiln gui visibility edit passed",
      },
    });
    expect(JSON.stringify(presentation.toolPresentation)).not.toContain("Wrote 32 characters");
  });

  it("keeps resource-linked tree results as tree previews instead of generic links", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "tree",
      output: JSON.stringify({
        output: ".\npackages/\n  gui/\n    src/",
        isError: false,
        metadata: {
          toolName: "tree",
          kind: "inspection",
          operation: "tree",
          path: "C:\\Proyectos\\Sequel\\kiln",
          depth: 2,
          entryCount: 55,
          resourceLinks: [
            {
              uri: "kiln://artifacts/tool-results/artifact_tree/content",
              title: "tree full output",
              mimeType: "text/plain",
              size: 9000,
              relation: "full_output",
            },
          ],
        },
      }),
      outputSummary: "{\"output\":\".\\npackages/\\n  gui/\",\"isError\":false,\"metadata\":{\"toolName\":\"tree\"",
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("55 entries under C:\\Proyectos\\Sequel\\kiln");
    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "tree",
      title: "C:\\Proyectos\\Sequel\\kiln",
      preview: {
        text: ".\npackages/\n  gui/\n    src/",
      },
      resourceLinks: [
        expect.objectContaining({
          uri: "kiln://artifacts/tool-results/artifact_tree/content",
        }),
      ],
    });
    expect(presentation.toolPresentation?.preview?.text).not.toContain("\"output\"");
  });

  it("does not render tree summary output as a tree preview", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "tree",
      output: JSON.stringify({
        output: "20 entries under C:\\Proyectos\\Sequel\\kiln",
        isError: false,
        metadata: {
          toolName: "tree",
          kind: "inspection",
          operation: "tree",
          path: "C:\\Proyectos\\Sequel\\kiln",
          entryCount: 20,
          verbosity: "summary",
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("20 entries under C:\\Proyectos\\Sequel\\kiln");
    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "tree",
      title: "C:\\Proyectos\\Sequel\\kiln",
      summary: "20 entries under C:\\Proyectos\\Sequel\\kiln",
    });
    expect(presentation.toolPresentation?.preview).toBeUndefined();
  });

  it("builds tree previews from structured tree output entries", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "tree",
      output: JSON.stringify({
        output: JSON.stringify({
          root: "C:\\Proyectos\\Sequel\\kiln",
          entries: [
            { name: "docs", type: "directory", depth: 1 },
            { name: "architecture.md", type: "file", depth: 2 },
          ],
          entryCount: 2,
          truncated: false,
        }, null, 2),
        isError: false,
        metadata: {
          toolName: "tree",
          kind: "inspection",
          operation: "tree",
          path: "C:\\Proyectos\\Sequel\\kiln",
          entryCount: 2,
          verbosity: "structured",
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.toolPresentation?.preview).toEqual({
      text: ".\ndocs/\n  architecture.md",
    });
  });

  it("projects patch results as first-class diff presentations", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "patch",
      outputSummary: JSON.stringify({
        output: "1 file changed, 18 additions, 6 removals",
        isError: false,
        metadata: {
          toolName: "patch",
          kind: "file",
          operation: "patch",
          filePath: "packages/gui/src/components/transcript.tsx",
          fileCount: 1,
          linesAdded: 18,
          linesRemoved: 6,
          diffPreview: "@@ ToolEventDetails @@\n- raw json\n+ typed preview",
          diffTruncated: true,
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "diff",
      title: "packages/gui/src/components/transcript.tsx",
      summary: "1 file changed, 18 additions, 6 removals",
      raw: { available: false },
    });
    expect(presentation.toolPresentation?.fields).toEqual(expect.arrayContaining([
      { label: "Files", value: "1" },
      { label: "Additions", value: "18" },
      { label: "Removals", value: "6" },
    ]));
    expect(presentation.toolPresentation?.preview).toEqual({
      text: "@@ ToolEventDetails @@\n- raw json\n+ typed preview",
      truncated: true,
    });
  });

  it("projects high-volume resource linked outputs without exposing raw packets inline", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "read_many",
      outputSummary: JSON.stringify({
        output: "--- C:\\Proyectos\\Sequel\\kiln\\docs\\architecture.md\n# Kiln Architecture",
        isError: false,
        metadata: {
          toolName: "read_many",
          kind: "file",
          operation: "read_many",
          fileCount: 24,
          skippedCount: 109,
          totalBytes: 200000,
          truncated: true,
          resourceLinks: [
            {
              uri: "kiln://artifacts/tool-results/artifact_1/content",
              title: "read_many full output",
              mimeType: "text/plain",
              size: 200000,
              relation: "full_output",
            },
          ],
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("24 files read, 109 skipped, 200000 bytes, truncated");
    expect(presentation.summary).not.toContain("--- C:");
    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "resource_links",
      title: "read_many full output",
      summary: "24 files read, 109 skipped, 200000 bytes, truncated",
    });
    expect(presentation.toolPresentation?.resourceLinks).toEqual([
      expect.objectContaining({
        uri: "kiln://artifacts/tool-results/artifact_1/content",
        title: "read_many full output",
      }),
    ]);
    expect(presentation.toolPresentation?.raw).toEqual({
      available: true,
      resourceUri: "kiln://artifacts/tool-results/artifact_1/content",
    });
  });

  it("does not invent raw availability or diff previews for write summaries", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "write",
      output: JSON.stringify({
        output: "Wrote 9 characters to C:\\Proyectos\\Sequel\\kiln\\example.txt",
        isError: false,
        metadata: {
          toolName: "write",
          kind: "file",
          operation: "write",
          filePath: "C:\\Proyectos\\Sequel\\kiln\\example.txt",
          bytesWritten: 9,
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "diff",
      title: "C:\\Proyectos\\Sequel\\kiln\\example.txt",
      raw: { available: false },
    });
    expect(presentation.toolPresentation?.preview).toBeUndefined();
  });

  it("projects write diff evidence when the canonical payload carries it", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "write",
      output: JSON.stringify({
        output: "Wrote 9 characters to C:\\Proyectos\\Sequel\\kiln\\example.txt",
        isError: false,
        metadata: {
          toolName: "write",
          kind: "file",
          operation: "write",
          filePath: "C:\\Proyectos\\Sequel\\kiln\\example.txt",
          changeType: "modified",
          bytesWritten: 9,
          linesAdded: 1,
          linesRemoved: 1,
          diffPreview: "- old text\n+ new text",
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "diff",
      summary: "1 file changed, 1 addition, 1 removal",
      preview: {
        text: "- old text\n+ new text",
      },
    });
    expect(presentation.toolPresentation?.preview?.text).not.toContain("Wrote 9 characters");
  });

  it("projects edit diff evidence instead of generic edit summaries", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "edit",
      output: JSON.stringify({
        output: "Applied 1 replacement in C:\\Proyectos\\Sequel\\kiln\\im_alive.txt",
        isError: false,
        metadata: {
          toolName: "edit",
          kind: "file",
          operation: "edit",
          filePath: "C:\\Proyectos\\Sequel\\kiln\\im_alive.txt",
          changeType: "modified",
          replacements: 1,
          linesAdded: 1,
          linesRemoved: 1,
          diffPreview: "- im alive\n+ im alive and testing diff",
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("1 file changed, 1 addition, 1 removal");
    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "diff",
      title: "C:\\Proyectos\\Sequel\\kiln\\im_alive.txt",
      preview: {
        text: "- im alive\n+ im alive and testing diff",
      },
    });
  });

  it("projects stat metadata without exposing JSON braces inline", () => {
    const presentation = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "stat",
      output: JSON.stringify({
        output: JSON.stringify({
          path: "C:\\Proyectos\\Sequel\\kiln\\im_alive.txt",
          type: "file",
          size: 25,
          modifiedTime: "2026-04-30T12:33:05.305Z",
        }, null, 2),
        isError: false,
        metadata: {
          toolName: "stat",
          kind: "inspection",
          operation: "stat",
          path: "C:\\Proyectos\\Sequel\\kiln\\im_alive.txt",
          type: "file",
          size: 25,
          modifiedTime: "2026-04-30T12:33:05.305Z",
          hashAlgorithm: "none",
        },
      }),
      status: { state: "succeeded" },
    });

    expect(presentation.summary).toBe("file · 25 bytes");
    expect(presentation.summary).not.toContain("{");
    expect(presentation.toolPresentation).toMatchObject({
      outputKind: "text",
      title: "C:\\Proyectos\\Sequel\\kiln\\im_alive.txt",
      summary: "file · 25 bytes",
    });
    expect(presentation.toolPresentation?.fields).toEqual(expect.arrayContaining([
      { label: "Type", value: "file" },
      { label: "Size", value: "25 bytes" },
    ]));
    expect(presentation.toolPresentation?.preview).toBeUndefined();
  });

  it("projects OCR text and backend errors without JSON previews", () => {
    const success = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-1",
      toolName: "ocr_image",
      output: JSON.stringify({
        output: JSON.stringify({
          path: "C:\\Proyectos\\Sequel\\kiln\\docs\\image.png",
          mimeType: "image/png",
          language: "eng",
          text: "HELLO",
          source: "tesseract",
        }, null, 2),
        isError: false,
        metadata: {
          toolName: "ocr_image",
          kind: "media",
          operation: "ocr",
          path: "C:\\Proyectos\\Sequel\\kiln\\docs\\image.png",
          mimeType: "image/png",
          language: "eng",
          textLength: 5,
          source: "tesseract",
        },
      }),
      status: { state: "succeeded" },
    });

    expect(success.summary).toBe("HELLO");
    expect(success.toolPresentation?.preview).toEqual({ text: "HELLO" });
    expect(success.toolPresentation?.preview?.text).not.toContain("{");

    const failure = presentOperatorEventPayload("tool_call_completed", {
      toolCallId: "tool-2",
      toolName: "ocr_image",
      output: "OCR backend unavailable: tesseract executable was not found on PATH.",
      status: { state: "failed" },
    });

    expect(failure.summary).toBe("OCR backend unavailable: tesseract executable was not found on PATH.");
    expect(failure.summary).not.toContain("{");
  });
});
