import { execFile } from "node:child_process";
import { createHash } from "node:crypto";

/**
 * Shared low-level Git object access used by both candidate capture and
 * candidate subject resolution. Both need to run `git` against a specific
 * root (optionally against an isolated index) and digest raw object bytes
 * the same way, so that a captured candidate's digest and a resolved
 * subject's digest are computed from the same bytes.
 */

export function git(root: string, args: readonly string[], indexPath?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile("git", [...args], {
      cwd: root,
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
      env: indexPath === undefined ? process.env : { ...process.env, GIT_INDEX_FILE: indexPath },
    }, (error, stdout) => {
      if (error) reject(error);
      else resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
    });
  });
}

export async function gitText(root: string, args: readonly string[], indexPath?: string): Promise<string> {
  return (await git(root, args, indexPath)).toString("utf8");
}

export function digestContent(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export async function gitTreeContentDigest(root: string, objectId: string): Promise<string> {
  return digestContent(await git(root, ["cat-file", "tree", objectId]));
}
