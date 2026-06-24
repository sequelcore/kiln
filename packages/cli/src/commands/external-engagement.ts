import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  buildExternalEvidenceReport,
  estimateXEvidenceRequestBudget,
  normalizeXPostReferences,
  type ExternalEvidenceArtifact,
  type ExternalEvidenceMetrics,
  type ExternalEvidenceReport,
  type XEvidenceRequestBudget,
  type XPostReference,
} from "@kilnai/core";
import type { KilnAppConfig } from "../config.js";

const X_POST_LOOKUP_LIMIT = 100;
const X_RECENT_SEARCH_MAX_RESULTS_LIMIT = 100;

export interface XEvidenceFetchInput {
  readonly accessToken: string;
  readonly references: readonly XPostReference[];
  readonly maxRepliesPerPost: number;
  readonly generatedAt: string;
  readonly reportId: string;
  readonly budget: XEvidenceRequestBudget;
}

export interface XEvidenceFetcher {
  fetchEvidence(input: XEvidenceFetchInput): Promise<ExternalEvidenceReport>;
}

export interface ExternalEngagementCommandDependencies {
  readonly fetcher?: XEvidenceFetcher;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => Date;
  readonly reportId?: () => string;
}

interface XReportFlags {
  readonly urls: readonly string[];
  readonly inputPath?: string;
  readonly outputPath?: string;
  readonly maxRepliesPerPost: number;
  readonly dryRun: boolean;
  readonly accessTokenEnv: string;
}

export async function externalEngagementCommand(
  _config: KilnAppConfig,
  subcommand: string | undefined,
  args: readonly string[],
  dependencies: ExternalEngagementCommandDependencies = {},
): Promise<void> {
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printHelp();
    return;
  }
  if (subcommand !== "x-report") {
    throw new Error(`Unknown external-engagement command '${subcommand}'. Use x-report.`);
  }
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  await runXReport(parseXReportFlags(args), dependencies);
}

async function runXReport(
  flags: XReportFlags,
  dependencies: ExternalEngagementCommandDependencies,
): Promise<void> {
  const generatedAt = (dependencies.now?.() ?? new Date()).toISOString();
  const reportId = dependencies.reportId?.() ?? `external-engagement-${generatedAt.replace(/[:.]/gu, "-")}`;
  const references = normalizeXPostReferences([...flags.urls, ...readInputReferences(flags.inputPath)]);
  if (references.length === 0) {
    throw new Error("external-engagement x-report requires at least one --url or --input reference.");
  }
  if (references.length > X_POST_LOOKUP_LIMIT) {
    throw new Error(`external-engagement x-report supports at most ${X_POST_LOOKUP_LIMIT} root X posts per report.`);
  }
  const budget = estimateXEvidenceRequestBudget({
    rootPostCount: references.length,
    maxRepliesPerPost: flags.maxRepliesPerPost,
    includeAuthors: true,
  });
  if (flags.dryRun) {
    printOrWrite(buildExternalEvidenceReport({
      reportId,
      generatedAt,
      source: "x",
      query: { references, maxRepliesPerPost: flags.maxRepliesPerPost },
      budget,
      artifacts: [],
      signals: [],
    }), flags.outputPath);
    return;
  }
  const env = dependencies.env ?? process.env;
  const accessToken = env[flags.accessTokenEnv]?.trim();
  if (!accessToken) {
    throw new Error(`external-engagement x-report requires ${flags.accessTokenEnv} or --dry-run.`);
  }
  const fetcher = dependencies.fetcher ?? new XApiEvidenceFetcher();
  const report = await fetcher.fetchEvidence({
    accessToken,
    references,
    maxRepliesPerPost: flags.maxRepliesPerPost,
    generatedAt,
    reportId,
    budget,
  });
  printOrWrite(report, flags.outputPath);
}

export class XApiEvidenceFetcher implements XEvidenceFetcher {
  async fetchEvidence(input: XEvidenceFetchInput): Promise<ExternalEvidenceReport> {
    const rootPosts = await fetchTweetsByIds(input.accessToken, input.references.map((reference) => reference.postId));
    const replies = await fetchReplies(input);
    return buildExternalEvidenceReport({
      reportId: input.reportId,
      generatedAt: input.generatedAt,
      source: "x",
      query: {
        references: input.references,
        maxRepliesPerPost: input.maxRepliesPerPost,
      },
      budget: input.budget,
      artifacts: [...rootPosts, ...replies],
      signals: [],
    });
  }
}

