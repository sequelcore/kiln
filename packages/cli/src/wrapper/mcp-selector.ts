export function normalizeMcpSelector(rawToolName: string): string {
  return rawToolName
    .trim()
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/");
}
