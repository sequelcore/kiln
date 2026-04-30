export interface DiffPreviewClip {
  readonly preview: string;
  readonly truncated: boolean;
}

export function countTextLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }
  const normalized = normalizeLineEndings(content).replace(/\n$/, "");
  if (normalized.length === 0) {
    return 0;
  }
  return normalized.split("\n").length;
}

export function buildAddedPreview(content: string): string {
  return content.length === 0
    ? "+ (empty file)"
    : normalizeLineEndings(content).replace(/\n$/, "")
      .split("\n")
      .map((line) => `+ ${line}`)
      .join("\n");
}

export function buildRemovedPreview(content: string): string {
  return content.length === 0
    ? "- (empty file)"
    : normalizeLineEndings(content).replace(/\n$/, "")
      .split("\n")
      .map((line) => `- ${line}`)
      .join("\n");
}

export function buildReplacementPreview(previous: string, next: string): string {
  const removed = buildRemovedPreview(previous);
  const added = buildAddedPreview(next);
  if (removed.length === 0) return added;
  if (added.length === 0) return removed;
  return `${removed}\n${added}`;
}

export function clipDiffPreview(value: string): DiffPreviewClip {
  const maxLines = 24;
  const maxChars = 1200;
  const normalized = value.trimEnd();
  if (normalized.length === 0) {
    return { preview: "", truncated: false };
  }

  const lines = normalized.split("\n");
  let preview = lines.slice(0, maxLines).join("\n");
  let truncated = lines.length > maxLines;

  if (preview.length > maxChars) {
    preview = `${preview.slice(0, maxChars)}\n...`;
    truncated = true;
  }

  return { preview, truncated };
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
