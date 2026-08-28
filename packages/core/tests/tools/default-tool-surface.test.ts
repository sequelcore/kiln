import { describe, expect, it } from "vitest";
import {
  createSessionBuiltinToolOptions,
  createDefaultBuiltinToolRegistry,
  createDefaultBuiltinToolSurface,
} from "../../src/tools/default-tool-surface.js";
import {
  createDefaultBuiltinToolSurface as createDefaultBuiltinToolSurfaceFromBarrel,
  ArtifactToolResourceLinker,
  fileToolMetadata,
  MemoryArtifactResourceStore,
  MonitorRegistry,
  projectDevToolSchemas,
  TaskStateStore,
} from "../../src/tools/index.js";
import type { MemoryMutationService } from "../../src/memory/service.js";
import { makeTempDir, removeTempDir } from "./infrastructure/test-utils.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ActionEffectEnvelope } from "../../src/engine/domain/action-effect.js";

const BUILTIN_TOOL_NAMES = [
  "bash",
  "read",
  "read_many",
  "write",
  "edit",
  "patch",
  "stat",
  "tree",
  "view_image",
  "ocr_image",
  "web_search",
  "web_fetch",
  "web_extract",
  "browser_session_start",
  "browser_navigate",
  "browser_observe",
  "browser_click",
  "browser_type",
  "browser_keypress",
  "browser_scroll",
  "browser_session_stop",
  "computer_observe",
  "computer_click",
  "computer_type",
  "computer_keypress",
  "computer_open_application",
  "computer_focus_application",
  "computer_minimize_application",
  "computer_close_application",
  "grep",
  "glob",
  "json_query",
  "git",
  "code_intelligence",
  "monitor_start",
  "monitor_read",
  "monitor_stop",
  "monitor_list",
  "task_list",
  "task_update",
  "operator_elicit",
  "tool_catalog_search",
  "memory_search",
  "memory_save",
  "resource_list",
  "resource_template_list",
  "resource_read",
];

const READ_ONLY_EFFECT: ActionEffectEnvelope = {
  operation: "observe",
  boundaries: ["process", "workspace"],
  reversibility: "reversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: [],
  idempotency: "idempotent",
};

function createAuthorityAwareMemoryMutationService(authority: { canWriteMemory?: boolean } | undefined) {
  return {
    saveRecord(input: {
      readonly id?: string;
      readonly layer: string;
      readonly scope: { readonly kind: string; readonly id: string };
    }) {
      if (authority?.canWriteMemory !== true) {
        const error = new Error("Memory write denied by authority policy");
        Object.assign(error, { code: "MEMORY_AUTHORIZATION_DENIED" });
        throw error;
      }
      return {
        id: input.id ?? "record_authorized",
        layer: input.layer,
        scope: input.scope,
      };
    },
  };
}

