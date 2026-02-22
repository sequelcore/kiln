// Engine primitive: ContentPart -- multimodal content representation
// Zero external dependencies, pure TypeScript types + helper functions

/** Text content */
export interface TextPart {
  readonly type: "text";
  readonly text: string;
}

/** Image content (base64 data or URL) */
export interface ImagePart {
  readonly type: "image";
  readonly mimeType: string;
  readonly data?: string;
  readonly url?: string;
}

/** Audio content (base64 data or URL) */
export interface AudioPart {
  readonly type: "audio";
  readonly mimeType: string;
  readonly data?: string;
  readonly url?: string;
  readonly durationMs?: number;
}

/** File content (base64 data or URL) */
export interface FilePart {
  readonly type: "file";
  readonly mimeType: string;
  readonly data?: string;
  readonly url?: string;
  readonly filename?: string;
}

/** Discriminated union of all content part types */
export type ContentPart = TextPart | ImagePart | AudioPart | FilePart;

/** Create a single TextPart */
export function textPart(text: string): TextPart {
  return { type: "text", text };
}

/** Create a readonly ContentPart array containing a single TextPart */
export function textParts(text: string): readonly ContentPart[] {
  return [textPart(text)];
}

/** Concatenate all TextPart.text values from a parts array */
export function extractText(parts: readonly ContentPart[]): string {
  let result = "";
  for (const part of parts) {
    if (part.type === "text") {
      result += part.text;
    }
  }
  return result;
}

/** Check if any part matches the given type */
export function hasModality(parts: readonly ContentPart[], type: ContentPart["type"]): boolean {
  for (const part of parts) {
    if (part.type === type) return true;
  }
  return false;
}

/** Validate a single ContentPart. Returns error message or null if valid. */
export function validateContentPart(part: ContentPart): string | null {
  if (part.type === "text") {
    return null;
  }
  // Binary parts must have exactly one of data or url
  const hasData = part.data !== undefined;
  const hasUrl = part.url !== undefined;
  if (!hasData && !hasUrl) {
    return `${part.type} part must have either "data" or "url"`;
  }
  if (hasData && hasUrl) {
    return `${part.type} part must have either "data" or "url", not both`;
  }
  return null;
}

/** Validate a ContentPart array. Returns all validation errors. */
export function validateContentParts(parts: readonly ContentPart[]): readonly string[] {
  const errors: string[] = [];
  if (parts.length === 0) {
    errors.push("parts array must not be empty");
    return errors;
  }
  for (let i = 0; i < parts.length; i++) {
    const error = validateContentPart(parts[i]!);
    if (error !== null) {
      errors.push(`parts[${i}]: ${error}`);
    }
  }
  return errors;
}
