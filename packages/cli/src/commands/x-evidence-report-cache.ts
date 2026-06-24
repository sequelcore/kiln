import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExternalEvidenceReport, XEvidenceQuery } from "@kilnai/core";

const X_EVIDENCE_REPORT_CACHE_VERSION = 1;

export interface XEvidenceReportCache {
  read(query: XEvidenceQuery): ExternalEvidenceReport | undefined;
  write(report: ExternalEvidenceReport): void;
}

export class FileXEvidenceReportCache implements XEvidenceReportCache {
  constructor(private readonly cacheDir: string) {}

  read(query: XEvidenceQuery): ExternalEvidenceReport | undefined {
    const path = this.cachePath(query);
    if (!existsSync(path)) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
      if (!isCacheFile(parsed)) {
        return undefined;
      }
      return parsed.report;
    } catch {
      return undefined;
    }
  }

  write(report: ExternalEvidenceReport): void {
    mkdirSync(this.cacheDir, { recursive: true });
    const payload: XEvidenceReportCacheFile = {
      version: X_EVIDENCE_REPORT_CACHE_VERSION,
      cachedAt: new Date().toISOString(),
      report,
    };
    writeFileSync(this.cachePath(report.query), `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  }

  private cachePath(query: XEvidenceQuery): string {
    return join(this.cacheDir, `${buildXEvidenceReportCacheKey(query)}.json`);
  }
}

interface XEvidenceReportCacheFile {
  readonly version: number;
  readonly cachedAt: string;
  readonly report: ExternalEvidenceReport;
}

function buildXEvidenceReportCacheKey(query: XEvidenceQuery): string {
  const payload = JSON.stringify({
    version: X_EVIDENCE_REPORT_CACHE_VERSION,
    maxRepliesPerPost: query.maxRepliesPerPost,
    postIds: query.references.map((reference) => reference.postId),
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

function isCacheFile(value: unknown): value is XEvidenceReportCacheFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.version === X_EVIDENCE_REPORT_CACHE_VERSION
    && typeof record.cachedAt === "string"
    && isExternalEvidenceReport(record.report);
}

function isExternalEvidenceReport(value: unknown): value is ExternalEvidenceReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.reportId === "string"
    && typeof record.generatedAt === "string"
    && record.source === "x"
    && Array.isArray(record.capabilities)
    && Array.isArray(record.prohibitedActions)
    && isXEvidenceQuery(record.query)
    && typeof record.budget === "object"
    && Array.isArray(record.artifacts)
    && Array.isArray(record.signals);
}

function isXEvidenceQuery(value: unknown): value is XEvidenceQuery {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return Array.isArray(record.references)
    && record.references.every(isXPostReference)
    && typeof record.maxRepliesPerPost === "number";
}

function isXPostReference(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.platform === "x"
    && typeof record.postId === "string"
    && typeof record.sourceUrl === "string";
}
