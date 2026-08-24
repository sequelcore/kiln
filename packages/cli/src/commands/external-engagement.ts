import { Buffer } from "node:buffer";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  buildExternalEngagementReviewReport,
  buildExternalEvidenceReport,
  buildFeatureCandidateDecisionReport,
  buildFeatureCandidateReport,
  buildFeatureIntakeReport,
  createXOAuth2ClientIdRef,
  createXOAuth2ClientSecretRef,
  createXOAuth2RefreshTokenRef,
  createXReadAccessTokenRef,
  estimateXSearchDiscoveryBudget,
  estimateXEvidenceRequestBudget,
  extractCommunitySignalsFromEvidence,
  normalizeXSearchDiscoveryScope,
  normalizeXPostReferences,
  type ExternalDiscoveryScope,
  type ExternalEvidenceArtifact,
  type ExternalEvidenceMetrics,
  type ExternalEvidenceReport,
  type FeatureCandidateDecisionInput,
  type FeatureCandidateDecisionReport,
  type FeatureCandidateReport,
  type FeatureIntakeReport,
  type SecretRef,
  type SecretResolver,
  type XEvidenceRequestBudget,
  type XPostReference,
} from "@kilnai/core";
import type { KilnAppConfig } from "../config.js";
import {
  assertPrivateStateFileTargetSync,
  ensurePrivateStateDirectorySync,
} from "../application/private-project-state-filesystem.js";
import { EnvSecretResolver, EnvSecretResolverError } from "../credentials/env-secret-resolver.js";
import { FileXEvidenceReportCache, type XEvidenceReportCache } from "./x-evidence-report-cache.js";
import { resolveProjectRoot } from "../application/project-root-resolver.js";
import { resolveProjectStateBinding, type ProjectStateBinding } from "../application/project-state-root.js";

const X_POST_LOOKUP_LIMIT = 100;
const X_RECENT_SEARCH_MAX_RESULTS_LIMIT = 100;
const DEFAULT_FEATURE_INTAKE_FILENAME = "feature-intake.json";

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

export interface XSearchFetchInput {
  readonly accessToken: string;
  readonly discoveryScope: ExternalDiscoveryScope;
  readonly generatedAt: string;
  readonly reportId: string;
  readonly budget: XEvidenceRequestBudget;
}

export interface XSearchFetcher {
  fetchSearch(input: XSearchFetchInput): Promise<ExternalEvidenceReport>;
}

export interface XLiveSmokeInput {
  readonly accessToken: string;
  readonly generatedAt: string;
  readonly credentialRefId: string;
}

export interface XLiveSmokeResult {
  readonly source: "x";
  readonly operation: "credential-smoke";
  readonly status: "ok";
  readonly generatedAt: string;
  readonly credentialRefId: string;
  readonly requestCount: 1;
  readonly authenticatedUser: {
    readonly id: string;
    readonly username?: string;
    readonly displayName?: string;
  };
  readonly rateLimit?: XRateLimitSnapshot;
}

export interface XLiveSmokeTester {
  smoke(input: XLiveSmokeInput): Promise<XLiveSmokeResult>;
}

export interface XOAuth2RefreshInput {
  readonly refreshToken: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly generatedAt: string;
}

export interface XOAuth2RefreshResult {
  readonly generatedAt: string;
  readonly tokenType?: string;
  readonly expiresInSeconds?: number;
  readonly scopes?: readonly string[];
  readonly accessToken: string;
  readonly refreshToken?: string;
}

export interface XOAuth2RefreshSummary {
  readonly source: "x";
  readonly operation: "oauth2-refresh";
  readonly status: "ok";
  readonly generatedAt: string;
  readonly secretOutputPath: string;
  readonly accessTokenReceived: true;
  readonly refreshTokenReceived: boolean;
  readonly expiresInSeconds?: number;
  readonly scopes?: readonly string[];
  readonly credentialRefIds: {
    readonly refreshToken: string;
    readonly clientId: string;
    readonly clientSecret?: string;
  };
}

export interface XOAuth2TokenRefresher {
  refresh(input: XOAuth2RefreshInput): Promise<XOAuth2RefreshResult>;
}

export interface ExternalEngagementCommandDependencies {
  readonly fetcher?: XEvidenceFetcher;
  readonly searchFetcher?: XSearchFetcher;
  readonly smokeTester?: XLiveSmokeTester;
  readonly tokenRefresher?: XOAuth2TokenRefresher;
  readonly reportCache?: XEvidenceReportCache;
  readonly credentialResolver?: SecretResolver;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => Date;
  readonly reportId?: () => string;
  readonly defaultCacheDir?: string;
  readonly defaultArtifactDir?: string;
  /** Strict test/embedding seam for the operator-owned private project state. */
  readonly projectStateBinding?: ProjectStateBinding;
  /** Internal effect-time guard root populated by the command composition. */
  readonly privateStateRoot?: string;
}

interface XReportFlags {
  readonly urls: readonly string[];
  readonly inputPath?: string;
  readonly outputPath?: string;
  readonly maxRepliesPerPost: number;
  readonly dryRun: boolean;
  readonly accessTokenEnv: string;
  readonly cacheDir?: string;
  readonly cacheMode: "read-write" | "disabled" | "refresh";
}

interface XSearchFlags {
  readonly query?: string;
  readonly outputPath?: string;
  readonly maxPosts: number;
  readonly maxRepliesPerPost: number;
  readonly maxRequests?: number;
  readonly searchScope: "recent";
  readonly since?: string;
  readonly until?: string;
  readonly dryRun: boolean;
  readonly accessTokenEnv: string;
  readonly cacheDir?: string;
  readonly cacheMode: "read-write" | "disabled" | "refresh";
}

interface XSmokeFlags {
  readonly outputPath?: string;
  readonly allowLive: boolean;
  readonly accessTokenEnv: string;
}

