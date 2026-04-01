import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import type { KilnAppConfig } from "../config.js";
import { SessionStore, TranscriptStore } from "../wrapper/session-store.js";
import type { PersistedTranscriptLine } from "../wrapper/session-store.js";
import type { PersistedTranscriptEvent } from "@kilnai/core";

const MAX_NAME_LENGTH = 40;

export interface SkillCaptureFlags {
  readonly last?: boolean;
  readonly scope?: "user" | "project";
  readonly yes?: boolean;
  readonly dryRun?: boolean;
  readonly name?: string;
  readonly provider?: string;
  readonly apiKey?: string;
}

export function parseSkillCaptureFlags(args: readonly string[]): SkillCaptureFlags {
  const flags: SkillCaptureFlags = {};
  let i = 0;

  while (i < args.length) {
    const arg = args[i]!;
    if (arg === "--last") {
      (flags as Record<string, unknown>).last = true;
      i += 1;
    } else if (arg === "--yes") {
      (flags as Record<string, unknown>).yes = true;
      i += 1;
    } else if (arg === "--dry-run") {
      (flags as Record<string, unknown>).dryRun = true;
      i += 1;
    } else if (arg === "--scope" && i + 1 < args.length) {
      (flags as Record<string, unknown>).scope = normalizeScope(args[i + 1]);
      i += 2;
    } else if (arg.startsWith("--scope=")) {
      (flags as Record<string, unknown>).scope = normalizeScope(arg.slice("--scope=".length));
      i += 1;
    } else if (arg === "--name" && i + 1 < args.length) {
      (flags as Record<string, unknown>).name = args[i + 1];
      i += 2;
    } else if (arg.startsWith("--name=")) {
      (flags as Record<string, unknown>).name = arg.slice("--name=".length);
      i += 1;
    } else if (arg === "--provider" && i + 1 < args.length) {
      (flags as Record<string, unknown>).provider = args[i + 1];
      i += 2;
    } else if (arg.startsWith("--provider=")) {
      (flags as Record<string, unknown>).provider = arg.slice("--provider=".length);
      i += 1;
    } else if (arg === "--api-key" && i + 1 < args.length) {
      (flags as Record<string, unknown>).apiKey = args[i + 1];
      i += 2;
    } else if (arg.startsWith("--api-key=")) {
      (flags as Record<string, unknown>).apiKey = arg.slice("--api-key=".length);
      i += 1;
    } else {
      i += 1;
    }
  }

  return flags;
}

export async function skillCaptureCommand(
  _config: KilnAppConfig,
  sessionId: string | undefined,
  flags: SkillCaptureFlags,
): Promise<void> {
  const normalized = normalizeLeadingFlag(sessionId, flags);
  const sessionStore = new SessionStore(process.cwd());
  const transcriptStore = new TranscriptStore(process.cwd());
  const resolvedSessionId = normalized.last || !normalized.sessionId
    ? (await sessionStore.last())?.sessionId
    : normalized.sessionId;

  if (!resolvedSessionId) {
    console.error("No session found. Pass a sessionId or use --last.");
    process.exit(1);
    return;
  }

  const apiKey = normalized.flags.apiKey
    ?? process.env.ANTHROPIC_API_KEY
    ?? process.env.OPENAI_API_KEY
    ?? process.env.OPENROUTER_API_KEY
    ?? process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    console.error("No API key found. Use --api-key or set ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, or DEEPSEEK_API_KEY.");
    process.exit(1);
    return;
  }

  const transcriptLines = await transcriptStore.readTranscript(resolvedSessionId);
  if (transcriptLines.length === 0) {
    console.error(`No transcript found for session ${resolvedSessionId}.`);
    process.exit(1);
    return;
  }

  const meta = await transcriptStore.readMeta(resolvedSessionId);
  const task = meta?.task ?? "Unknown task";

  let SkillCaptureServiceCtor: typeof import("@kilnai/core").SkillCaptureService;
  let AnthropicAdapterCtor: typeof import("@kilnai/core").AnthropicAdapter;
  try {
    const core = await import("@kilnai/core");
    SkillCaptureServiceCtor = core.SkillCaptureService;
    AnthropicAdapterCtor = core.AnthropicAdapter;
  } catch {
    console.error("Skill capture is unavailable because @kilnai/core could not be loaded.");
    process.exit(1);
    return;
  }

  const provider = new AnthropicAdapterCtor({ apiKey });
  const service = new SkillCaptureServiceCtor({ provider });
  const transcript = transcriptLines
    .map(toPersistedTranscriptEvent)
    .filter((line): line is PersistedTranscriptEvent => line !== null);
  const summary = await service.extractSummary({
    task,
    transcript,
    toolCount: meta?.toolCount ?? 0,
    turnDepth: meta?.turnDepth ?? 0,
  });

  if (!summary) {
    console.error("Failed to extract a reusable summary from the session.");
    process.exit(1);
    return;
  }

  const draft = await service.generateSkill(summary);
  if (!draft) {
    console.error("Failed to generate SKILL.md content from the captured summary.");
    process.exit(1);
    return;
  }

  const skillName = sanitizeName(normalized.flags.name ?? draft.name);
  if (!skillName) {
    console.error("Failed to derive a valid skill name.");
    process.exit(1);
    return;
  }

  const skillsDir = normalized.flags.scope === "user"
    ? join(homedir(), ".kiln", "skills", skillName)
    : join(process.cwd(), ".kiln", "skills", skillName);
  const skillFilePath = join(skillsDir, "SKILL.md");

  console.log("Skill preview");
  console.log(`Name: ${skillName}`);
  console.log(`Path: ${skillFilePath}`);
  console.log("");
  console.log(draft.content);

  if (normalized.flags.dryRun) {
    return;
  }

  if (!normalized.flags.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await rl.question("Save skill? [y/N] ");
      if (answer.trim().toLowerCase() !== "y") {
        console.log("Cancelled.");
        return;
      }
    } finally {
      rl.close();
    }
  }

  await mkdir(skillsDir, { recursive: true });
  await writeFile(skillFilePath, draft.content, "utf-8");
  console.log(`Skill saved: ${skillFilePath}`);
}

function normalizeLeadingFlag(
  sessionId: string | undefined,
  flags: SkillCaptureFlags,
): { sessionId: string | undefined; last: boolean; flags: SkillCaptureFlags } {
  if (!sessionId || !sessionId.startsWith("--")) {
    return { sessionId, last: flags.last === true, flags };
  }

  const mergedFlags = parseSkillCaptureFlags([sessionId]);
  return {
    sessionId: undefined,
    last: mergedFlags.last === true || flags.last === true,
    flags: { ...mergedFlags, ...flags },
  };
}

function normalizeScope(scope: string | undefined): "user" | "project" {
  return scope === "user" ? "user" : "project";
}

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, MAX_NAME_LENGTH)
    .replace(/^-+|-+$/g, "");
}

function toPersistedTranscriptEvent(
  line: PersistedTranscriptLine,
): PersistedTranscriptEvent | null {
  switch (line.type) {
    case "text_delta":
      return typeof line.data.content === "string"
        ? {
            seq: line.seq,
            ts: line.ts,
            event: { type: "text_delta", content: line.data.content },
          }
        : null;
    case "tool_use":
      return typeof line.data.toolName === "string"
        ? {
            seq: line.seq,
            ts: line.ts,
            event: { type: "tool_use", toolName: line.data.toolName },
          }
        : null;
    case "tool_result":
      return {
        seq: line.seq,
        ts: line.ts,
        event: { type: "tool_result" },
      };
    default:
      return null;
  }
}
