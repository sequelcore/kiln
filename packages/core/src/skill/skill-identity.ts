import { createHash } from "node:crypto";

export interface SkillPackageDigestFile {
  readonly path: string;
  readonly content: Uint8Array;
}

export function canonicalSkillIdentity(name: string): string {
  return name.toLowerCase();
}

export function digestSkillPackage(files: readonly SkillPackageDigestFile[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((left, right) =>
    normalizePath(left.path).localeCompare(normalizePath(right.path)))) {
    const path = normalizePath(file.path);
    const pathBytes = Buffer.from(path, "utf8");
    const content = Buffer.from(file.content);
    hash.update(uint64(pathBytes.length));
    hash.update(pathBytes);
    hash.update(uint64(content.length));
    hash.update(content);
  }
  return `sha256:${hash.digest("hex")}`;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function uint64(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(8);
  buffer.writeBigUInt64BE(BigInt(value));
  return buffer;
}
