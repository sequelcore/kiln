import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  createFeedbackBundle,
  createFeedbackIssueDraft,
  type FeedbackBundle,
  type FeedbackEvidenceItemInput,
  type FeedbackEvidenceSelection,
  type FeedbackReporterMode,
} from "@kilnai/core";
import type { KilnAppConfig } from "../config.js";
import { resolveProjectRoot } from "../application/project-root-resolver.js";

interface FeedbackDraftFlags {
  readonly projectPath?: string;
  readonly sessionId?: string;
  readonly mode: FeedbackReporterMode;
  readonly description?: string;
  readonly expectedBehavior?: string;
  readonly actualBehavior?: string;
  readonly createdAt?: string;
  readonly outputDir?: string;
  readonly gitStatusText?: string;
  readonly includeGitStatus: boolean;
}

export async function feedbackCommand(
  _appConfig: KilnAppConfig,
  subcommand: string | undefined,
  args: readonly string[],
): Promise<void> {
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printFeedbackHelp();
    return;
  }

  switch (subcommand) {
    case "draft": {
      if (args.includes("--help") || args.includes("-h")) {
        printFeedbackHelp();
        return;
      }
      const result = writeFeedbackDraft(parseFeedbackDraftFlags(args));
      console.log(`Local feedback bundle: ${result.bundlePath}`);
      console.log(`Local issue draft: ${result.issuePath}`);
      console.log("");
      console.log("Redacted preview:");
      console.log(result.issueMarkdown);
      break;
    }
    default:
      console.error(`Unknown feedback subcommand: ${subcommand}`);
      printFeedbackHelp();
      process.exit(1);
  }
}

interface WriteFeedbackDraftResult {
  readonly bundle: FeedbackBundle;
  readonly bundlePath: string;
  readonly issuePath: string;
  readonly issueMarkdown: string;
}

function writeFeedbackDraft(flags: FeedbackDraftFlags): WriteFeedbackDraftResult {
  const project = resolveProjectRoot({ explicitPath: flags.projectPath });
  const createdAt = flags.createdAt ?? new Date().toISOString();
  const feedbackId = `feedback-${createdAt.replace(/[:.]/g, "-")}`;
  const sessionId = required(flags.sessionId, "--session");
  const description = required(flags.description, "--description");
  const actualBehavior = required(flags.actualBehavior, "--actual");
  const outputDir = resolve(project.rootPath, flags.outputDir ?? join(".kiln", "feedback"));
  const gitStatus = resolveGitStatus(flags, project.rootPath);
  const evidence = buildEvidence(gitStatus);

  const bundle = createFeedbackBundle({
    feedbackId,
    createdAt,
    sessionId,
    reporter: {
      mode: flags.mode,
      description,
      ...(flags.expectedBehavior ? { expectedBehavior: flags.expectedBehavior } : {}),
      actualBehavior,
    },
    evidenceSelection: buildEvidenceSelection({ includeGitStatus: Boolean(gitStatus) }),
    evidence,
  });
  const issue = createFeedbackIssueDraft(bundle);
  const bundlePath = join(outputDir, `${feedbackId}.json`);
  const issuePath = join(outputDir, `${feedbackId}.md`);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, "utf-8");
  writeFileSync(issuePath, `${issue.markdown}\n`, "utf-8");

  return {
    bundle,
    bundlePath,
    issuePath,
    issueMarkdown: issue.markdown,
  };
}

function parseFeedbackDraftFlags(args: readonly string[]): FeedbackDraftFlags {
  return {
    projectPath: findFlag(args, "--project") ?? findFlag(args, "--cwd"),
    sessionId: findFlag(args, "--session"),
    mode: parseMode(findFlag(args, "--mode") ?? "quick"),
    description: findFlag(args, "--description", { allowOptionValue: true }),
    expectedBehavior: findFlag(args, "--expected", { allowOptionValue: true }),
    actualBehavior: findFlag(args, "--actual", { allowOptionValue: true }),
    createdAt: findFlag(args, "--created-at"),
    outputDir: findFlag(args, "--output-dir"),
    gitStatusText: findFlag(args, "--git-status-text", { allowOptionValue: true }),
    includeGitStatus: args.includes("--git-status"),
  };
}

function buildEvidence(gitStatus: string | undefined): readonly FeedbackEvidenceItemInput[] {
  return gitStatus
    ? [{
        kind: "git-status",
        title: "CLI git status",
        content: gitStatus,
      }]
    : [];
}

function buildEvidenceSelection(input: { readonly includeGitStatus: boolean }): FeedbackEvidenceSelection {
  return {
    includeSessionSummary: false,
    includeTranscriptExcerpts: false,
    includeToolFailures: false,
    includeCommandOutput: false,
    includeEnvironment: false,
    includeGitStatus: input.includeGitStatus,
    includeLogs: false,
    includeFileChangeSummary: false,
    includeDiagnosticFindings: false,
  };
}

function resolveGitStatus(flags: FeedbackDraftFlags, projectRoot: string): string | undefined {
  if (flags.gitStatusText !== undefined) {
    const direct = flags.gitStatusText.replace(/\r\n/g, "\n").trimEnd();
    return direct.trim().length > 0 ? direct : undefined;
  }
  if (!flags.includeGitStatus) {
    return undefined;
  }
  try {
    const status = execFileSync("git", ["status", "--short"], {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).replace(/\r\n/g, "\n").trimEnd();
    return status.trim().length > 0 ? status : "clean";
  } catch {
    return "unavailable";
  }
}

function required(value: string | undefined, flag: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    console.error(`Missing required option: ${flag}`);
    process.exit(1);
  }
  return trimmed;
}

function parseMode(value: string): FeedbackReporterMode {
  const normalized = value.trim().toLowerCase();
  if (normalized === "quick" || normalized === "diagnostic" || normalized === "maintainer") {
    return normalized;
  }
  console.error(`Unknown feedback mode: ${value}`);
  process.exit(1);
}

function findFlag(
  args: readonly string[],
  flag: string,
  options: { readonly allowOptionValue?: boolean } = {},
): string | undefined {
  const index = args.indexOf(flag);
  if (index >= 0) {
    const value = args[index + 1];
    if (!value || (!options.allowOptionValue && isOptionToken(value))) {
      console.error(`Missing value for option: ${flag}`);
      process.exit(1);
    }
    return value;
  }
  const prefix = `${flag}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline === undefined) {
    return undefined;
  }
  const value = inline.slice(prefix.length);
  if (!value) {
    console.error(`Missing value for option: ${flag}`);
    process.exit(1);
  }
  return value;
}

function isOptionToken(value: string): boolean {
  return value.startsWith("--");
}

function printFeedbackHelp(): void {
  console.log("\nUsage: kiln feedback draft [options]\n");
  console.log("Options:");
  console.log("  --project PATH          Resolve project root from PATH");
  console.log("  --cwd PATH              Alias for --project");
  console.log("  --session ID            Required Kiln session id");
  console.log("  --mode MODE             quick, diagnostic, or maintainer");
  console.log("  --description TEXT      Required feedback summary");
  console.log("  --expected TEXT         Expected behavior");
  console.log("  --actual TEXT           Required actual behavior");
  console.log("  --git-status            Include current git status snapshot");
  console.log("  --git-status-text TEXT  Include provided git status text");
  console.log("  --output-dir PATH       Output directory; default .kiln/feedback");
  console.log("");
}
