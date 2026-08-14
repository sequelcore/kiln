export const CODEX_DESKTOP_CUSTOM_PROVIDER_HISTORY_ISSUE_URL = "https://github.com/openai/codex/issues/28957";

export type CodexDesktopHistoryCompatibility =
  | { readonly status: "not-applicable" }
  | {
      readonly status: "unobservable";
      readonly issueUrl: typeof CODEX_DESKTOP_CUSTOM_PROVIDER_HISTORY_ISSUE_URL;
      readonly diagnostic: "codex-desktop-custom-provider-history-unobservable";
    }
  | {
      readonly status: "known-degraded" | "unverified";
      readonly nativeClientVersion: string;
      readonly issueUrl: typeof CODEX_DESKTOP_CUSTOM_PROVIDER_HISTORY_ISSUE_URL;
      readonly diagnostic:
        | "codex-desktop-custom-provider-history-degraded"
        | "codex-desktop-custom-provider-history-unverified";
    };

export function evaluateCodexDesktopHistoryCompatibility(input: {
  readonly modelProvider: string;
  readonly nativeClientVersion?: string;
}): CodexDesktopHistoryCompatibility {
  if (input.modelProvider !== "kiln") return { status: "not-applicable" };
  if (input.nativeClientVersion === undefined) {
    return {
      status: "unobservable",
      issueUrl: CODEX_DESKTOP_CUSTOM_PROVIDER_HISTORY_ISSUE_URL,
      diagnostic: "codex-desktop-custom-provider-history-unobservable",
    };
  }
  const knownDegraded = input.nativeClientVersion === "0.147.0";
  return {
    status: knownDegraded ? "known-degraded" : "unverified",
    nativeClientVersion: input.nativeClientVersion,
    issueUrl: CODEX_DESKTOP_CUSTOM_PROVIDER_HISTORY_ISSUE_URL,
    diagnostic: knownDegraded
      ? "codex-desktop-custom-provider-history-degraded"
      : "codex-desktop-custom-provider-history-unverified",
  };
}
