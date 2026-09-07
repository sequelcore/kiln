import { ReversibleContextProjectionService } from "../../packages/core/src/efficiency/index.js";
import { ArtifactResourceProvider } from "../../packages/core/src/tools/index.js";
import { createFileArtifactResourceStore } from "../../packages/runtime/src/artifacts/file-artifact-resource-store.js";
import { digest } from "./snapshot.js";

/** Reads historical evidence. This does not revalidate the analyzed workspace. */
export async function readDurableReference(rootDir: string, handle: string, expectedSourceHash: string) {
  const store = createFileArtifactResourceStore({ rootDir });
  const service = new ReversibleContextProjectionService({ store });
  const verification = service.verifyCanonicalEvidence({
    retrievalHandle: handle,
    expectedSourceHash,
    purpose: "verification",
  });
  if (!verification.verified) return { status: "unverified" as const, verification };
  const provider = new ArtifactResourceProvider({ store });
  const pages = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await provider.read(handle, { limit: 2, ...(cursor ? { cursor } : {}) });
    if (!page) throw new Error("missing-provider-response");
    const content = page.contents[0];
    if (page.contents.length !== 1 || !content || !("text" in content)) throw new Error("expected-text-resource");
    pages.push({ text: content.text, responseBytes: Buffer.byteLength(JSON.stringify(page)) });
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error("repeated-resource-cursor");
    if (cursor) seen.add(cursor);
    if (pages.length > 10000) throw new Error("resource-page-budget-exceeded");
  } while (cursor);
  const text = pages.map((page) => page.text).join("\n");
  return {
    status: "verified" as const,
    verification,
    text,
    providerTextDigest: digest(text),
    providerTextBytes: Buffer.byteLength(text),
    resourceResponseBytes: pages.reduce((total, page) => total + page.responseBytes, 0),
    pageCount: pages.length,
    retainedArtifacts: store.list("context-evidence").map(({ id, retention }) => ({ id, retention })),
  };
}

if (import.meta.main) {
  const [rootDir, handle, hash, ...extra] = process.argv.slice(2);
  if (!rootDir || !handle || !hash || extra.length) throw new Error("expected root, handle, hash");
  console.log(JSON.stringify(await readDurableReference(rootDir, handle, hash)));
}