function parseXReportFlags(args: readonly string[]): XReportFlags {
  const urls: string[] = [];
  let inputPath: string | undefined;
  let outputPath: string | undefined;
  let maxRepliesPerPost = 25;
  let dryRun = false;
  let accessTokenEnv = "KILN_X_OAUTH2_ACCESS_TOKEN";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--url") {
      urls.push(readRequiredArg(args, index, "--url"));
      index += 1;
    } else if (arg === "--input") {
      inputPath = readRequiredArg(args, index, "--input");
      index += 1;
    } else if (arg === "--output") {
      outputPath = readRequiredArg(args, index, "--output");
      index += 1;
    } else if (arg === "--max-replies") {
      maxRepliesPerPost = parseNonNegativeInteger(readRequiredArg(args, index, "--max-replies"), "--max-replies");
      if (maxRepliesPerPost > X_RECENT_SEARCH_MAX_RESULTS_LIMIT) {
        throw new Error(`--max-replies must be less than or equal to ${X_RECENT_SEARCH_MAX_RESULTS_LIMIT}.`);
      }
      index += 1;
    } else if (arg === "--access-token-env") {
      accessTokenEnv = readRequiredArg(args, index, "--access-token-env");
      index += 1;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else {
      throw new Error(`Unknown external-engagement x-report option '${arg}'.`);
    }
  }

  return {
    urls,
    inputPath,
    outputPath,
    maxRepliesPerPost,
    dryRun,
    accessTokenEnv,
  };
}

function readInputReferences(inputPath: string | undefined): readonly string[] {
  if (!inputPath) {
    return [];
  }
  return readFileSync(inputPath, "utf-8")
    .replace(/\r\n/gu, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function printOrWrite(report: ExternalEvidenceReport, outputPath: string | undefined): void {
  const body = `${JSON.stringify(report, null, 2)}\n`;
  if (!outputPath) {
    console.log(body.trimEnd());
    return;
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, body, "utf-8");
  console.log(`External engagement report written: ${outputPath}`);
}

async function fetchTweetsByIds(accessToken: string, ids: readonly string[]): Promise<readonly ExternalEvidenceArtifact[]> {
  if (ids.length === 0) {
    return [];
  }
  const response = await xGet(accessToken, "https://api.x.com/2/tweets", {
    ids: ids.join(","),
    "tweet.fields": "created_at,author_id,conversation_id,public_metrics,referenced_tweets,lang",
    expansions: "author_id",
    "user.fields": "username,name,verified,public_metrics",
  });
  return parseTweetArtifacts(response, new Map(), "post");
}

async function fetchReplies(input: XEvidenceFetchInput): Promise<readonly ExternalEvidenceArtifact[]> {
  if (input.maxRepliesPerPost === 0) {
    return [];
  }
  const replies: ExternalEvidenceArtifact[] = [];
  for (const reference of input.references) {
    const response = await xGet(input.accessToken, "https://api.x.com/2/tweets/search/recent", {
      query: `conversation_id:${reference.postId}`,
      max_results: String(Math.max(10, input.maxRepliesPerPost)),
      "tweet.fields": "created_at,author_id,conversation_id,public_metrics,referenced_tweets,lang",
      expansions: "author_id",
      "user.fields": "username,name,verified,public_metrics",
    });
    replies.push(...parseTweetArtifacts(response, new Map([[reference.postId, reference.postId]]), "reply")
      .filter((artifact) => artifact.artifactId !== reference.postId)
      .slice(0, input.maxRepliesPerPost));
  }
  return replies;
}

async function xGet(
  accessToken: string,
  endpoint: string,
  params: Readonly<Record<string, string>>,
): Promise<unknown> {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`X API request failed (${response.status}): ${text}`);
  }
  return response.json();
}

