import { parse, stringify } from "yaml";
import type {
  KilnYamlSkillVisibility,
  KilnYamlSkillsConfig,
} from "../kiln-yaml-types.js";
import { KilnYamlError } from "../kiln-yaml-types.js";

export type SkillHarness = "claude" | "codex" | "opencode";

export function validateSkillVisibilityConfig(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError("skills.visibility must be an object");
  for (const key of Object.keys(value)) {
    if (key !== "default" && key !== "overrides") {
      throw new KilnYamlError(`Unknown skills.visibility field: ${key}`);
    }
  }
  validateVisibility(value.default, "skills.visibility.default");
  if (value.overrides === undefined) return;
  if (!isRecord(value.overrides)) throw new KilnYamlError("skills.visibility.overrides must be an object");
  for (const [skillName, visibility] of Object.entries(value.overrides)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName)) {
      throw new KilnYamlError(`skills.visibility.overrides key must be a lowercase kebab-case skill name: ${skillName}`);
    }
    validateVisibility(visibility, `skills.visibility.overrides.${skillName}`);
  }
}

function validateVisibility(value: unknown, path: string): void {
  if (value !== undefined && value !== "implicit" && value !== "explicit-only" && value !== "disabled") {
    throw new KilnYamlError(`${path} must be implicit, explicit-only, or disabled`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveSkillVisibility(
  skillName: string,
  config?: KilnYamlSkillsConfig | null,
): KilnYamlSkillVisibility {
  const canonicalName = skillName.trim().toLowerCase();
  const overrides = config?.visibility?.overrides;
  return overrides && Object.hasOwn(overrides, canonicalName)
    ? overrides[canonicalName]!
    : config?.visibility?.default ?? "implicit";
}

export function renderSkillVisibility(
  harness: SkillHarness,
  visibility: KilnYamlSkillVisibility,
  files: readonly { readonly fileName: string; readonly content: string | Uint8Array }[],
): readonly { readonly fileName: string; readonly content: string | Uint8Array }[] {
  if (harness === "opencode") {
    if (visibility === "explicit-only") return [];
    return files
      .filter((file) => file.fileName.toLowerCase() !== "agents/openai.yaml")
      .map((file) => file.fileName.toLowerCase() === "skill.md"
        ? { ...file, content: normalizeOpenCodeImplicitFrontmatter(asText(file.content)) }
        : file);
  }
  if (harness === "claude") {
    return files
      .filter((file) => file.fileName.toLowerCase() !== "agents/openai.yaml")
      .map((file) => file.fileName.toLowerCase() === "skill.md"
        ? visibility === "explicit-only" || frontmatterHasKey(asText(file.content), "disable-model-invocation")
          ? {
            ...file,
            content: mergeMarkdownFrontmatter(asText(file.content), {
              "disable-model-invocation": visibility === "explicit-only",
            }),
          }
          : file
        : file);
  }
  const metadataPath = "agents/openai.yaml";
  const existing = files.find((file) => file.fileName.toLowerCase() === metadataPath);
  const metadata = existing
    ? asText(existing.content)
    : "";
  if (!existing && visibility === "implicit") return files;
  const rendered = mergeYamlObject(
    metadata,
    ["policy", "allow_implicit_invocation"],
    visibility === "implicit",
  );
  return existing
    ? files.map((file) => file === existing ? { ...file, content: rendered } : file)
    : [...files, { fileName: metadataPath, content: rendered }];
}

function asText(content: string | Uint8Array): string {
  return typeof content === "string" ? content : Buffer.from(content).toString("utf8");
}

function mergeMarkdownFrontmatter(content: string, values: Record<string, unknown>): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(content);
  if (!match) return content;
  const parsed = parse(match[1] ?? "") as Record<string, unknown> | null;
  const header = stringify({ ...(parsed ?? {}), ...values }).trimEnd();
  return `---\n${header}\n---${content.slice(match[0].length - (match[2]?.length ?? 0))}`;
}

function frontmatterHasKey(content: string, key: string): boolean {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(content);
  if (!match) return false;
  const parsed = parse(match[1] ?? "") as Record<string, unknown> | null;
  return parsed !== null && Object.hasOwn(parsed, key);
}

function normalizeOpenCodeImplicitFrontmatter(content: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(content);
  if (!match) return content;
  const parsed = parse(match[1] ?? "") as Record<string, unknown> | null;
  const root = parsed ?? {};
  const metadata = root.metadata && typeof root.metadata === "object" && !Array.isArray(root.metadata)
    ? root.metadata as Record<string, unknown>
    : {};
  if (!Object.hasOwn(metadata, "opencode/autoinvoke")) return content;
  const header = stringify({
    ...root,
    metadata: { ...metadata, "opencode/autoinvoke": "true" },
  }).trimEnd();
  return `---\n${header}\n---${content.slice(match[0].length - (match[2]?.length ?? 0))}`;
}

function mergeYamlObject(content: string, path: readonly string[], value: unknown): string {
  const parsed = content.trim() ? parse(content) : {};
  const root = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  let current = root;
  for (const segment of path.slice(0, -1)) {
    const child = current[segment];
    if (!child || typeof child !== "object" || Array.isArray(child)) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[path[path.length - 1]!] = value;
  return stringify(root);
}