interface XRefreshFlags {
  readonly allowLive: boolean;
  readonly secretOutputPath?: string;
  readonly publicClient: boolean;
  readonly refreshTokenEnv: string;
  readonly clientIdEnv: string;
  readonly clientSecretEnv: string;
}

interface XCandidatesFlags {
  readonly reportPath?: string;
  readonly outputPath?: string;
}

interface XReviewFlags {
  readonly candidatesPath?: string;
  readonly outputPath?: string;
}

interface XDecideFlags {
  readonly candidatesPath?: string;
  readonly decisionsPath?: string;
  readonly outputPath?: string;
}

interface XPromoteFlags {
  readonly decisionsPath?: string;
  readonly outputPath?: string;
  readonly workspaceDir: string;
}

interface XRateLimitSnapshot {
  readonly limit?: number;
  readonly remaining?: number;
  readonly resetAt?: string;
}

export async function externalEngagementCommand(
  _config: KilnAppConfig,
  subcommand: string | undefined,
  args: readonly string[],
  dependencies: ExternalEngagementCommandDependencies = {},
): Promise<void> {
  const projectBinding = dependencies.projectStateBinding
    ?? resolveProjectStateBinding(resolveProjectRoot({ cwd: process.cwd() }).rootPath);
  const effectiveDependencies: ExternalEngagementCommandDependencies = {
    ...dependencies,
    defaultCacheDir: dependencies.defaultCacheDir ?? join(projectBinding.cachePath, "external-engagement", "x-report"),
    defaultArtifactDir: dependencies.defaultArtifactDir ?? join(projectBinding.evidencePath, "external-engagement"),
    privateStateRoot: projectBinding.projectStateRoot,
  };
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printHelp();
    return;
  }
  if (subcommand !== "x-report" && subcommand !== "x-search" && subcommand !== "x-smoke" && subcommand !== "x-refresh" && subcommand !== "x-candidates" && subcommand !== "x-review" && subcommand !== "x-decide" && subcommand !== "x-promote") {
    throw new Error(`Unknown external-engagement command '${subcommand}'. Use x-report, x-search, x-smoke, x-refresh, x-candidates, x-review, x-decide, or x-promote.`);
  }
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  if (subcommand === "x-smoke") {
    await runXSmoke(parseXSmokeFlags(args), effectiveDependencies);
    return;
  }
  if (subcommand === "x-search") {
    await runXSearch(parseXSearchFlags(args), effectiveDependencies);
    return;
  }
  if (subcommand === "x-refresh") {
    await runXRefresh(parseXRefreshFlags(args), effectiveDependencies);
    return;
  }
  if (subcommand === "x-candidates") {
    await runXCandidates(parseXCandidatesFlags(args), effectiveDependencies);
    return;
  }
  if (subcommand === "x-review") {
    await runXReview(parseXReviewFlags(args), effectiveDependencies);
    return;
  }
  if (subcommand === "x-decide") {
    await runXDecide(parseXDecideFlags(args), effectiveDependencies);
    return;
  }
  if (subcommand === "x-promote") {
    await runXPromote(parseXPromoteFlags(args, effectiveDependencies.defaultArtifactDir!), effectiveDependencies);
    return;
  }
  await runXReport(parseXReportFlags(args), effectiveDependencies);
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
  const query = { references, maxRepliesPerPost: flags.maxRepliesPerPost };
  if (flags.dryRun) {
    printOrWrite(buildExternalEvidenceReport({
      reportId,
      generatedAt,
      source: "x",
      query,
      budget,
      artifacts: [],
      signals: [],
    }), flags.outputPath, dependencies.privateStateRoot);
    return;
  }
  const cache = flags.cacheMode === "disabled"
    ? undefined
    : dependencies.reportCache ?? new FileXEvidenceReportCache(
      flags.cacheDir ?? dependencies.defaultCacheDir!,
      isPrivateStateTarget(dependencies.privateStateRoot, flags.cacheDir ?? dependencies.defaultCacheDir!)
        ? { privateStateRoot: dependencies.privateStateRoot }
        : undefined,
    );
  if (cache && flags.cacheMode !== "refresh") {
    const cached = cache.read(query);
    if (cached) {
      printOrWrite(cached, flags.outputPath, dependencies.privateStateRoot);
      return;
    }
  }
  const accessTokenRef = createXReadAccessTokenRef({ envName: flags.accessTokenEnv });
  const credentialResolver = dependencies.credentialResolver ?? new EnvSecretResolver({
    env: dependencies.env,
    now: dependencies.now,
  });
  const accessToken = await resolveAccessToken(credentialResolver, accessTokenRef, flags.accessTokenEnv);
  const fetcher = dependencies.fetcher ?? new XApiEvidenceFetcher();
  const report = await fetcher.fetchEvidence({
    accessToken,
    references,
    maxRepliesPerPost: flags.maxRepliesPerPost,
    generatedAt,
    reportId,
    budget,
  });
  cache?.write(report);
  printOrWrite(report, flags.outputPath, dependencies.privateStateRoot);
}