function parseTweetArtifacts(
  payload: unknown,
  parentByConversationId: ReadonlyMap<string, string>,
  fallbackKind: ExternalEvidenceArtifact["kind"],
): readonly ExternalEvidenceArtifact[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload as { readonly data?: unknown; readonly includes?: { readonly users?: unknown } };
  if (!Array.isArray(record.data)) {
    return [];
  }
  const authors = parseAuthors(record.includes?.users);
  return record.data.map((tweet) => parseTweetArtifact(tweet, authors, parentByConversationId, fallbackKind));
}

function parseTweetArtifact(
  tweet: unknown,
  authors: ReadonlyMap<string, { readonly username?: string; readonly displayName?: string }>,
  parentByConversationId: ReadonlyMap<string, string>,
  fallbackKind: ExternalEvidenceArtifact["kind"],
): ExternalEvidenceArtifact {
  if (!tweet || typeof tweet !== "object") {
    throw new Error("X API tweet payload must be an object.");
  }
  const record = tweet as Record<string, unknown>;
  const artifactId = requireString(record.id, "tweet.id");
  const conversationId = optionalString(record.conversation_id);
  const authorId = optionalString(record.author_id);
  const author = authorId ? authors.get(authorId) : undefined;
  return {
    platform: "x",
    artifactId,
    kind: classifyTweetKind(record, fallbackKind),
    sourceUrl: `https://x.com/i/status/${artifactId}`,
    text: requireString(record.text, "tweet.text"),
    ...(authorId ? { author: { id: authorId, username: author?.username, displayName: author?.displayName } } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(conversationId && parentByConversationId.has(conversationId)
      ? { parentArtifactId: parentByConversationId.get(conversationId) }
      : {}),
    metrics: parseMetrics(record.public_metrics),
    retrievedAt: new Date().toISOString(),
  };
}

function classifyTweetKind(
  record: Record<string, unknown>,
  fallbackKind: ExternalEvidenceArtifact["kind"],
): ExternalEvidenceArtifact["kind"] {
  const referenced = record.referenced_tweets;
  if (!Array.isArray(referenced)) {
    return fallbackKind;
  }
  if (referenced.some((item) => isReferenceType(item, "quoted"))) {
    return "quote";
  }
  if (referenced.some((item) => isReferenceType(item, "replied_to"))) {
    return "reply";
  }
  return fallbackKind;
}

function isReferenceType(value: unknown, type: string): boolean {
  return Boolean(value && typeof value === "object" && (value as { readonly type?: unknown }).type === type);
}

function parseAuthors(users: unknown): ReadonlyMap<string, { readonly username?: string; readonly displayName?: string }> {
  const authors = new Map<string, { readonly username?: string; readonly displayName?: string }>();
  if (!Array.isArray(users)) {
    return authors;
  }
  for (const user of users) {
    if (!user || typeof user !== "object") {
      continue;
    }
    const record = user as Record<string, unknown>;
    const id = optionalString(record.id);
    if (!id) {
      continue;
    }
    authors.set(id, {
      username: optionalString(record.username),
      displayName: optionalString(record.name),
    });
  }
  return authors;
}

function parseMetrics(value: unknown): ExternalEvidenceMetrics | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return {
    replies: optionalNumber(record.reply_count),
    reposts: optionalNumber(record.retweet_count),
    likes: optionalNumber(record.like_count),
    quotes: optionalNumber(record.quote_count),
    bookmarks: optionalNumber(record.bookmark_count),
    impressions: optionalNumber(record.impression_count),
  };
}

function readRequiredArg(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseNonNegativeInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }
  return parsed;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function printHelp(): void {
  console.log([
    "Usage:",
    "  kiln external-engagement x-report --url <x-url-or-id> [--url <x-url-or-id>...] [options]",
    "  kiln external-engagement x-report --input <path> [options]",
    "",
    "Options:",
    "  --max-replies N          Maximum replies to fetch per root post (default: 25)",
    "  --dry-run                Print the planned bounded report without network access",
    "  --output PATH            Write report JSON to PATH",
    "  --access-token-env NAME  Env var containing OAuth2 access token (default: KILN_X_OAUTH2_ACCESS_TOKEN)",
  ].join("\n"));
}
