import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { ChunkImporter } from "../../src/memory/chunk-importer.js";

function makeTempDir(): string {
  const dir = join(tmpdir(), `kiln-chunk-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const tempDirs: string[] = [];

function makeTestDir(): string {
  const dir = makeTempDir();
  tempDirs.push(dir);
  return dir;
}

function writeChunkFile(dir: string, lines: string[]): string {
  const content = lines.join("\n");
  const compressed = gzipSync(Buffer.from(content, "utf-8"));
  const hash = createHash("sha256").update(compressed).digest("hex");
  const filename = `${hash}.jsonl.gz`;
  writeFileSync(join(dir, filename), compressed);
  return filename;
}

function writeManifest(dir: string, chunks: Array<{ hash: string; entries: number }>): void {
  const manifest = {
    version: 1,
    chunks: chunks.map((c) => ({
      ...c,
      createdAt: new Date().toISOString(),
    })),
    deleted: [],
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

afterEach(() => {
  for (const d of tempDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe("ChunkImporter", () => {
  describe("discoverNewChunks", () => {
    it("finds untracked .jsonl.gz files", () => {
      const dir = makeTestDir();
      const filename = writeChunkFile(dir, ['{"id":"1","content":"hello"}']);
      // No manifest -- all chunks are new
      const importer = new ChunkImporter({ projectPath: dir });
      const newChunks = importer.discoverNewChunks();

      expect(newChunks).toHaveLength(1);
      expect(newChunks[0]).toBe(filename);
    });

    it("returns empty when all chunks tracked", () => {
      const dir = makeTestDir();
      const filename = writeChunkFile(dir, ['{"id":"1","content":"hello"}']);
      const hash = filename.replace(".jsonl.gz", "");
      writeManifest(dir, [{ hash, entries: 1 }]);

      const importer = new ChunkImporter({ projectPath: dir });
      const newChunks = importer.discoverNewChunks();

      expect(newChunks).toHaveLength(0);
    });

    it("returns empty for non-existent directory", () => {
      const dir = join(tmpdir(), `nonexistent-${randomUUID()}`);
      const importer = new ChunkImporter({ projectPath: dir });
      const newChunks = importer.discoverNewChunks();

      expect(newChunks).toHaveLength(0);
    });
  });

  describe("importChunks", () => {
    it("adds new chunks to manifest", () => {
      const dir = makeTestDir();
      const filename = writeChunkFile(dir, ['{"id":"1"}', '{"id":"2"}']);

      const importer = new ChunkImporter({ projectPath: dir });
      const result = importer.importChunks([filename]);

      expect(result.imported).toBe(1);
      expect(result.errors).toHaveLength(0);

      const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8")) as {
        chunks: Array<{ hash: string; entries: number }>;
      };
      expect(manifest.chunks).toHaveLength(1);
    });

    it("counts entries correctly", () => {
      const dir = makeTestDir();
      const filename = writeChunkFile(dir, ['{"id":"1"}', '{"id":"2"}', '{"id":"3"}']);

      const importer = new ChunkImporter({ projectPath: dir });
      const result = importer.importChunks([filename]);

      expect(result.entries).toBe(3);
    });

    it("handles corrupt files gracefully", () => {
      const dir = makeTestDir();
      const corruptFile = "corrupt.jsonl.gz";
      writeFileSync(join(dir, corruptFile), Buffer.from("this is not gzip data"));

      const importer = new ChunkImporter({ projectPath: dir });
      const result = importer.importChunks([corruptFile]);

      expect(result.imported).toBe(0);
      expect(result.entries).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("corrupt.jsonl.gz");
    });

    it("imports multiple chunks in one call", () => {
      const dir = makeTestDir();
      const f1 = writeChunkFile(dir, ['{"id":"1"}']);
      const f2 = writeChunkFile(dir, ['{"id":"2"}', '{"id":"3"}']);

      const importer = new ChunkImporter({ projectPath: dir });
      const result = importer.importChunks([f1, f2]);

      expect(result.imported).toBe(2);
      expect(result.entries).toBe(3);
      expect(result.errors).toHaveLength(0);
    });

    it("preserves existing manifest chunks", () => {
      const dir = makeTestDir();
      writeManifest(dir, [{ hash: "existing", entries: 5 }]);

      const filename = writeChunkFile(dir, ['{"id":"1"}']);
      const importer = new ChunkImporter({ projectPath: dir });
      importer.importChunks([filename]);

      const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8")) as {
        chunks: Array<{ hash: string; entries: number }>;
      };
      expect(manifest.chunks).toHaveLength(2);
      expect(manifest.chunks[0]!.hash).toBe("existing");
    });
  });
});
