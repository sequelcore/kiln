import type { ProviderId } from "../wrapper/index.js";
import { SessionStore } from "../wrapper/index.js";

export async function resolveResumeSessionId(
  projectPath: string,
  resume: boolean | undefined,
  _provider: ProviderId | undefined,
): Promise<string | undefined> {
  if (!resume) {
    return undefined;
  }

  try {
    const store = new SessionStore(projectPath);
    const canonicalLast = await store.last();
    return canonicalLast?.sessionId;
  } catch {
    console.error("[SessionStore] Failed to look up last session for resume");
    return undefined;
  }
}
