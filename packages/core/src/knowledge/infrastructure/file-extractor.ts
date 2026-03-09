// FileExtractor -- reads local files for knowledge ingestion

import { readFile } from "node:fs/promises";
import { KilnError } from "../../engine/errors.js";
import type { ContentExtractor, ExtractedContent, KnowledgeSourceType, ExtractionOptions } from "../../engine/domain/knowledge-source.js";

export class FileExtractor implements ContentExtractor {
  readonly supportedTypes: readonly KnowledgeSourceType[] = ["file"];

  async extract(uri: string, _type?: KnowledgeSourceType, _options?: ExtractionOptions): Promise<ExtractedContent> {
    try {
      const content = await readFile(uri, "utf-8");
      return { content, metadata: { source: uri } };
    } catch (err) {
      throw new KilnError("SOURCE_EXTRACTION_FAILED", `Failed to read file: ${uri}`, {
        context: { uri },
        cause: err,
      });
    }
  }
}
