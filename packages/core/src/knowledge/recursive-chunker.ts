// RecursiveTextChunker -- splits text by paragraph -> sentence -> character with configurable overlap

import type { Document, Chunk, ChunkConfig, Chunker } from "../engine/domain/chunker.js";
import { createHash } from "node:crypto";

export class RecursiveTextChunker implements Chunker {
  chunk(document: Document, config: ChunkConfig): Chunk[] {
    const { content, metadata } = document;
    const { chunkSize, chunkOverlap } = config;

    if (!content || content.length === 0) {
      return [];
    }

    const safeChunkSize = chunkSize > 0 ? chunkSize : 512;
    const safeChunkOverlap = Math.min(
      chunkOverlap >= 0 ? chunkOverlap : 0,
      safeChunkSize,
    );

    const chunks: Chunk[] = [];
    let startIndex = 0;
    let chunkIndex = 0;

    while (startIndex < content.length) {
      let endIndex = startIndex + safeChunkSize;

      if (endIndex >= content.length) {
        endIndex = content.length;
      } else {
        endIndex = this.findBestSplitPoint(content, startIndex, endIndex);
      }

      const chunkContent = content.slice(startIndex, endIndex);
      const source = (metadata.source as string) || "unknown";
      const chunkId = this.generateChunkId(source, chunkIndex);

      chunks.push({
        id: chunkId,
        content: chunkContent,
        metadata: { ...metadata, chunkIndex },
      });

      if (endIndex >= content.length) {
        break;
      }

      const nextStart = endIndex - safeChunkOverlap;
      startIndex = nextStart > startIndex ? nextStart : endIndex;
      chunkIndex++;
    }

    return chunks;
  }

  private findBestSplitPoint(content: string, start: number, end: number): number {
    const searchWindow = content.slice(start, end);
    
    const lastDoubleNewline = searchWindow.lastIndexOf("\n\n");
    if (lastDoubleNewline !== -1) {
      return start + lastDoubleNewline + 2;
    }

    const lastNewline = searchWindow.lastIndexOf("\n");
    if (lastNewline !== -1) {
      return start + lastNewline + 1;
    }

    const sentenceEnd = this.findSentenceEnd(content, start, end);
    if (sentenceEnd !== -1) {
      return sentenceEnd;
    }

    return end;
  }

  private findSentenceEnd(content: string, start: number, end: number): number {
    const sentenceDelimiters = [". ", "! ", "? "];

    for (let i = end - 1; i > start; i--) {
      for (const delimiter of sentenceDelimiters) {
        if (content.slice(i - delimiter.length + 1, i + 1) === delimiter) {
          return i + 1;
        }
      }
    }

    return -1;
  }

  private generateChunkId(source: string, index: number): string {
    const input = `${source}:${index}`;
    const hash = createHash("sha256").update(input).digest("hex");
    return hash.slice(0, 16);
  }
}