async function runXSearch(
  flags: XSearchFlags,
  dependencies: ExternalEngagementCommandDependencies,
): Promise<void> {
  if (!flags.query) {
    throw new Error("external-engagement x-search requires --query.");
  }
  const generatedAt = (dependencies.now?.() ?? new Date()).toISOString();
  const reportId = dependencies.reportId?.() ?? `external-engagement-search-${generatedAt.replace(/[:.]/gu, "-")}`;
  const discoveryScope = normalizeXSearchDiscoveryScope({
    query: flags.query,
    maxPosts: flags.maxPosts,
    maxRepliesPerPost: flags.maxRepliesPerPost,
    searchScope: flags.searchScope,
    ...(flags.since ? { since: flags.since } : {}),
    ...(flags.until ? { until: flags.until } : {}),
    ...(flags.maxRequests ? { maxRequests: flags.maxRequests } : {}),
  });
  const budget = estimateXSearchDiscoveryBudget({
    maxPosts: discoveryScope.maxPosts,
    maxRepliesPerPost: discoveryScope.maxRepliesPerPost,
    includeAuthors: true,
  });
  if (discoveryScope.maxRequests && budget.estimatedRequests > discoveryScope.maxRequests) {
    throw new Error(
      `estimated X search requests ${budget.estimatedRequests} exceed --max-requests ${discoveryScope.maxRequests}.`,
    );
  }
  const query = {
    references: [],
    maxRepliesPerPost: discoveryScope.maxRepliesPerPost,
    discoveryScope,
  };
  if (flags.dryRun) {
    printOrWrite(buildExternalEvidenceReport({
      reportId,
      generatedAt,
      source: "x",
      query,
      budget,
      artifacts: [],
      signals: [],
    }), flags.outputPath, dependencies.privateStateRoot);
    return;
  }
  const cache = flags.cacheMode === "disabled"
    ? undefined
    : dependencies.reportCache ?? new FileXEvidenceReportCache(
      flags.cacheDir ?? dependencies.defaultCacheDir!,
      isPrivateStateTarget(dependencies.privateStateRoot, flags.cacheDir ?? dependencies.defaultCacheDir!)
        ? { privateStateRoot: dependencies.privateStateRoot }
        : undefined,
    );
  if (cache && flags.cacheMode !== "refresh") {
    const cached = cache.read(query);
    if (cached) {
      printOrWrite(cached, flags.outputPath, dependencies.privateStateRoot);
      return;
    }
  }
  const accessTokenRef = createXReadAccessTokenRef({ envName: flags.accessTokenEnv });
  const credentialResolver = dependencies.credentialResolver ?? new EnvSecretResolver({
    env: dependencies.env,
    now: dependencies.now,
  });
  const accessToken = await resolveAccessToken(
    credentialResolver,
    accessTokenRef,
    flags.accessTokenEnv,
    "x-search",
  );
  const searchFetcher = dependencies.searchFetcher ?? new XApiSearchFetcher();
  const report = await searchFetcher.fetchSearch({
    accessToken,
    discoveryScope,
    generatedAt,
    reportId,
    budget,
  });
  cache?.write(report);
  printOrWrite(report, flags.outputPath, dependencies.privateStateRoot);
}

async function runXSmoke(
  flags: XSmokeFlags,
  dependencies: ExternalEngagementCommandDependencies,
): Promise<void> {
  if (!flags.allowLive) {
    throw new Error("external-engagement x-smoke requires --allow-live.");
  }
  const generatedAt = (dependencies.now?.() ?? new Date()).toISOString();
  const accessTokenRef = createXReadAccessTokenRef({ envName: flags.accessTokenEnv });
  const credentialResolver = dependencies.credentialResolver ?? new EnvSecretResolver({
    env: dependencies.env,
    now: dependencies.now,
  });
  const accessToken = await resolveAccessToken(credentialResolver, accessTokenRef, flags.accessTokenEnv);
  const smokeTester = dependencies.smokeTester ?? new XApiLiveSmokeTester();
  const result = await smokeTester.smoke({
    accessToken,
    generatedAt,
    credentialRefId: accessTokenRef.id,
  });
  printOrWriteJson(result, flags.outputPath, dependencies.privateStateRoot);
}

async function runXRefresh(
  flags: XRefreshFlags,
  dependencies: ExternalEngagementCommandDependencies,
): Promise<void> {
  if (!flags.allowLive) {
    throw new Error("external-engagement x-refresh requires --allow-live.");
  }
  if (!flags.secretOutputPath) {
    throw new Error("external-engagement x-refresh requires --secret-output.");
  }
  const generatedAt = (dependencies.now?.() ?? new Date()).toISOString();
  const refreshTokenRef = createXOAuth2RefreshTokenRef({ envName: flags.refreshTokenEnv });
  const clientIdRef = createXOAuth2ClientIdRef({ envName: flags.clientIdEnv });
  const clientSecretRef = flags.publicClient
    ? undefined
    : createXOAuth2ClientSecretRef({ envName: flags.clientSecretEnv });
  const credentialResolver = dependencies.credentialResolver ?? new EnvSecretResolver({
    env: dependencies.env,
    now: dependencies.now,
  });
  const refreshToken = await resolveUsableSecret(
    credentialResolver,
    refreshTokenRef,
    `external-engagement x-refresh requires ${flags.refreshTokenEnv}.`,
  );
  const clientId = await resolveUsableSecret(
    credentialResolver,
    clientIdRef,
    `external-engagement x-refresh requires ${flags.clientIdEnv}.`,
  );
  const clientSecret = clientSecretRef
    ? await resolveUsableSecret(
      credentialResolver,
      clientSecretRef,
      `external-engagement x-refresh requires ${flags.clientSecretEnv}.`,
    )
    : undefined;
  const tokenRefresher = dependencies.tokenRefresher ?? new XApiOAuth2TokenRefresher();
  const result = await tokenRefresher.refresh({
    refreshToken,
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
    generatedAt,
  });
  writeSecretJson(flags.secretOutputPath, {
    source: "x",
    operation: "oauth2-refresh",
    generatedAt: result.generatedAt,
    ...(result.tokenType ? { tokenType: result.tokenType } : {}),
    ...(typeof result.expiresInSeconds === "number" ? { expiresInSeconds: result.expiresInSeconds } : {}),
    ...(result.scopes ? { scopes: result.scopes } : {}),
    accessToken: result.accessToken,
    ...(result.refreshToken ? { refreshToken: result.refreshToken } : {}),
  }, dependencies.privateStateRoot);
  const summary: XOAuth2RefreshSummary = {
    source: "x",
    operation: "oauth2-refresh",
    status: "ok",
    generatedAt: result.generatedAt,
    secretOutputPath: flags.secretOutputPath,
    accessTokenReceived: true,
    refreshTokenReceived: Boolean(result.refreshToken),
    ...(typeof result.expiresInSeconds === "number" ? { expiresInSeconds: result.expiresInSeconds } : {}),
    ...(result.scopes ? { scopes: result.scopes } : {}),
    credentialRefIds: {
      refreshToken: refreshTokenRef.id,
      clientId: clientIdRef.id,
      ...(clientSecretRef ? { clientSecret: clientSecretRef.id } : {}),
    },
  };
  printOrWriteJson(summary, undefined);
}

