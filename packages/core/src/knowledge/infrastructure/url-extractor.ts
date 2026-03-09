// UrlExtractor -- fetches web content via Jina Reader with raw fetch fallback

import { KilnError } from "../../engine/errors.js";
import { withRetry } from "../../agents/infrastructure/retry.js";
import type { ContentExtractor, ExtractedContent, KnowledgeSourceType, ExtractionOptions } from "../../engine/domain/knowledge-source.js";

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class UrlExtractor implements ContentExtractor {
  readonly supportedTypes: readonly KnowledgeSourceType[] = ["url"];

  async extract(uri: string, _type: KnowledgeSourceType, options?: ExtractionOptions): Promise<ExtractedContent> {
    const extractedAt = new Date().toISOString();

    try {
      const content = await withRetry(
        async () => {
          const res = await fetch(`https://r.jina.ai/${uri}`, {
            headers: { Accept: "text/markdown", ...options?.headers },
          });
          if (!res.ok) {
            const err = new Error(`Jina Reader returned ${res.status}`);
            (err as unknown as Record<string, unknown>)["status"] = res.status;
            throw err;
          }
          return res.text();
        },
        {
          maxRetries: 3,
          baseDelayMs: 1000,
          isRetryable: (err) => {
            const status = (err as Record<string, unknown>)?.["status"];
            return typeof status === "number" && isRetryableStatus(status);
          },
        },
      );

      return { content, metadata: { source: uri, extractedAt } };
    } catch {
      // Jina failed -- fallback to raw fetch
      try {
        const content = await withRetry(
          async () => {
            const res = await fetch(uri, {
              headers: options?.headers ? { ...options.headers } : undefined,
            });
            if (!res.ok) {
              const err = new Error(`Fetch returned ${res.status}`);
              (err as unknown as Record<string, unknown>)["status"] = res.status;
              throw err;
            }
            const html = await res.text();
            return stripHtmlTags(html);
          },
          {
            maxRetries: 2,
            baseDelayMs: 500,
            isRetryable: (err) => {
              const status = (err as Record<string, unknown>)?.["status"];
              return typeof status === "number" && isRetryableStatus(status);
            },
          },
        );

        return { content, metadata: { source: uri, extractedAt, fallback: true } };
      } catch (fallbackErr) {
        throw new KilnError("SOURCE_EXTRACTION_FAILED", `Failed to extract content from URL: ${uri}`, {
          context: { uri },
          cause: fallbackErr,
        });
      }
    }
  }
}
