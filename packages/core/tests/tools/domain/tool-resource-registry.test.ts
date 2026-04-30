import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDefaultBuiltinToolSurface } from "../../../src/tools/default-tool-surface.js";
import { ToolResourceRegistry } from "../../../src/tools/domain/tool-resource-registry.js";
import { MemoryArtifactResourceStore } from "../../../src/tools/infrastructure/artifact-resource-store.js";
import { makeSandbox, makeTempDir, removeTempDir } from "../infrastructure/test-utils.js";

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
      "kiln://artifacts/{namespace}",
      "kiln://artifacts/{namespace}/{id}",
      "kiln://artifacts/{namespace}/{id}/content",
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
    const thirdPage = surface.resources.listTemplatePage({ cursor: secondPage.nextCursor, limit: 3 });

    expect(firstPage.items.map((template) => template.uriTemplate)).toEqual([
      "kiln://tools/catalog/{name}",
    ]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(secondPage.items.map((template) => template.uriTemplate)).toEqual([
      "kiln://session/tasks/{id}",
      "kiln://session/monitors/{id}",
    ]);
    expect(secondPage.nextCursor).toEqual(expect.any(String));
    expect(thirdPage.items.map((template) => template.uriTemplate)).toEqual([
      "kiln://artifacts/{namespace}",
      "kiln://artifacts/{namespace}/{id}",
      "kiln://artifacts/{namespace}/{id}/content",
    ]);
    expect(thirdPage.nextCursor).toBeUndefined();
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

  it("exposes workspace resource templates only when a workspace root is configured", async () => {
    const tempDir = await makeTempDir();
    try {
      const defaultSurface = createDefaultBuiltinToolSurface();
      const workspaceSurface = createDefaultBuiltinToolSurface({
        workspaceResources: { rootPath: tempDir },
      });

      expect(defaultSurface.resources.listTemplates().map((template) => template.uriTemplate)).not.toContain(
        "kiln://workspace/file/{path}",
      );
      expect(workspaceSurface.resources.list().map((resource) => resource.uri)).toContain("kiln://workspace/tree");
      expect(workspaceSurface.resources.listTemplates().map((template) => template.uriTemplate)).toEqual([
        "kiln://tools/catalog/{name}",
        "kiln://session/tasks/{id}",
        "kiln://session/monitors/{id}",
        "kiln://workspace/tree{?path,depth,includeFiles}",
        "kiln://workspace/file/{path}",
        "kiln://workspace/preview/{path}{?offset,limit}",
        "kiln://artifacts/{namespace}",
        "kiln://artifacts/{namespace}/{id}",
        "kiln://artifacts/{namespace}/{id}/content",
      ]);
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("does not expose workspace resources when policy denies root reads", async () => {
    const tempDir = await makeTempDir();
    try {
      const sandbox = makeSandbox(tempDir, { fsPolicy: "none" });
      const surface = createDefaultBuiltinToolSurface({
        workspaceResources: { rootPath: tempDir, pathValidator: sandbox.pathValidator },
      });

      expect(surface.resources.list().map((resource) => resource.uri)).not.toContain("kiln://workspace/tree");
      expect(surface.resources.listTemplates().map((template) => template.uriTemplate)).not.toContain(
        "kiln://workspace/file/{path}",
      );
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("reads workspace text files through stable workspace-relative URIs", async () => {
    const tempDir = await makeTempDir();
    try {
      await mkdir(join(tempDir, "notes"), { recursive: true });
      await writeFile(join(tempDir, "notes", "Caso Águila.txt"), "alpha\nbeta\ngamma\n", "utf8");
      const surface = createDefaultBuiltinToolSurface({
        workspaceResources: { rootPath: tempDir },
      });

      const result = await surface.resources.read(`kiln://workspace/file/${encodeWorkspacePath("notes/Caso Águila.txt")}`);

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]).toMatchObject({
        uri: `kiln://workspace/file/${encodeWorkspacePath("notes/Caso Águila.txt")}`,
        mimeType: "text/plain",
        text: "alpha\nbeta\ngamma\n",
        _meta: {
          path: "notes/Caso Águila.txt",
          type: "file",
          binary: false,
          truncated: false,
        },
      });
      expect(result.contents[0]!._meta?.["absolutePath"]).toBeUndefined();
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("returns bounded workspace previews with truncation metadata", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "server.log"), "zero\none\ntwo\nthree\n", "utf8");
      const surface = createDefaultBuiltinToolSurface({
        workspaceResources: { rootPath: tempDir },
      });

      const result = await surface.resources.read("kiln://workspace/preview/server.log?offset=1&limit=2");

      expect(result.contents[0]).toMatchObject({
        uri: "kiln://workspace/preview/server.log?offset=1&limit=2",
        mimeType: "text/plain",
        text: "one\ntwo",
        _meta: {
          path: "server.log",
          offset: 1,
          limit: 2,
          totalLines: 5,
          truncated: true,
        },
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("returns metadata-only JSON for binary workspace files", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "evidence.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]));
      const surface = createDefaultBuiltinToolSurface({
        workspaceResources: { rootPath: tempDir },
      });

      const result = await surface.resources.read("kiln://workspace/file/evidence.png");
      const payload = JSON.parse(result.contents[0]!.text);

      expect(result.contents[0]).toMatchObject({
        uri: "kiln://workspace/file/evidence.png",
        mimeType: "application/json",
        _meta: {
          path: "evidence.png",
          mimeType: "image/png",
          binary: true,
          truncated: false,
        },
      });
      expect(payload).toMatchObject({
        path: "evidence.png",
        type: "file",
        mimeType: "image/png",
        binary: true,
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("reads deterministic bounded workspace tree snapshots", async () => {
    const tempDir = await makeTempDir();
    try {
      await mkdir(join(tempDir, "src"), { recursive: true });
      await mkdir(join(tempDir, "docs"), { recursive: true });
      await writeFile(join(tempDir, "zeta.txt"), "z", "utf8");
      await writeFile(join(tempDir, "src", "index.ts"), "export {};\n", "utf8");
      await writeFile(join(tempDir, "docs", "guide.md"), "# Guide\n", "utf8");
      const surface = createDefaultBuiltinToolSurface({
        workspaceResources: { rootPath: tempDir },
      });

      const result = await surface.resources.read("kiln://workspace/tree?path=.&depth=1&includeFiles=true");
      const payload = JSON.parse(result.contents[0]!.text);

      expect(payload.entries.map((entry: { path: string }) => entry.path)).toEqual([
        "docs",
        "src",
        "zeta.txt",
      ]);
      expect(payload).toMatchObject({
        root: ".",
        entryCount: 3,
        truncated: false,
      });
      expect(result.contents[0]!._meta).toMatchObject({
        path: ".",
        depth: 1,
        includeFiles: true,
        entryCount: 3,
        truncated: false,
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("rejects workspace resource traversal outside the configured root", async () => {
    const tempDir = await makeTempDir();
    try {
      const surface = createDefaultBuiltinToolSurface({
        workspaceResources: { rootPath: tempDir },
      });

      await expect(surface.resources.read("kiln://workspace/file/%2E%2E/secret.txt")).rejects.toThrow(
        "Workspace resource path escapes the configured root",
      );
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("projects configured artifact resources through the shared resource registry", async () => {
    const artifactStore = new MemoryArtifactResourceStore({
      now: () => "2026-04-29T18:00:00.000Z",
    });
    const artifact = artifactStore.put({
      namespace: "plans",
      title: "Slice 21",
      mimeType: "text/plain",
      content: { type: "text", text: "artifact content" },
      producer: { kind: "tool", name: "task_update" },
      retention: { scope: "session" },
    });
    const surface = createDefaultBuiltinToolSurface({
      artifactResources: { store: artifactStore },
    });

    expect(surface.resources.list().map((resource) => resource.uri)).toContain("kiln://artifacts/plans");
    expect(surface.resources.listTemplates().map((template) => template.uriTemplate)).toContain(
      "kiln://artifacts/{namespace}/{id}/content",
    );
    const result = await surface.resources.read(`kiln://artifacts/plans/${artifact.id}/content`);
    expect(result.contents[0]).toMatchObject({
      uri: `kiln://artifacts/plans/${artifact.id}/content`,
      mimeType: "text/plain",
      text: "artifact content",
    });
  });
});

function decodeTestCursor(cursor: string | undefined): Record<string, unknown> {
  expect(cursor).toEqual(expect.any(String));
  return JSON.parse(Buffer.from(cursor!, "base64url").toString("utf8")) as Record<string, unknown>;
}

function encodeTestCursor(cursor: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function encodeWorkspacePath(path: string): string {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}
