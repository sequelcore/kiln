import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { gunzipSync } from "node:zlib";

interface ManifestChunk {
  readonly hash: string;
  readonly entries: number;
  readonly createdAt: string;
  readonly developer?: string;
}

interface Manifest {
  version: 1;
  chunks: ManifestChunk[];
  deleted: string[];
}

export interface ImportResult {
  readonly imported: number;
  readonly entries: number;
  readonly errors: readonly string[];
}

export class ChunkImporter {
  private readonly dir: string;

  constructor(opts: { projectPath: string }) {
    this.dir = opts.projectPath;
  }

  discoverNewChunks(): string[] {
    if (!existsSync(this.dir)) return [];

    const files = readdirSync(this.dir).filter((f) => f.endsWith(".jsonl.gz"));
    const manifest = this.readManifest();
    const knownHashes = new Set(manifest.chunks.map((c) => c.hash));

    return files.filter((f) => {
      const hash = basename(f, ".jsonl.gz");
      return !knownHashes.has(hash);
    });
  }

  importChunks(newChunks: string[]): ImportResult {
    const manifest = this.readManifest();
    let imported = 0;
    let entries = 0;
    const errors: string[] = [];

    for (const filename of newChunks) {
      const filePath = join(this.dir, filename);
      try {
        const compressed = readFileSync(filePath);
        const decompressed = gunzipSync(compressed).toString("utf-8");
        const lines = decompressed.split("\n").filter((l) => l.trim().length > 0);
        const hash = basename(filename, ".jsonl.gz");

        manifest.chunks.push({
          hash,
          entries: lines.length,
          createdAt: new Date().toISOString(),
        });

        imported++;
        entries += lines.length;
      } catch (err) {
        errors.push(`${filename}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.writeManifest(manifest);

    return { imported, entries, errors };
  }

  private readManifest(): Manifest {
    const path = join(this.dir, "manifest.json");
    if (!existsSync(path)) {
      return { version: 1, chunks: [], deleted: [] };
    }
    return JSON.parse(readFileSync(path, "utf-8")) as Manifest;
  }

  private writeManifest(manifest: Manifest): void {
    writeFileSync(
      join(this.dir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
  }
}
