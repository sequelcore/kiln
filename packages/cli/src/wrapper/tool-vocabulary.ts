/**
 * Kiln's tool vocabulary is its own ubiquitous language -- the lowercase names
 * the builtin registry declares (`read`, `edit`, `bash`, `web_fetch`, ...) plus
 * dotted control-plane names. Each harness names the same capabilities
 * differently, and Kiln's own policy layer (`SAFE_DEFAULTS_TOOL_RULES`) was
 * written in Claude's PascalCase before the runtime vocabulary existed.
 *
 * This table is the single canonical mapping consumed both by policy
 * evaluation (matching an incoming runtime tool name against a rule written
 * in any known alias) and by harness translation (lowering a canonical name
 * into each harness's own vocabulary). A name absent from a harness column
 * has no native equivalent there and must stay unsupported: writing an
 * unrecognised name produces a rule the harness silently never matches,
 * which reads as enforcement while providing none. Kiln control-plane tools
 * are deliberately absent from every column -- no harness can enforce them,
 * so they always reach the agent as constraints.
 */
export const TOOL_VOCABULARY: Readonly<Record<string, { readonly claude?: string; readonly opencode?: string }>> = {
  read: { claude: "Read", opencode: "read" },
  read_many: { claude: "Read" },
  write: { claude: "Write", opencode: "write" },
  edit: { claude: "Edit", opencode: "edit" },
  patch: { claude: "Edit", opencode: "patch" },
  bash: { claude: "Bash", opencode: "bash" },
  grep: { claude: "Grep", opencode: "grep" },
  glob: { claude: "Glob", opencode: "glob" },
  web_fetch: { claude: "WebFetch", opencode: "webfetch" },
  web_search: { claude: "WebSearch", opencode: "websearch" },
};

/**
 * Every alias (canonical name plus each harness's native name) resolved to
 * its canonical Kiln runtime name. Some harness names are shared by more
 * than one canonical tool (Claude's "Read" covers both `read` and
 * `read_many`); the first canonical entry declaring an alias wins, so the
 * table's declaration order is significant.
 */
const ALIAS_TO_CANONICAL: ReadonlyMap<string, string> = (() => {
  const aliases = new Map<string, string>();
  for (const [canonical, mapping] of Object.entries(TOOL_VOCABULARY)) {
    aliases.set(canonical, canonical);
    if (mapping.claude && !aliases.has(mapping.claude)) aliases.set(mapping.claude, canonical);
    if (mapping.opencode && !aliases.has(mapping.opencode)) aliases.set(mapping.opencode, canonical);
  }
  return aliases;
})();

/**
 * Resolves any known alias -- Kiln's own runtime name or a harness-native
 * name -- to the canonical Kiln runtime name. Names outside the vocabulary
 * (control-plane names, wildcards, dotted patterns) pass through unchanged
 * so exact and wildcard matching keeps working for them.
 */
export function canonicalToolName(name: string): string {
  return ALIAS_TO_CANONICAL.get(name) ?? name;
}

export function nativeToolName(canonical: string, backend: string): string | undefined {
  if (canonical === "*") return "*";
  const mapping = TOOL_VOCABULARY[canonical];
  return backend === "claude" ? mapping?.claude : mapping?.opencode;
}
