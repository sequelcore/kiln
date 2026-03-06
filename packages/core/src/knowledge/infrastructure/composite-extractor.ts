// CompositeExtractor -- routes extraction to the correct extractor by source type

import { KilnError } from "../../engine/errors.js";
import type { ContentExtractor, ExtractedContent, KnowledgeSourceType } from "../../engine/domain/knowledge-source.js";

export class CompositeExtractor implements ContentExtractor {
  readonly supportedTypes: readonly KnowledgeSourceType[];
  private readonly extractors: ReadonlyMap<KnowledgeSourceType, ContentExtractor>;

  constructor(extractors: readonly ContentExtractor[]) {
    const map = new Map<KnowledgeSourceType, ContentExtractor>();
    for (const extractor of extractors) {
      for (const type of extractor.supportedTypes) {
        map.set(type, extractor);
      }
    }
    this.extractors = map;
    this.supportedTypes = [...map.keys()];
  }

  async extract(uri: string, type: KnowledgeSourceType): Promise<ExtractedContent> {
    const extractor = this.extractors.get(type);
    if (!extractor) {
      throw new KilnError("SOURCE_EXTRACTION_FAILED", `No extractor available for source type: ${type}`, {
        context: { uri, type },
      });
    }
    return extractor.extract(uri, type);
  }
}
