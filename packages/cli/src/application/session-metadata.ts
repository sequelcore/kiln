export interface SessionMetadataInput {
  readonly task?: string;
  readonly prompt?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly canonicalTitle?: string;
  readonly title?: string;
  readonly summary?: string;
  readonly tags?: readonly string[];
  readonly providersUsed?: readonly string[];
  readonly hasFileChanges?: boolean;
  readonly hasApprovals?: boolean;
  readonly hasError?: boolean;
}

export interface SessionMetadata {
  readonly canonicalTitle: string;
  readonly title: string;
  readonly summary: string;
  readonly tags: string[];
  readonly providersUsed: string[];
}

const MAX_TITLE_LENGTH = 96;
const MAX_SUMMARY_LENGTH = 220;
const FALLBACK_TITLE = "Untitled session";

function compactText(value: string | undefined): string {
  return (value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const sliced = value.slice(0, maxLength);
  const boundary = sliced.lastIndexOf(" ");
  const bestEffort = (boundary >= Math.floor(maxLength * 0.6) ? sliced.slice(0, boundary) : sliced).trimEnd();
  return `${bestEffort}...`;
}

function isGenericSessionTask(value: string): boolean {
  return value.trim().toLowerCase() === "interactive";
}

function isLowSignalSessionText(value: string | undefined): boolean {
  const normalized = compactText(value).toLowerCase();
  if (!normalized) {
    return true;
  }
  const compact = normalized.replace(/[!?.,]+$/g, "");
  if ([
    "hi",
    "hello",
    "hey",
    "hola",
    "ok",
    "okay",
    "yes",
    "no",
    "start",
    "continue",
    "thanks",
    "thank you",
  ].includes(compact)) {
    return true;
  }
  return compact.split(/\s+/).filter(Boolean).length <= 1;
}

function firstUsefulLine(value: string | undefined): string {
  const compacted = compactText(value);
  if (!compacted) {
    return "";
  }
  const line = compacted
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  if (!line) {
    return "";
  }
  const withoutRolePrefix = line.replace(/^(user|assistant|system)\s*:\s*/i, "").trim();
  if (!withoutRolePrefix || isGenericSessionTask(withoutRolePrefix)) {
    return "";
  }
  return withoutRolePrefix;
}

function dedupePreservingOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalized);
  }
  return deduped;
}

export function mergeProvidersUsed(
  existing: readonly string[] | undefined,
  incoming: readonly (string | undefined)[],
): string[] {
  return dedupePreservingOrder([
    ...(existing ?? []),
    ...incoming.flatMap((provider) => provider ?? []),
  ]);
}

export function buildDeterministicInitialTitle(firstPromptOrTask: string | undefined): string {
  const seed = firstUsefulLine(firstPromptOrTask);
  return seed ? truncate(seed, MAX_TITLE_LENGTH) : FALLBACK_TITLE;
}

export function shouldPromoteLatestPromptToSessionTitle(input: {
  readonly existingTitle?: string;
  readonly latestPrompt?: string;
}): boolean {
  const latest = firstUsefulLine(input.latestPrompt);
  if (!latest || isLowSignalSessionText(latest)) {
    return false;
  }
  const existing = firstUsefulLine(input.existingTitle);
  if (!existing || existing === FALLBACK_TITLE || isLowSignalSessionText(existing)) {
    return true;
  }
  return false;
}

export function resolveSessionSummary(input: {
  summary?: string;
  canonicalTitle?: string;
  task?: string;
  providerLabel?: string;
}): string {
  const summary = firstUsefulLine(input.summary);
  if (summary) {
    return truncate(summary, MAX_SUMMARY_LENGTH);
  }
  const title = firstUsefulLine(input.canonicalTitle);
  if (title) {
    return truncate(title, MAX_SUMMARY_LENGTH);
  }
  const task = firstUsefulLine(input.task);
  if (task) {
    return truncate(task, MAX_SUMMARY_LENGTH);
  }
  if (input.providerLabel) {
    return `${input.providerLabel} session`;
  }
  return FALLBACK_TITLE;
}

export function deriveSessionMetadata(input: SessionMetadataInput): SessionMetadata {
  const canonicalTitle = (
    firstUsefulLine(input.canonicalTitle)
    || firstUsefulLine(input.title)
    || firstUsefulLine(input.summary)
    || firstUsefulLine(input.prompt)
    || firstUsefulLine(input.task)
  );
  const resolvedTitle = truncate(canonicalTitle || FALLBACK_TITLE, MAX_TITLE_LENGTH);

  const providersUsed = mergeProvidersUsed(input.providersUsed, [input.provider]);

  const tags = new Set<string>(dedupePreservingOrder((input.tags ?? []).map((tag) => tag.toLowerCase())));
  for (const provider of providersUsed) {
    tags.add(provider.toLowerCase());
  }
  if (input.model?.trim()) {
    tags.add(input.model.trim().toLowerCase());
  }
  if (input.hasFileChanges) {
    tags.add("files-changed");
  }
  if (input.hasApprovals) {
    tags.add("approvals");
  }
  if (input.hasError) {
    tags.add("error");
  }

  return {
    canonicalTitle: resolvedTitle,
    title: resolvedTitle,
    summary: resolveSessionSummary({
      summary: input.summary,
      canonicalTitle: resolvedTitle,
      task: input.task ?? input.prompt,
    }),
    tags: [...tags],
    providersUsed,
  };
}
