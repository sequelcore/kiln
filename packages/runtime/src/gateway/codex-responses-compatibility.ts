const INTERNAL_CHAT_MESSAGE_METADATA_PASSTHROUGH_INPUT_ITEM_TYPES = Object.freeze([
  "message",
  "function_call",
  "function_call_output",
] as const);
const VERIFIED_NATIVE_CLIENT_VERSIONS = Object.freeze(["0.147.0"] as const);

/** Runtime-owned wire compatibility admitted from the Codex CLI 0.147 Responses client. */
export const CODEX_RESPONSES_COMPATIBILITY = Object.freeze({
  revision: "codex-0.147.0" as const,
  verifiedNativeClientVersions: VERIFIED_NATIVE_CLIENT_VERSIONS,
  internalChatMessageMetadataPassthroughInputItemTypes: INTERNAL_CHAT_MESSAGE_METADATA_PASSTHROUGH_INPUT_ITEM_TYPES,
});

export type CodexResponsesNativeClientCompatibility =
  | {
      readonly status: "compatible";
      readonly observedVersion: string;
      readonly protocolRevision: typeof CODEX_RESPONSES_COMPATIBILITY.revision;
    }
  | {
      readonly status: "unsupported";
      readonly observedVersion: string;
      readonly protocolRevision: typeof CODEX_RESPONSES_COMPATIBILITY.revision;
      readonly supportedVersions: readonly string[];
    }
  | {
      readonly status: "unobservable";
      readonly protocolRevision: typeof CODEX_RESPONSES_COMPATIBILITY.revision;
      readonly supportedVersions: readonly string[];
    };

export function evaluateCodexResponsesNativeClient(observedVersion?: string): CodexResponsesNativeClientCompatibility {
  if (observedVersion === undefined) {
    return {
      status: "unobservable",
      protocolRevision: CODEX_RESPONSES_COMPATIBILITY.revision,
      supportedVersions: [...VERIFIED_NATIVE_CLIENT_VERSIONS],
    };
  }
  if ((VERIFIED_NATIVE_CLIENT_VERSIONS as readonly string[]).includes(observedVersion)) {
    return {
      status: "compatible",
      observedVersion,
      protocolRevision: CODEX_RESPONSES_COMPATIBILITY.revision,
    };
  }
  return {
    status: "unsupported",
    observedVersion,
    protocolRevision: CODEX_RESPONSES_COMPATIBILITY.revision,
    supportedVersions: [...VERIFIED_NATIVE_CLIENT_VERSIONS],
  };
}
