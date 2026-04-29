import { describe, expect, it } from "vitest";
import { createDefaultBuiltinToolSurface } from "../../../src/tools/default-tool-surface.js";
import { ToolResourceRegistry } from "../../../src/tools/domain/tool-resource-registry.js";

describe("ToolResourceRegistry", () => {
  it("lists stable read-only resources and templates from the shared tool surface", () => {
    const surface = createDefaultBuiltinToolSurface();

    expect(surface.resources).toBeInstanceOf(ToolResourceRegistry);
    expect(surface.resources.list().map((resource) => resource.uri)).toEqual([
      "kiln://tools/catalog",
      "kiln://session/tasks",
      "kiln://session/monitors",
    ]);
    expect(surface.resources.listTemplates().map((template) => template.uriTemplate)).toEqual([
      "kiln://tools/catalog/{name}",
      "kiln://session/tasks/{id}",
      "kiln://session/monitors/{id}",
    ]);
  });

  it("paginates resources with opaque cursors while preserving no-arg listing", () => {
    const surface = createDefaultBuiltinToolSurface();

    const firstPage = surface.resources.listPage({ limit: 2 });
    const secondPage = surface.resources.listPage({ cursor: firstPage.nextCursor, limit: 2 });

    expect(surface.resources.list().map((resource) => resource.uri)).toEqual([
      "kiln://tools/catalog",
      "kiln://session/tasks",
      "kiln://session/monitors",
    ]);
    expect(firstPage.items.map((resource) => resource.uri)).toEqual([
      "kiln://tools/catalog",
      "kiln://session/tasks",
    ]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(firstPage.nextCursor).not.toBe("2");
    expect(secondPage.items.map((resource) => resource.uri)).toEqual([
      "kiln://session/monitors",
    ]);
    expect(secondPage.nextCursor).toBeUndefined();
  });

  it("paginates resource templates with their own cursor namespace", () => {
    const surface = createDefaultBuiltinToolSurface();

    const firstPage = surface.resources.listTemplatePage({ limit: 1 });
    const secondPage = surface.resources.listTemplatePage({ cursor: firstPage.nextCursor, limit: 2 });

    expect(firstPage.items.map((template) => template.uriTemplate)).toEqual([
      "kiln://tools/catalog/{name}",
    ]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(secondPage.items.map((template) => template.uriTemplate)).toEqual([
      "kiln://session/tasks/{id}",
      "kiln://session/monitors/{id}",
    ]);
    expect(secondPage.nextCursor).toBeUndefined();
  });

  it("rejects invalid, stale, and out-of-range pagination cursors", () => {
    const surface = createDefaultBuiltinToolSurface();
    const resourceCursor = surface.resources.listPage({ limit: 1 }).nextCursor;
    const templateCursor = surface.resources.listTemplatePage({ limit: 1 }).nextCursor;
    const outOfRangeCursor = encodeTestCursor({
      ...decodeTestCursor(resourceCursor),
      offset: 999,
    });

    expect(() => surface.resources.listPage({ cursor: "not-a-cursor", limit: 1 })).toThrow("Invalid resource cursor");
    expect(() => surface.resources.listPage({ cursor: templateCursor, limit: 1 })).toThrow("Stale resource cursor");
    expect(() => surface.resources.listPage({ cursor: outOfRangeCursor, limit: 1 })).toThrow("Out-of-range resource cursor");
  });

  it("rejects non-positive pagination limits", () => {
    const surface = createDefaultBuiltinToolSurface();

    expect(() => surface.resources.listPage({ limit: 0 })).toThrow("Invalid resource page limit");
    expect(() => surface.resources.listTemplatePage({ limit: 0.5 })).toThrow("Invalid resource page limit");
  });

  it("reads the tool catalog as a JSON resource", async () => {
    const surface = createDefaultBuiltinToolSurface();

    const result = await surface.resources.read("kiln://tools/catalog");

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]).toMatchObject({
      uri: "kiln://tools/catalog",
      mimeType: "application/json",
    });
    const payload = JSON.parse(result.contents[0]!.text);
    expect(payload.totalIndexed).toBe(24);
    expect(payload.entries.map((entry: { name: string }) => entry.name)).toContain("operator_elicit");
  });

  it("reads individual tool catalog entries through the catalog template", async () => {
    const surface = createDefaultBuiltinToolSurface();

    const result = await surface.resources.read("kiln://tools/catalog/read_many");

    const payload = JSON.parse(result.contents[0]!.text);
    expect(payload).toMatchObject({
      name: "read_many",
      sourcePackage: "@kilnai/core",
      authority: "read_only",
    });
    expect(payload.inputFields).toContain("paths");
  });

  it("projects shared task state through resources without mutating it", async () => {
    const surface = createDefaultBuiltinToolSurface();
    surface.taskStateStore.update({
      title: "Document Slice 18",
      status: "in_progress",
      details: "resource projection",
    });

    const listResult = await surface.resources.read("kiln://session/tasks");
    const taskResult = await surface.resources.read("kiln://session/tasks/task_1");

    expect(JSON.parse(listResult.contents[0]!.text)).toMatchObject({
      sequence: 1,
      tasks: [{ id: "task_1", status: "in_progress", title: "Document Slice 18" }],
    });
    expect(JSON.parse(taskResult.contents[0]!.text)).toMatchObject({
      id: "task_1",
      status: "in_progress",
      title: "Document Slice 18",
    });
  });

  it("projects monitor snapshots and events through resources", async () => {
    const surface = createDefaultBuiltinToolSurface({
      monitor: {
        commandRunner: {
          start: (_request, sink) => {
            sink.stdout("ready\n");
            sink.finish({ exitCode: 0 });
            return { stop: async () => undefined };
          },
        },
        now: () => 1_800_000_000_000,
      },
    });
    const started = surface.monitorRegistry.start({
      command: "echo ready",
      cwd: "C:/workspace",
      timeoutMs: 60_000,
    });

    const listResult = await surface.resources.read("kiln://session/monitors");
    const monitorResult = await surface.resources.read(`kiln://session/monitors/${started.id}`);

    expect(JSON.parse(listResult.contents[0]!.text)).toEqual({
      monitors: [expect.objectContaining({ id: started.id, status: "exited" })],
    });
    expect(JSON.parse(monitorResult.contents[0]!.text)).toMatchObject({
      snapshot: { id: started.id, status: "exited" },
      events: [
        { stream: "stdout", text: "ready\n" },
        { stream: "lifecycle" },
      ],
    });
  });

  it("fails missing dynamic resources explicitly", async () => {
    const surface = createDefaultBuiltinToolSurface();

    await expect(surface.resources.read("kiln://session/tasks/missing")).rejects.toThrow("Resource not found");
  });
});

function decodeTestCursor(cursor: string | undefined): Record<string, unknown> {
  expect(cursor).toEqual(expect.any(String));
  return JSON.parse(Buffer.from(cursor!, "base64url").toString("utf8")) as Record<string, unknown>;
}

function encodeTestCursor(cursor: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}