async function runXCandidates(
  flags: XCandidatesFlags,
  dependencies: ExternalEngagementCommandDependencies,
): Promise<void> {
  if (!flags.reportPath) {
    throw new Error("external-engagement x-candidates requires --report.");
  }
  const sourceReport = parseExternalEvidenceReport(readJsonFile(flags.reportPath), flags.reportPath);
  const signals = sourceReport.signals.length > 0
    ? sourceReport.signals
    : extractCommunitySignalsFromEvidence({ artifacts: sourceReport.artifacts });
  const generatedAt = (dependencies.now?.() ?? new Date()).toISOString();
  const reportId = dependencies.reportId?.() ?? `external-engagement-candidates-${generatedAt.replace(/[:.]/gu, "-")}`;
  const candidateReport = buildFeatureCandidateReport({
    reportId,
    generatedAt,
    sourceReportId: sourceReport.reportId,
    signals,
  });
  printOrWriteFeatureCandidateReport(candidateReport, flags.outputPath, dependencies.privateStateRoot);
}

async function runXReview(
  flags: XReviewFlags,
  dependencies: ExternalEngagementCommandDependencies,
): Promise<void> {
  if (!flags.candidatesPath) {
    throw new Error("external-engagement x-review requires --candidates.");
  }
  const candidateReport = parseFeatureCandidateReport(readJsonFile(flags.candidatesPath), flags.candidatesPath);
  const generatedAt = (dependencies.now?.() ?? new Date()).toISOString();
  const reportId = dependencies.reportId?.() ?? `external-engagement-review-${generatedAt.replace(/[:.]/gu, "-")}`;
  const review = buildExternalEngagementReviewReport({
    reportId,
    generatedAt,
    candidateReport,
  });
  printOrWriteReviewMarkdown(review.markdown, flags.outputPath, dependencies.privateStateRoot);
}

async function runXDecide(
  flags: XDecideFlags,
  dependencies: ExternalEngagementCommandDependencies,
): Promise<void> {
  if (!flags.candidatesPath) {
    throw new Error("external-engagement x-decide requires --candidates.");
  }
  if (!flags.decisionsPath) {
    throw new Error("external-engagement x-decide requires --decisions.");
  }
  const candidateReport = parseFeatureCandidateReport(readJsonFile(flags.candidatesPath), flags.candidatesPath);
  const decisions = parseFeatureCandidateDecisionInputs(readJsonFile(flags.decisionsPath), flags.decisionsPath);
  const generatedAt = (dependencies.now?.() ?? new Date()).toISOString();
  const reportId = dependencies.reportId?.() ?? `external-engagement-decisions-${generatedAt.replace(/[:.]/gu, "-")}`;
  const decisionReport = buildFeatureCandidateDecisionReport({
    reportId,
    generatedAt,
    candidateReport,
    decisions,
  });
  printOrWriteFeatureCandidateDecisionReport(decisionReport, flags.outputPath, dependencies.privateStateRoot);
}

async function runXPromote(
  flags: XPromoteFlags,
  dependencies: ExternalEngagementCommandDependencies,
): Promise<void> {
  if (!flags.decisionsPath) {
    throw new Error("external-engagement x-promote requires --decisions.");
  }
  const decisionReport = parseFeatureCandidateDecisionReport(readJsonFile(flags.decisionsPath), flags.decisionsPath);
  const generatedAt = (dependencies.now?.() ?? new Date()).toISOString();
  const reportId = dependencies.reportId?.() ?? `external-engagement-intake-${generatedAt.replace(/[:.]/gu, "-")}`;
  const intakeReport = buildFeatureIntakeReport({
    reportId,
    generatedAt,
    decisionReport,
  });
  printOrWriteFeatureIntakeReport(
    intakeReport,
    flags.outputPath ?? defaultFeatureIntakePath(flags.workspaceDir),
    dependencies.privateStateRoot,
  );
}

async function resolveAccessToken(
  credentialResolver: SecretResolver,
  ref: SecretRef,
  envName: string,
  operation = "x-report",
): Promise<string> {
  return resolveUsableSecret(credentialResolver, ref, `external-engagement ${operation} requires ${envName} or --dry-run.`);
}

