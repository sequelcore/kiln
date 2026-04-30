const TEXT_MIME_TYPE = "text/plain";

const BINARY_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".mp3",
  ".mp4",
  ".ogg",
  ".pdf",
  ".png",
  ".webm",
  ".webp",
  ".zip",
]);

export function looksBinaryFilePath(path: string): boolean {
  const lower = path.toLowerCase();
  for (const extension of BINARY_EXTENSIONS) {
    if (lower.endsWith(extension)) return true;
  }
  return false;
}

export function inferFileMimeType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return TEXT_MIME_TYPE;
}
