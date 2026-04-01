import type { ProviderId } from "../wrapper/index.js";
import { SessionStore } from "../wrapper/index.js";

export async function resolveResumeSessionId(
  projectPath: string,
  resume: boolean | undefined,
  provider: ProviderId | undefined,
): Promise<string | undefined> {
  if (!resume || !provider) {
    return undefined;
  }

  try {
    const store = new SessionStore(projectPath);
    const lastRecord = await store.last(provider);
    return lastRecord?.sessionId;
  } catch {
    console.error("[SessionStore] Failed to look up last session for resume");
    return undefined;
  }
}