async function resolveUsableSecret(
  credentialResolver: SecretResolver,
  ref: SecretRef,
  missingMessage: string,
): Promise<string> {
  try {
    const resolved = await credentialResolver.resolve(ref);
    if (resolved.diagnostic.lifecycle && resolved.diagnostic.lifecycle.status !== "usable") {
      throw new Error(
        `Secret '${resolved.diagnostic.refId}' is not usable: ${resolved.diagnostic.lifecycle.status}.`,
      );
    }
    return resolved.value;
  } catch (error) {
    if (error instanceof EnvSecretResolverError && error.diagnostic.status === "missing") {
      throw new Error(missingMessage);
    }
    throw error;
  }
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

export class XApiSearchFetcher implements XSearchFetcher {
  async fetchSearch(input: XSearchFetchInput): Promise<ExternalEvidenceReport> {
    const searchParams: Record<string, string> = {
      query: `${input.discoveryScope.query} -is:reply`,
      max_results: String(Math.max(10, input.discoveryScope.maxPosts)),
      "tweet.fields": "created_at,author_id,conversation_id,public_metrics,referenced_tweets,lang",
      expansions: "author_id",
      "user.fields": "username,name,verified,public_metrics",
    };
    if (input.discoveryScope.since) {
      searchParams.start_time = input.discoveryScope.since;
    }
    if (input.discoveryScope.until) {
      searchParams.end_time = input.discoveryScope.until;
    }
    const response = await xGet(input.accessToken, "https://api.x.com/2/tweets/search/recent", searchParams);
    const rootPosts = parseTweetArtifacts(response, new Map(), "post").slice(0, input.discoveryScope.maxPosts);
    const references = rootPosts.map((artifact) => ({
      platform: "x" as const,
      postId: artifact.artifactId,
      sourceUrl: artifact.sourceUrl,
    }));
    const replies = await fetchReplies({
      accessToken: input.accessToken,
      references,
      maxRepliesPerPost: input.discoveryScope.maxRepliesPerPost,
      generatedAt: input.generatedAt,
      reportId: input.reportId,
      budget: input.budget,
    });
    return buildExternalEvidenceReport({
      reportId: input.reportId,
      generatedAt: input.generatedAt,
      source: "x",
      query: {
        references: [],
        maxRepliesPerPost: input.discoveryScope.maxRepliesPerPost,
        discoveryScope: input.discoveryScope,
      },
      budget: input.budget,
      artifacts: [...rootPosts, ...replies],
      signals: [],
    });
  }
}

export class XApiLiveSmokeTester implements XLiveSmokeTester {
  async smoke(input: XLiveSmokeInput): Promise<XLiveSmokeResult> {
    const response = await xGetWithRateLimit(input.accessToken, "https://api.x.com/2/users/me", {
      "user.fields": "id,username,name",
    });
    const user = parseAuthenticatedUser(response.payload);
    return {
      source: "x",
      operation: "credential-smoke",
      status: "ok",
      generatedAt: input.generatedAt,
      credentialRefId: input.credentialRefId,
      requestCount: 1,
      authenticatedUser: user,
      ...(response.rateLimit ? { rateLimit: response.rateLimit } : {}),
    };
  }
}

export class XApiOAuth2TokenRefresher implements XOAuth2TokenRefresher {
  async refresh(input: XOAuth2RefreshInput): Promise<XOAuth2RefreshResult> {
    const body = new URLSearchParams();
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", input.refreshToken);
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (input.clientSecret) {
      headers.Authorization = `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64")}`;
    } else {
      body.set("client_id", input.clientId);
    }
    const response = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers,
      body,
    });
    if (!response.ok) {
      throw new Error(`X OAuth2 refresh failed (${response.status}).`);
    }
    return parseOAuth2RefreshResult(await response.json(), input.generatedAt);
  }
}

function parseXReportFlags(args: readonly string[]): XReportFlags {
  const urls: string[] = [];
  let inputPath: string | undefined;
  let outputPath: string | undefined;
  let maxRepliesPerPost = 25;
  let dryRun = false;
  let accessTokenEnv = "KILN_X_OAUTH2_ACCESS_TOKEN";
  let cacheDir: string | undefined;
  let cacheMode: XReportFlags["cacheMode"] = "read-write";

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
    } else if (arg === "--cache-dir") {
      cacheDir = readRequiredArg(args, index, "--cache-dir");
      index += 1;
    } else if (arg === "--no-cache") {
      cacheMode = "disabled";
    } else if (arg === "--refresh-cache") {
      cacheMode = "refresh";
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
    cacheDir,
    cacheMode,
  };
}

function parseXSearchFlags(args: readonly string[]): XSearchFlags {
  let query: string | undefined;
  let outputPath: string | undefined;
  let maxPosts = 25;
  let maxRepliesPerPost = 3;
  let maxRequests: number | undefined;
  let searchScope: XSearchFlags["searchScope"] = "recent";
  let since: string | undefined;
  let until: string | undefined;
  let dryRun = false;
  let accessTokenEnv = "KILN_X_OAUTH2_ACCESS_TOKEN";
  let cacheDir: string | undefined;
  let cacheMode: XSearchFlags["cacheMode"] = "read-write";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--query") {
      query = readRequiredArg(args, index, "--query");
      index += 1;
    } else if (arg === "--output") {
      outputPath = readRequiredArg(args, index, "--output");
      index += 1;
    } else if (arg === "--max-posts") {
      maxPosts = parsePositiveInteger(readRequiredArg(args, index, "--max-posts"), "--max-posts");
      if (maxPosts > X_RECENT_SEARCH_MAX_RESULTS_LIMIT) {
        throw new Error(`--max-posts must be less than or equal to ${X_RECENT_SEARCH_MAX_RESULTS_LIMIT}.`);
      }
      index += 1;
    } else if (arg === "--max-replies") {
      maxRepliesPerPost = parseNonNegativeInteger(readRequiredArg(args, index, "--max-replies"), "--max-replies");
      if (maxRepliesPerPost > X_RECENT_SEARCH_MAX_RESULTS_LIMIT) {
        throw new Error(`--max-replies must be less than or equal to ${X_RECENT_SEARCH_MAX_RESULTS_LIMIT}.`);
      }
      index += 1;
    } else if (arg === "--max-requests") {
      maxRequests = parsePositiveInteger(readRequiredArg(args, index, "--max-requests"), "--max-requests");
      index += 1;
    } else if (arg === "--scope") {
      const value = readRequiredArg(args, index, "--scope");
      if (value !== "recent") {
        throw new Error("external-engagement x-search currently supports only --scope recent.");
      }
      searchScope = value;
      index += 1;
    } else if (arg === "--since") {
      since = readRequiredArg(args, index, "--since");
      index += 1;
    } else if (arg === "--until") {
      until = readRequiredArg(args, index, "--until");
      index += 1;
    } else if (arg === "--access-token-env") {
      accessTokenEnv = readRequiredArg(args, index, "--access-token-env");
      index += 1;
    } else if (arg === "--cache-dir") {
      cacheDir = readRequiredArg(args, index, "--cache-dir");
      index += 1;
    } else if (arg === "--no-cache") {
      cacheMode = "disabled";
    } else if (arg === "--refresh-cache") {
      cacheMode = "refresh";
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else {
      throw new Error(`Unknown external-engagement x-search option '${arg}'.`);
    }
  }

  return {
    query,
    outputPath,
    maxPosts,
    maxRepliesPerPost,
    maxRequests,
    searchScope,
    since,
    until,
    dryRun,
    accessTokenEnv,
    cacheDir,
    cacheMode,
  };
}

