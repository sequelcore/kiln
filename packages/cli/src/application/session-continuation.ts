import { SessionStore, TranscriptStore } from "../wrapper/session-store.js";

export interface ContinuationSessionResolutionInput {
  readonly continuation?: boolean;
  readonly explicitSessionId?: string;
}

export async function resolveContinuationSessionId(
  projectPath: string,
  input: ContinuationSessionResolutionInput,
): Promise<string | undefined> {
  const explicitSessionId = input.explicitSessionId?.trim();
  if (explicitSessionId) {
    const store = new SessionStore(projectPath);
    if (!await sessionExists(projectPath, store, explicitSessionId)) {
      throw new Error(`Cannot continue unknown Kiln session '${explicitSessionId}'.`);
    }
    return explicitSessionId;
  }

  if (!input.continuation) {
    return undefined;
  }

  try {
    const store = new SessionStore(projectPath);
    const canonicalTargetId = await store.getContinuationTargetSessionId();
    if (!canonicalTargetId) {
      return undefined;
    }
    if (!await sessionExists(projectPath, store, canonicalTargetId)) {
      console.error(`[SessionStore] Continuation target '${canonicalTargetId}' is missing canonical session metadata`);
      return undefined;
    }
    return canonicalTargetId;
  } catch {
    console.error("[SessionStore] Failed to look up continuation target");
    return undefined;
  }
}

async function sessionExists(
  projectPath: string,
  store: SessionStore,
  sessionId: string,
): Promise<boolean> {
  if (await store.find(sessionId)) {
    return true;
  }
  return (await new TranscriptStore(projectPath).readMeta(sessionId)) !== null;
}