describe("default builtin tool surface", () => {
  it("registers quality_analyze only when a compiled profile is configured", () => {
    const absent = createDefaultBuiltinToolSurface({ toolProjection: { mode: "deferred" } });
    const configured = createDefaultBuiltinToolSurface({
      qualityAnalyze: {
        profiles: ["type-integrity", "complexity", "test-integrity"],
        analyzerVersion: "3.0.0-beta.1",
      },
      toolProjection: { mode: "deferred" },
    });
    expect(absent.registry.has("quality_analyze")).toBe(false);
    expect(configured.registry.has("quality_analyze")).toBe(true);
    expect(configured.toolNames).not.toContain("quality_analyze");
    expect(configured.bridge.listTools().map((tool) => tool.name)).toContain("quality_analyze");
  });

  it("projects one canonical builtin tool set into registry, names, definitions, capabilities, and execution bridge", () => {
    const surface = createDefaultBuiltinToolSurface();

    expect(surface.toolNames).toEqual(BUILTIN_TOOL_NAMES);
    expect(surface.tools.map((tool) => tool.name)).toEqual(BUILTIN_TOOL_NAMES);
    expect(surface.registry.list().map((tool) => tool.name)).toEqual(BUILTIN_TOOL_NAMES);
    expect(surface.toolDefinitions.map((tool) => tool.name)).toEqual(BUILTIN_TOOL_NAMES);
    expect(Array.from(surface.capabilities.keys())).toEqual(BUILTIN_TOOL_NAMES);
    expect(surface.bridge.listTools().map((tool) => tool.name)).toEqual(BUILTIN_TOOL_NAMES);
  });

  it("exports the canonical surface through the public tools barrel", () => {
    const surface = createDefaultBuiltinToolSurfaceFromBarrel();

    expect(surface.toolNames).toEqual(BUILTIN_TOOL_NAMES);
    expect(projectDevToolSchemas(surface.tools).map((tool) => tool.name)).toEqual(BUILTIN_TOOL_NAMES);
    expect(fileToolMetadata("write", {
      operation: "write",
      filePath: "x.txt",
      bytesWritten: 1,
    })).toMatchObject({
      toolName: "write",
      kind: "file",
    });
  });

  it("keeps projections aligned with the existing default registry helper", () => {
    const registry = createDefaultBuiltinToolRegistry();
    const surface = createDefaultBuiltinToolSurface();

    expect(surface.toolNames).toEqual(registry.list().map((tool) => tool.name));
    expect(surface.registry.list().map((tool) => tool.name)).toEqual(
      registry.list().map((tool) => tool.name),
    );
  });

  it("keeps session-scoped resource state readable across recreated surfaces", async () => {
    const options = createSessionBuiltinToolOptions();
    const firstSurface = createDefaultBuiltinToolSurface(options);
    const artifact = firstSurface.artifactStore.put({
      namespace: "tool-results",
      title: "read_many full output",
      mimeType: "text/plain",
      content: { type: "text", text: "linked output" },
      producer: { kind: "tool", name: "read_many" },
      retention: { scope: "session", maxArtifacts: 10 },
    });

    const secondSurface = createDefaultBuiltinToolSurface(options);

    await expect(
      secondSurface.resources.read(`kiln://artifacts/tool-results/${artifact.id}/content`),
    ).resolves.toMatchObject({
      contents: [{
        uri: `kiln://artifacts/tool-results/${artifact.id}/content`,
        mimeType: "text/plain",
        text: "linked output",
      }],
    });
  });

  it("creates fresh mutable containers for each surface", () => {
    const first = createDefaultBuiltinToolSurface();
    const second = createDefaultBuiltinToolSurface();

    expect(first.tools).not.toBe(second.tools);
    expect(first.registry).not.toBe(second.registry);
    expect(first.toolDefinitions).not.toBe(second.toolDefinitions);
    expect(first.capabilities).not.toBe(second.capabilities);
    expect(first.bridge).not.toBe(second.bridge);
    expect(first.monitorRegistry).not.toBe(second.monitorRegistry);
    expect(first.taskStateStore).not.toBe(second.taskStateStore);
    expect(first.resources).not.toBe(second.resources);
  });

  it("can receive an owned monitor registry for session teardown", () => {
    const monitorRegistry = new MonitorRegistry();
    const surface = createDefaultBuiltinToolSurface({ monitorRegistry });

    expect(surface.monitorRegistry).toBe(monitorRegistry);
  });

  it("can receive an owned task state store for session progress projection", () => {
    const taskStateStore = new TaskStateStore();
    const surface = createDefaultBuiltinToolSurface({ taskStateStore });

    expect(surface.taskStateStore).toBe(taskStateStore);
  });

  it("exposes a read-only registry view", () => {
    const surface = createDefaultBuiltinToolSurface();

    expect(surface.registry.has("read")).toBe(true);
    expect(surface.registry.size).toBe(BUILTIN_TOOL_NAMES.length);
    expect("register" in surface.registry).toBe(false);
  });

  it("projects schemas and effect envelopes without sharing mutable nested references", () => {
    const first = createDefaultBuiltinToolSurface();
    const second = createDefaultBuiltinToolSurface();

    const firstReadDefinition = first.toolDefinitions.find((tool) => tool.name === "read");
    const secondReadDefinition = second.toolDefinitions.find((tool) => tool.name === "read");
    const firstReadCapability = first.capabilities.get("read");
    const secondReadCapability = second.capabilities.get("read");

    expect(firstReadDefinition?.inputSchema).not.toBe(secondReadDefinition?.inputSchema);
    expect(firstReadDefinition?.outputSchema).not.toBe(secondReadDefinition?.outputSchema);
    expect(firstReadCapability?.schema).not.toBe(secondReadCapability?.schema);
    expect(firstReadCapability?.outputSchema).not.toBe(secondReadCapability?.outputSchema);
    expect(firstReadCapability?.effectEnvelope).toEqual(secondReadCapability?.effectEnvelope);

    const firstSchema = firstReadDefinition?.inputSchema as {
      properties: { filePath: { description: string } };
    };
    firstSchema.properties.filePath.description = "mutated";
    (firstReadDefinition?.outputSchema as {
      properties: { result: { properties: { output: { type: string } } } };
    }).properties.result.properties.output.type = "number";

    expect(
      (secondReadDefinition?.inputSchema as {
        properties: { filePath: { description: string } };
      }).properties.filePath.description,
    ).not.toBe("mutated");
    expect(
      (secondReadDefinition?.outputSchema as {
        properties: { result: { properties: { output: { type: string } } } };
      }).properties.result.properties.output.type,
    ).toBe("string");
  });

  it("projects a structured output schema for every builtin tool definition and capability", () => {
    const surface = createDefaultBuiltinToolSurface();

    for (const definition of surface.toolDefinitions) {
      expect(definition.outputSchema).toMatchObject({
        type: "object",
        required: ["result", "attempts", "fallbackUsed"],
        properties: {
          result: expect.objectContaining({
            type: "object",
            required: ["output", "isError"],
          }),
          attempts: expect.objectContaining({ type: "number" }),
          fallbackUsed: expect.objectContaining({ type: "boolean" }),
        },
      });
      expect(surface.capabilities.get(definition.name)?.outputSchema).toEqual(definition.outputSchema);
    }
  });

  it("executes through the canonical bridge", async () => {
    const surface = createDefaultBuiltinToolSurface();

    await expect(surface.bridge.execute({
      name: "read",
      input: { filePath: "__missing__.txt" },
    })).resolves.toMatchObject({
      attempts: 1,
      fallbackUsed: false,
      result: {
        isError: true,
        output: expect.stringContaining("__missing__.txt"),
      },
    });
  });

  it("exposes a catalog index over the canonical builtin tool registry", () => {
    const surface = createDefaultBuiltinToolSurface();

    expect(surface.catalog.search({ exact: "read" })).toMatchObject({
      totalIndexed: BUILTIN_TOOL_NAMES.length,
      entries: [
        {
          name: "read",
          sourcePackage: "@kilnai/core",
          authority: "read_only",
          inputFields: ["filePath", "offset", "limit"],
        },
      ],
    });
    expect(surface.catalog.search({ query: "directory tree", limit: 1 }).entries[0]?.name).toBe("tree");
  });

  it("exposes a resource registry over the same catalog and session stores", async () => {
    const surface = createDefaultBuiltinToolSurface();
    surface.taskStateStore.update({ title: "resource state", status: "pending" });

    expect(surface.resources.list().map((resource) => resource.uri)).toEqual([
      "kiln://tools/catalog",
      "kiln://session/tasks",
      "kiln://session/monitors",
    ]);
    await expect(surface.resources.read("kiln://session/tasks")).resolves.toMatchObject({
      contents: [{
        uri: "kiln://session/tasks",
        mimeType: "application/json",
        text: expect.stringContaining("resource state"),
      }],
    });
    await expect(surface.bridge.execute({
      name: "resource_read",
      input: { uri: "kiln://session/tasks" },
    })).resolves.toMatchObject({
      attempts: 1,
      fallbackUsed: false,
      result: {
        isError: false,
        output: expect.stringContaining("resource state"),
        metadata: expect.objectContaining({
          toolName: "resource_read",
          kind: "resource",
          operation: "read",
          uri: "kiln://session/tasks",
          contentCount: 1,
        }),
      },
    });
  });

  it("returns a structured tool error when authority denies memory_save", async () => {
    const surface = createDefaultBuiltinToolSurface({
      memoryMutations: {
        callerContext: { authority: { canWriteMemory: false } },
        createService: ({ callerContext }) => createAuthorityAwareMemoryMutationService(
          callerContext.authority as { canWriteMemory?: boolean } | undefined,
        ) as unknown as MemoryMutationService,
      },
    });
    const result = await surface.bridge.execute({
      name: "memory_save",
      input: {
        layer: "semantic",
        scopeKind: "project",
        scopeId: "kiln",
        content: "Denied save should return structured tool metadata.",
        provenance: {
          sourceType: "operator",
          sourceId: "default-tool-surface-test-denied",
          actor: "test",
        },
      },
    });

    expect(result.result.isError).toBe(true);
    expect(result.result.output).toContain("denied");
    expect(result.result.metadata).toMatchObject({
      toolName: "memory_save",
      kind: "memory",
      operation: "save",
      errorCode: "repository_error",
      scopeKind: "project",
      scopeId: "kiln",
      layer: "semantic",
    });
  });

  it("saves governed memory through the mutation service when caller authority is granted", async () => {
    const surface = createDefaultBuiltinToolSurface({
      memoryMutations: {
        callerContext: { authority: { canWriteMemory: true } },
        createService: ({ callerContext }) => createAuthorityAwareMemoryMutationService(
          callerContext.authority as { canWriteMemory?: boolean } | undefined,
        ) as unknown as MemoryMutationService,
      },
    });
    const result = await surface.bridge.execute({
      name: "memory_save",
      input: {
        layer: "semantic",
        scopeKind: "project",
        scopeId: "kiln",
        content: "Gateway MCP reads memory through resource tools.",
        topicKey: "memory-lattice-gateway-mcp",
        tags: ["memory-lattice", "mcp"],
        provenance: {
          sourceType: "operator",
          sourceId: "default-tool-surface-test",
          actor: "test",
        },
      },
    });

    expect(result.result.isError).toBe(false);
    const saved = JSON.parse(result.result.output) as {
      id: string;
      layer: string;
      scope: { kind: string; id: string };
      resourceUri: string;
    };
    expect(saved.id).toBe("record_authorized");
    expect(saved.layer).toBe("semantic");
    expect(saved.scope).toEqual({ kind: "project", id: "kiln" });
    expect(saved.resourceUri).toBe("kiln://memory/nodes/record_authorized");
  });

  it("stores high-volume tool output as an artifact resource link through the canonical bridge", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "large.txt"), "alpha\n".repeat(2_000), "utf8");
      const surface = createDefaultBuiltinToolSurface();

      const result = await surface.bridge.execute({
        name: "read_many",
        input: {
          paths: [join(tempDir, "large.txt")],
          maxBytes: 20_000,
        },
      });

      const link = result.result.metadata?.resourceLinks?.[0];
      const linkUri = link?.uri;
      expect(linkUri).toEqual(expect.stringMatching(/^kiln:\/\/artifacts\/tool-results\/artifact_\d+\/content$/));
      expect(link).toMatchObject({
        uri: linkUri,
        relation: "full_output",
        mimeType: "text/plain",
        title: "read_many full output",
      });
      expect(result.result.content).toContainEqual(expect.objectContaining({
        type: "resource_link",
        uri: linkUri,
        name: "read_many full output",
        mimeType: "text/plain",
      }));

      const artifact = await surface.resources.read(linkUri!);
      expect(artifact.contents[0]).toMatchObject({
        uri: linkUri,
        mimeType: "text/plain",
        text: expect.stringContaining("---"),
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("links large bash output without storing full streams in metadata", async () => {
    const largeOutput = "alpha\n".repeat(2_000);
    const surface = createDefaultBuiltinToolSurface({
      bash: {
        commandRunner: async () => ({
          stdout: largeOutput,
          stderr: "",
        }),
      },
    });

    const result = await surface.bridge.execute({
      name: "bash",
      input: { command: "pwd" },
    });

    const link = result.result.metadata?.resourceLinks?.[0];
    const linkUri = link?.uri;
    expect(linkUri).toEqual(expect.stringMatching(/^kiln:\/\/artifacts\/tool-results\/artifact_\d+\/content$/));
    expect(link).toMatchObject({
      uri: linkUri,
      relation: "full_output",
      mimeType: "text/plain",
      title: "bash full output",
    });
    if (result.result.metadata?.kind !== "command") throw new Error("expected command metadata");
    expect(result.result.metadata.stdoutBytes).toBe(Buffer.byteLength(largeOutput));
    expect(result.result.metadata.stdoutTruncated).toBe(true);
    expect(Buffer.byteLength(String(result.result.metadata.stdout ?? ""), "utf8")).toBeLessThanOrEqual(8 * 1024);

    const artifact = await surface.resources.read(linkUri!);
    const artifactText = artifact.contents[0] && "text" in artifact.contents[0]
      ? artifact.contents[0].text
      : "";
    expect(artifactText).toBe(largeOutput.trim().slice(0, artifactText.length));
    expect(link?.size).toBe(Buffer.byteLength(largeOutput.trim()));
  });

  it("stores large read output as an artifact resource link", async () => {
    const tempDir = await makeTempDir();
    try {
      const filePath = join(tempDir, "transcript.jsonl");
      const content = "{\"event\":\"tool_call_completed\",\"payload\":\"large\"}\n".repeat(400);
      await writeFile(filePath, content, "utf8");
      const surface = createDefaultBuiltinToolSurface();

      const result = await surface.bridge.execute({
        name: "read",
        input: { filePath },
      });

      const link = result.result.metadata?.resourceLinks?.[0];
      expect(link).toMatchObject({
        relation: "full_output",
        mimeType: "text/plain",
        title: "read full output",
      });

      const artifact = await surface.resources.read(link!.uri);
      const artifactText = artifact.contents[0] && "text" in artifact.contents[0]
        ? artifact.contents[0].text
        : "";
      expect(artifactText).toContain("\"tool_call_completed\"");
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("links browser session stop recorder proof payloads as session artifacts", () => {
    const store = new MemoryArtifactResourceStore();
    const linker = new ArtifactToolResourceLinker({ store });

    const result = linker.link({
      toolName: "browser_session_stop",
      input: {},
      result: {
        output: "Stopped Playwright browser session browser-1. Recorder video: kiln://artifacts/video/content",
        isError: false,
        metadata: {
          toolName: "browser_session_stop",
          kind: "interactive",
          target: "browser",
          operation: "session_stop",
        } as never,
        resourcePayload: {
          title: "Recorder browser video proof",
          mimeType: "application/json",
          text: "{\"video\":{\"exportUri\":\"kiln://artifacts/video/content\"}}",
        },
      },
    });

    const link = result.metadata?.resourceLinks?.[0];
    expect(result).not.toHaveProperty("resourcePayload");
    expect(link).toMatchObject({
      relation: "full_output",
      mimeType: "application/json",
      title: "Recorder browser video proof",
    });
    expect(result.content).toContainEqual(expect.objectContaining({
      type: "resource_link",
      uri: link?.uri,
      mimeType: "application/json",
    }));
  });

  it("stores full read_many payloads in resource links even when visible output is summary", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "summary.txt"), "important context\n".repeat(100), "utf8");
      const surface = createDefaultBuiltinToolSurface();

      const result = await surface.bridge.execute({
        name: "read_many",
        input: {
          paths: [join(tempDir, "summary.txt")],
          maxBytes: 120,
          verbosity: "summary",
        },
      });

      expect(result.result.output).toBe("1 file read, 0 skipped, 120 bytes (truncated)");
      expect(result.result).not.toHaveProperty("resourcePayload");
      const link = result.result.metadata?.resourceLinks?.[0];
      const linkUri = link?.uri;
      expect(link).toMatchObject({
        relation: "full_output",
        mimeType: "text/plain",
        title: "read_many full output",
      });

      const artifact = await surface.resources.read(linkUri!);
      const artifactText = artifact.contents[0] && "text" in artifact.contents[0]
        ? artifact.contents[0].text
        : "";
      expect(artifact.contents[0]).toMatchObject({
        uri: linkUri,
        mimeType: "text/plain",
        text: expect.stringContaining("---"),
      });
      expect(artifactText).toContain("important context");
      expect(artifactText).not.toBe(result.result.output);
      expect(link?.size).toBeGreaterThan(result.result.output.length);
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("supports deferred projection while keeping the canonical registry executable", async () => {
    const surface = createDefaultBuiltinToolSurface({
      toolProjection: {
        mode: "deferred",
        alwaysOnTools: ["read"],
      },
    });

    const projectedTools = [
      "read",
      "tool_catalog_search",
      "memory_search",
      "resource_list",
      "resource_template_list",
      "resource_read",
    ];
    expect(surface.toolNames).toEqual(projectedTools);
    expect(surface.tools.map((tool) => tool.name)).toEqual(projectedTools);
    expect(surface.toolDefinitions.map((tool) => tool.name)).toEqual(projectedTools);
    expect(Array.from(surface.capabilities.keys())).toEqual(projectedTools);
    expect(surface.registry.has("glob")).toBe(true);
    expect(surface.registry.has("read_many")).toBe(true);
    expect(surface.registry.has("code_intelligence")).toBe(true);
    expect(surface.registry.has("monitor_start")).toBe(true);
    expect(surface.registry.has("task_update")).toBe(true);
    expect(surface.registry.has("operator_elicit")).toBe(true);
    expect(surface.registry.has("memory_search")).toBe(true);
    expect(surface.registry.has("resource_read")).toBe(true);
    expect(surface.bridge.listTools().map((tool) => tool.name)).toEqual(BUILTIN_TOOL_NAMES);

    await expect(surface.bridge.execute({
      name: "tool_catalog_search",
      input: { exact: "glob", verbosity: "structured" },
    })).resolves.toMatchObject({
      attempts: 1,
      fallbackUsed: false,
      result: {
        isError: false,
        metadata: expect.objectContaining({
          toolName: "tool_catalog_search",
          kind: "catalog",
          operation: "search",
          exact: "glob",
          resultCount: 1,
          totalIndexed: BUILTIN_TOOL_NAMES.length,
        }),
      },
    });
  });

  it("admits only explicitly requested surface-owned tools in deferred projection", async () => {
    const surface = createDefaultBuiltinToolSurface({
      additionalTools: [
        {
          name: "kiln_config.read",
          description: "Read config.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          effectEnvelope: READ_ONLY_EFFECT,
          execute: async () => ({ output: "{}", isError: false }),
        },
        {
          name: "kiln_config.apply_change",
          description: "Apply config.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          execute: async () => ({ output: "applied", isError: false }),
        },
      ],
      toolProjection: {
        mode: "deferred",
        alwaysOnTools: ["read", "kiln_config.read"],
      },
    });

    expect(surface.toolNames).toContain("kiln_config.read");
    expect(surface.toolNames).not.toContain("kiln_config.apply_change");
    expect(surface.registry.has("kiln_config.read")).toBe(true);
    expect(surface.registry.has("kiln_config.apply_change")).toBe(true);
    await expect(surface.bridge.execute({
      name: "kiln_config.read",
      input: {},
    })).resolves.toMatchObject({
      attempts: 1,
      fallbackUsed: false,
      result: {
        output: "{}",
        isError: false,
      },
    });
  });

  it("makes a strict projection the complete executable registry boundary", async () => {
    const surface = createDefaultBuiltinToolSurface({
      toolProjection: {
        mode: "strict",
        alwaysOnTools: ["read", "write", "edit", "patch"],
      },
    });

    expect(surface.toolNames).toEqual(["read", "write", "edit", "patch"]);
    expect(surface.registry.list().map((tool) => tool.name)).toEqual(["read", "write", "edit", "patch"]);
    expect(surface.registry.size).toBe(4);
    expect(surface.registry.has("bash")).toBe(false);
    expect(surface.registry.lookup("tool_catalog_search")).toBeUndefined();
    await expect(surface.bridge.execute({
      name: "bash",
      input: { command: "echo should-not-run" },
    })).rejects.toThrow(/not found|unknown|not registered/i);
  });
});
