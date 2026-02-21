// MarkdownChunker -- splits markdown by heading hierarchy, preserving structure

import type { Document, Chunk, ChunkConfig, Chunker } from "../engine/domain/chunker.js";
import { createHash } from "node:crypto";

export class MarkdownChunker implements Chunker {
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

    const sections = this.splitByHeadings(content);
    if (sections.length === 0) {
      return this.fallbackChunk(document, config);
    }

    const chunks: Chunk[] = [];
    let currentChunk = "";
    let currentHeading = "";
    let currentLevel = 0;
    let chunkIndex = 0;
    const source = (metadata.source as string) || "unknown";

    for (const section of sections) {
      const sectionContent = currentHeading
        ? `${currentHeading}\n\n${section.content}`
        : section.content;

      if (currentChunk.length + sectionContent.length > safeChunkSize && currentChunk.length > 0) {
        const chunkId = this.generateChunkId(source, chunkIndex);
        chunks.push({
          id: chunkId,
          content: currentChunk.trim(),
          metadata: { ...metadata, chunkIndex, heading: currentHeading, level: currentLevel },
        });

        const overlapStart = Math.max(0, currentChunk.length - safeChunkOverlap);
        const overlapText = currentChunk.slice(overlapStart);
        currentChunk = overlapText + sectionContent;
        chunkIndex++;
        currentHeading = section.heading || currentHeading;
        currentLevel = section.level || currentLevel;
      } else {
        if (section.heading && currentChunk.length > 0) {
          currentChunk += "\n\n";
        }
        currentChunk += sectionContent;
        if (section.heading) {
          currentHeading = section.heading;
          currentLevel = section.level || 0;
        }
      }
    }

    if (currentChunk.trim().length > 0) {
      const chunkId = this.generateChunkId(source, chunkIndex);
      chunks.push({
        id: chunkId,
        content: currentChunk.trim(),
        metadata: { ...metadata, chunkIndex, heading: currentHeading, level: currentLevel },
      });
    }

    return chunks;
  }

  private splitByHeadings(content: string): Array<{ heading: string; level: number; content: string }> {
    const lines = content.split("\n");
    const sections: Array<{ heading: string; level: number; content: string }> = [];
    let currentHeading = "";
    let currentLevel = 0;
    let currentContent: string[] = [];

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

      if (headingMatch) {
        if (currentContent.length > 0 || currentHeading) {
          sections.push({
            heading: currentHeading,
            level: currentLevel,
            content: currentContent.join("\n"),
          });
        }
        currentHeading = headingMatch[2]!;
        currentLevel = headingMatch[1]!.length;
        currentContent = [];
      } else {
        if (this.isCodeBlockLine(line)) {
          currentContent.push(line);
        } else {
          const trimmedLine = line.trim();
          if (trimmedLine) {
            currentContent.push(line);
          } else if (currentContent.length > 0 && currentContent[currentContent.length - 1]!.trim() !== "") {
            currentContent.push(line);
          }
        }
      }
    }

    if (currentContent.length > 0 || currentHeading) {
      sections.push({
        heading: currentHeading,
        level: currentLevel,
        content: currentContent.join("\n"),
      });
    }

    return sections;
  }

  private isCodeBlockLine(line: string): boolean {
    return line.startsWith("```") || line.startsWith("    ") || line.startsWith("\t");
  }

  private fallbackChunk(document: Document, config: ChunkConfig): Chunk[] {
    const { content, metadata } = document;
    const { chunkSize } = config;
    const safeChunkSize = chunkSize > 0 ? chunkSize : 512;
    const source = (metadata.source as string) || "unknown";

    const chunks: Chunk[] = [];
    for (let i = 0; i < content.length; i += safeChunkSize) {
      const chunkContent = content.slice(i, i + safeChunkSize);
      const chunkIndex = Math.floor(i / safeChunkSize);
      const chunkId = this.generateChunkId(source, chunkIndex);
      chunks.push({
        id: chunkId,
        content: chunkContent,
        metadata: { ...metadata, chunkIndex },
      });
    }

    return chunks;
  }

  private generateChunkId(source: string, index: number): string {
    const input = `${source}:${index}`;
    const hash = createHash("sha256").update(input).digest("hex");
    return hash.slice(0, 16);
  }
}
