// PdfExtractor -- extracts text from PDFs via unpdf (dynamic import, optional dep)

import { readFile } from "node:fs/promises";
import { KilnError } from "../../engine/errors.js";
import type { ContentExtractor, ExtractedContent, KnowledgeSourceType, ExtractionOptions } from "../../engine/domain/knowledge-source.js";

export class PdfExtractor implements ContentExtractor {
  readonly supportedTypes: readonly KnowledgeSourceType[] = ["pdf"];

  async extract(uri: string, _type?: KnowledgeSourceType, options?: ExtractionOptions): Promise<ExtractedContent> {
    let extractText: (data: ArrayBuffer) => Promise<{ text: string; totalPages: number }>;
    try {
      const mod = (await import("unpdf")) as { extractText: typeof extractText };
      extractText = mod.extractText;
    } catch {
      throw new KilnError("SOURCE_EXTRACTION_FAILED", "unpdf is not installed. Install it with: bun add unpdf", {
        context: { uri },
      });
    }

    try {
      let buffer: ArrayBuffer;
      if (uri.startsWith("http://") || uri.startsWith("https://")) {
        const res = await fetch(uri, {
          headers: options?.headers ? { ...options.headers } : undefined,
        });
        if (!res.ok) {
          throw new Error(`Fetch returned ${res.status}`);
        }
        buffer = await res.arrayBuffer();
      } else {
        const fileBuffer = await readFile(uri);
        buffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength);
      }

      const result = await extractText(buffer);
      return {
        content: result.text,
        metadata: { source: uri, pages: result.totalPages },
      };
    } catch (err) {
      if (err instanceof KilnError) throw err;
      throw new KilnError("SOURCE_EXTRACTION_FAILED", `Failed to extract PDF: ${uri}`, {
        context: { uri },
        cause: err,
      });
    }
  }
}
