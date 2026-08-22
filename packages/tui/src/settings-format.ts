import type { KilnSettingsEntry, KilnSettingsSnapshot } from "@kilnai/gateway-contracts";

/** Formats the shared settings read model without recomputing configuration policy. */
export function formatSettingsSnapshot(snapshot: KilnSettingsSnapshot, query = ""): string {
  const normalizedQuery = query.trim().toLowerCase();
  const entries = normalizedQuery.length === 0
    ? snapshot.entries
    : snapshot.entries.filter((entry) => searchableText(entry).includes(normalizedQuery));

  if (entries.length === 0) {
    return normalizedQuery.length > 0
      ? `No settings match “${query.trim()}”.`
      : "No settings are available.";
  }

  const visibleKeys = new Set(entries.map((entry) => entry.key));
  const lines = [
    `${snapshot.modifiedCount} modified · ${snapshot.health}`,
  ];
  for (const section of snapshot.sections) {
    const sectionEntries = section.entryKeys
      .filter((key) => visibleKeys.has(key))
      .map((key) => entries.find((entry) => entry.key === key))
      .filter((entry): entry is KilnSettingsEntry => entry !== undefined);
    if (sectionEntries.length === 0) continue;
    lines.push("", section.label);
    for (const entry of sectionEntries) {
      lines.push(`  ${entry.label}: ${formatValue(entry)}`);
      lines.push(`    effective: ${entry.source}`);
      for (const target of entry.writeTargets) {
        const authority = target.authorityImpact === "none"
          ? "no authority impact"
          : target.authorityImpact.replaceAll("-", " ");
        const approval = target.approvalRequired ? " · approval" : "";
        lines.push(
          `    ${target.scope}: ${target.override} · ${authority}${approval} · ${target.activation.replaceAll("-", " ")} · ${target.owners.join(", ")}`,
        );
      }
    }
  }
  return lines.join("\n");
}

function searchableText(entry: KilnSettingsEntry): string {
  return [entry.key, entry.label, entry.description, ...entry.searchTerms]
    .join(" ")
    .toLowerCase();
}

function formatValue(entry: KilnSettingsEntry): string {
  if (entry.effective.redacted) return "configured (redacted)";
  const value = entry.effective.value;
  if (typeof value === "string") return value;
  const rendered = JSON.stringify(value);
  return rendered === undefined ? "unset" : rendered;
}