function parseXSmokeFlags(args: readonly string[]): XSmokeFlags {
  let outputPath: string | undefined;
  let allowLive = false;
  let accessTokenEnv = "KILN_X_OAUTH2_ACCESS_TOKEN";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--output") {
      outputPath = readRequiredArg(args, index, "--output");
      index += 1;
    } else if (arg === "--access-token-env") {
      accessTokenEnv = readRequiredArg(args, index, "--access-token-env");
      index += 1;
    } else if (arg === "--allow-live") {
      allowLive = true;
    } else {
      throw new Error(`Unknown external-engagement x-smoke option '${arg}'.`);
    }
  }

  return {
    outputPath,
    allowLive,
    accessTokenEnv,
  };
}

function parseXRefreshFlags(args: readonly string[]): XRefreshFlags {
  let allowLive = false;
  let secretOutputPath: string | undefined;
  let publicClient = false;
  let refreshTokenEnv = "KILN_X_OAUTH2_REFRESH_TOKEN";
  let clientIdEnv = "KILN_X_CLIENT_ID";
  let clientSecretEnv = "KILN_X_CLIENT_SECRET";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--allow-live") {
      allowLive = true;
    } else if (arg === "--public-client") {
      publicClient = true;
    } else if (arg === "--secret-output") {
      secretOutputPath = readRequiredArg(args, index, "--secret-output");
      index += 1;
    } else if (arg === "--refresh-token-env") {
      refreshTokenEnv = readRequiredArg(args, index, "--refresh-token-env");
      index += 1;
    } else if (arg === "--client-id-env") {
      clientIdEnv = readRequiredArg(args, index, "--client-id-env");
      index += 1;
    } else if (arg === "--client-secret-env") {
      clientSecretEnv = readRequiredArg(args, index, "--client-secret-env");
      index += 1;
    } else {
      throw new Error(`Unknown external-engagement x-refresh option '${arg}'.`);
    }
  }

  return {
    allowLive,
    secretOutputPath,
    publicClient,
    refreshTokenEnv,
    clientIdEnv,
    clientSecretEnv,
  };
}

function parseXCandidatesFlags(args: readonly string[]): XCandidatesFlags {
  let reportPath: string | undefined;
  let outputPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--report") {
      reportPath = readRequiredArg(args, index, "--report");
      index += 1;
    } else if (arg === "--output") {
      outputPath = readRequiredArg(args, index, "--output");
      index += 1;
    } else {
      throw new Error(`Unknown external-engagement x-candidates option '${arg}'.`);
    }
  }

  return {
    reportPath,
    outputPath,
  };
}

function parseXReviewFlags(args: readonly string[]): XReviewFlags {
  let candidatesPath: string | undefined;
  let outputPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--candidates") {
      candidatesPath = readRequiredArg(args, index, "--candidates");
      index += 1;
    } else if (arg === "--output") {
      outputPath = readRequiredArg(args, index, "--output");
      index += 1;
    } else {
      throw new Error(`Unknown external-engagement x-review option '${arg}'.`);
    }
  }

  return {
    candidatesPath,
    outputPath,
  };
}

function parseXDecideFlags(args: readonly string[]): XDecideFlags {
  let candidatesPath: string | undefined;
  let decisionsPath: string | undefined;
  let outputPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--candidates") {
      candidatesPath = readRequiredArg(args, index, "--candidates");
      index += 1;
    } else if (arg === "--decisions") {
      decisionsPath = readRequiredArg(args, index, "--decisions");
      index += 1;
    } else if (arg === "--output") {
      outputPath = readRequiredArg(args, index, "--output");
      index += 1;
    } else {
      throw new Error(`Unknown external-engagement x-decide option '${arg}'.`);
    }
  }

  return {
    candidatesPath,
    decisionsPath,
    outputPath,
  };
}

function parseXPromoteFlags(args: readonly string[], defaultArtifactDir: string): XPromoteFlags {
  let decisionsPath: string | undefined;
  let outputPath: string | undefined;
  let workspaceDir = defaultArtifactDir;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--decisions") {
      decisionsPath = readRequiredArg(args, index, "--decisions");
      index += 1;
    } else if (arg === "--output") {
      outputPath = readRequiredArg(args, index, "--output");
      index += 1;
    } else if (arg === "--workspace-dir") {
      workspaceDir = readRequiredArg(args, index, "--workspace-dir");
      index += 1;
    } else {
      throw new Error(`Unknown external-engagement x-promote option '${arg}'.`);
    }
  }

  return {
    decisionsPath,
    outputPath,
    workspaceDir,
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

function printOrWrite(
  report: ExternalEvidenceReport,
  outputPath: string | undefined,
  privateStateRoot?: string,
): void {
  printOrWriteJson(report, outputPath, privateStateRoot);
}

function printOrWriteJson(value: unknown, outputPath: string | undefined, privateStateRoot?: string): void {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (!outputPath) {
    console.log(body.trimEnd());
    return;
  }
  guardPrivateFileWrite(privateStateRoot, outputPath);
  mkdirSync(dirname(outputPath), { recursive: true });
  guardPrivateFileWrite(privateStateRoot, outputPath);
  writeFileSync(outputPath, body, "utf-8");
  console.log(`External engagement report written: ${outputPath}`);
}

function printOrWriteFeatureCandidateReport(
  report: FeatureCandidateReport,
  outputPath: string | undefined,
  privateStateRoot?: string,
): void {
  if (!outputPath) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  guardPrivateFileWrite(privateStateRoot, outputPath);
  mkdirSync(dirname(outputPath), { recursive: true });
  guardPrivateFileWrite(privateStateRoot, outputPath);
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  console.log(`External engagement feature candidates written: ${outputPath}`);
}

function printOrWriteReviewMarkdown(markdown: string, outputPath: string | undefined, privateStateRoot?: string): void {
  if (!outputPath) {
    console.log(markdown);
    return;
  }
  guardPrivateFileWrite(privateStateRoot, outputPath);
  mkdirSync(dirname(outputPath), { recursive: true });
  guardPrivateFileWrite(privateStateRoot, outputPath);
  writeFileSync(outputPath, `${markdown}\n`, "utf-8");
  console.log(`External engagement review written: ${outputPath}`);
}

function printOrWriteFeatureCandidateDecisionReport(
  report: FeatureCandidateDecisionReport,
  outputPath: string | undefined,
  privateStateRoot?: string,
): void {
  if (!outputPath) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  guardPrivateFileWrite(privateStateRoot, outputPath);
  mkdirSync(dirname(outputPath), { recursive: true });
  guardPrivateFileWrite(privateStateRoot, outputPath);
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  console.log(`External engagement candidate decisions written: ${outputPath}`);
}

function printOrWriteFeatureIntakeReport(
  report: FeatureIntakeReport,
  outputPath: string,
  privateStateRoot?: string,
): void {
  guardPrivateFileWrite(privateStateRoot, outputPath);
  mkdirSync(dirname(outputPath), { recursive: true });
  guardPrivateFileWrite(privateStateRoot, outputPath);
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  console.log(`External engagement feature intake written: ${outputPath}`);
}

function defaultFeatureIntakePath(workspaceDir: string): string {
  return join(workspaceDir, DEFAULT_FEATURE_INTAKE_FILENAME);
}

function guardPrivateFileWrite(privateStateRoot: string | undefined, filePath: string): void {
  if (!isPrivateStateTarget(privateStateRoot, filePath)) return;
  ensurePrivateStateDirectorySync(privateStateRoot!, dirname(filePath));
  assertPrivateStateFileTargetSync(privateStateRoot!, filePath);
}

function isPrivateStateTarget(privateStateRoot: string | undefined, targetPath: string): boolean {
  if (!privateStateRoot) return false;
  const path = relative(resolve(privateStateRoot), resolve(targetPath));
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !/^[a-zA-Z]:[\\/]/u.test(path));
}

function writeSecretJson(outputPath: string, value: unknown, privateStateRoot?: string): void {
  guardPrivateFileWrite(privateStateRoot, outputPath);
  mkdirSync(dirname(outputPath), { recursive: true });
  guardPrivateFileWrite(privateStateRoot, outputPath);
  writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
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
  return (await xGetWithRateLimit(accessToken, endpoint, params)).payload;
}

async function xGetWithRateLimit(
  accessToken: string,
  endpoint: string,
  params: Readonly<Record<string, string>>,
): Promise<{ readonly payload: unknown; readonly rateLimit?: XRateLimitSnapshot }> {
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
  return {
    payload: await response.json(),
    ...parseRateLimitHeaders(response.headers),
  };
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

function parseAuthenticatedUser(payload: unknown): XLiveSmokeResult["authenticatedUser"] {
  if (!payload || typeof payload !== "object") {
    throw new Error("X API authenticated user payload must be an object.");
  }
  const data = (payload as { readonly data?: unknown }).data;
  if (!data || typeof data !== "object") {
    throw new Error("X API authenticated user payload must include data.");
  }
  const record = data as Record<string, unknown>;
  return {
    id: requireString(record.id, "user.id"),
    username: optionalString(record.username),
    displayName: optionalString(record.name),
  };
}

function parseOAuth2RefreshResult(payload: unknown, generatedAt: string): XOAuth2RefreshResult {
  if (!payload || typeof payload !== "object") {
    throw new Error("X OAuth2 refresh payload must be an object.");
  }
  const record = payload as Record<string, unknown>;
  return {
    generatedAt,
    accessToken: requireString(record.access_token, "oauth2.access_token"),
    tokenType: optionalString(record.token_type),
    expiresInSeconds: optionalNumber(record.expires_in),
    scopes: parseScopeList(record.scope),
    refreshToken: optionalString(record.refresh_token),
  };
}

function parseExternalEvidenceReport(payload: unknown, path: string): ExternalEvidenceReport {
  if (!payload || typeof payload !== "object") {
    throw new Error(`External evidence report must be an object: ${path}`);
  }
  const record = payload as Partial<ExternalEvidenceReport>;
  if (
    typeof record.reportId !== "string"
    || record.source !== "x"
    || !record.query
    || !record.budget
    || !Array.isArray(record.artifacts)
    || !Array.isArray(record.signals)
  ) {
    throw new Error(`Invalid external evidence report: ${path}`);
  }
  return record as ExternalEvidenceReport;
}

function parseFeatureCandidateReport(payload: unknown, path: string): FeatureCandidateReport {
  if (!payload || typeof payload !== "object") {
    throw new Error(`Feature candidate report must be an object: ${path}`);
  }
  const record = payload as Partial<FeatureCandidateReport>;
  if (
    typeof record.reportId !== "string"
    || typeof record.sourceReportId !== "string"
    || !Array.isArray(record.candidates)
  ) {
    throw new Error(`Invalid feature candidate report: ${path}`);
  }
  return record as FeatureCandidateReport;
}

function parseFeatureCandidateDecisionInputs(payload: unknown, path: string): readonly FeatureCandidateDecisionInput[] {
  if (!payload || typeof payload !== "object") {
    throw new Error(`Feature candidate decisions must be an object: ${path}`);
  }
  const record = payload as { readonly decisions?: unknown };
  if (!Array.isArray(record.decisions)) {
    throw new Error(`Feature candidate decisions must include decisions array: ${path}`);
  }
  return Object.freeze(record.decisions.map((decision, index): FeatureCandidateDecisionInput => {
    if (!decision || typeof decision !== "object") {
      throw new Error(`Feature candidate decision must be an object at index ${index}: ${path}`);
    }
    const item = decision as Record<string, unknown>;
    if (
      typeof item.candidateId !== "string"
      || typeof item.decision !== "string"
      || !Array.isArray(item.evidenceArtifactIds)
      || !item.evidenceArtifactIds.every((artifactId) => typeof artifactId === "string")
    ) {
      throw new Error(`Invalid feature candidate decision at index ${index}: ${path}`);
    }
    return {
      candidateId: item.candidateId,
      decision: item.decision as FeatureCandidateDecisionInput["decision"],
      evidenceArtifactIds: Object.freeze([...item.evidenceArtifactIds]) as readonly string[],
      ...(typeof item.reason === "string" ? { reason: item.reason } : {}),
      ...(typeof item.narrowedScope === "string" ? { narrowedScope: item.narrowedScope } : {}),
    };
  }));
}

function parseFeatureCandidateDecisionReport(payload: unknown, path: string): FeatureCandidateDecisionReport {
  if (!payload || typeof payload !== "object") {
    throw new Error(`Feature candidate decision report must be an object: ${path}`);
  }
  const record = payload as Partial<FeatureCandidateDecisionReport>;
  if (
    typeof record.reportId !== "string"
    || typeof record.sourceCandidateReportId !== "string"
    || !Array.isArray(record.decisions)
  ) {
    throw new Error(`Invalid feature candidate decision report: ${path}`);
  }
  return record as FeatureCandidateDecisionReport;
}

function parseScopeList(value: unknown): readonly string[] | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return Object.freeze(value.split(/\s+/u).filter((scope) => scope.length > 0));
}

function parseRateLimitHeaders(headers: Headers): { readonly rateLimit?: XRateLimitSnapshot } {
  const limit = optionalHeaderNumber(headers.get("x-rate-limit-limit"));
  const remaining = optionalHeaderNumber(headers.get("x-rate-limit-remaining"));
  const reset = optionalHeaderNumber(headers.get("x-rate-limit-reset"));
  if (typeof limit !== "number" && typeof remaining !== "number" && typeof reset !== "number") {
    return {};
  }
  return {
    rateLimit: {
      ...(typeof limit === "number" ? { limit } : {}),
      ...(typeof remaining === "number" ? { remaining } : {}),
      ...(typeof reset === "number" ? { resetAt: new Date(reset * 1000).toISOString() } : {}),
    },
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

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer.`);
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

function optionalHeaderNumber(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function printHelp(): void {
  console.log([
    "Usage:",
    "  kiln external-engagement x-report --url <x-url-or-id> [--url <x-url-or-id>...] [options]",
    "  kiln external-engagement x-report --input <path> [options]",
    "  kiln external-engagement x-search --query <query-or-hashtag> [options]",
    "  kiln external-engagement x-smoke --allow-live [options]",
    "  kiln external-engagement x-refresh --allow-live --secret-output <path> [options]",
    "  kiln external-engagement x-candidates --report <path> [options]",
    "  kiln external-engagement x-review --candidates <path> [options]",
    "  kiln external-engagement x-decide --candidates <path> --decisions <path> [options]",
    "  kiln external-engagement x-promote --decisions <path> [options]",
    "",
    "Options:",
    "  --query QUERY           Bounded X search query for x-search",
    "  --max-posts N           Maximum root posts to discover for x-search (default: 25)",
    "  --max-replies N          Maximum replies per root post (x-report default: 25; x-search default: 3)",
    "  --max-requests N         Fail before credentials/network when estimated requests exceed N",
    "  --scope recent           X search scope; only recent is currently supported",
    "  --since ISO              Optional recent-search start time",
    "  --until ISO              Optional recent-search end time",
    "  --dry-run                Print the planned bounded report without network access",
    "  --allow-live             Required for x-smoke live network access",
    "  --secret-output PATH     Write refreshed OAuth2 tokens to PATH for x-refresh",
    "  --public-client          Refresh without a client secret for OAuth2 public clients",
    "  --cache-dir PATH         Cache x-report JSON under PATH (default: private project cache)",
    "  --no-cache               Disable x-report cache reads and writes",
    "  --refresh-cache          Bypass cache reads and replace the cached x-report",
    "  --output PATH            Write report JSON to PATH",
    "  --report PATH            Read an existing x-report JSON for x-candidates",
    "  --candidates PATH        Read an existing x-candidates JSON for x-review",
    "  --decisions PATH         Read operator candidate decisions or a decision report",
    "  --workspace-dir PATH     Workspace root for default x-promote output (default: current directory)",
    "  --access-token-env NAME  Env var containing OAuth2 access token (default: KILN_X_OAUTH2_ACCESS_TOKEN)",
    "  --refresh-token-env NAME Env var containing OAuth2 refresh token (default: KILN_X_OAUTH2_REFRESH_TOKEN)",
    "  --client-id-env NAME     Env var containing OAuth2 client id (default: KILN_X_CLIENT_ID)",
    "  --client-secret-env NAME Env var containing OAuth2 client secret (default: KILN_X_CLIENT_SECRET)",
  ].join("\n"));
}
