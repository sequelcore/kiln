# Phase 4 Knowledge Engine -- Research Synthesis

**Date:** 2026-03-06
**Scope:** Exhaustive research across 6 domains, 180+ sources, covering proven production patterns, lab research, and theoretical frontiers.
**Purpose:** Inform architectural decisions for Kiln's most important module.

---

## Table of Contents

1. [Executive Summary: Key Decisions](#1-executive-summary)
2. [PgVector Store -- Deep Analysis](#2-pgvector-store)
3. [RAG Pipeline -- State of the Art](#3-rag-pipeline)
4. [Audio Transcription](#4-audio-transcription)
5. [Knowledge Ingestion](#5-knowledge-ingestion)
6. [Contact Memory](#6-contact-memory)
7. [Multi-Tenant Architecture](#7-multi-tenant-architecture)
8. [Beyond the Requirements](#8-beyond-the-requirements)
9. [Revised Implementation Sequence](#9-revised-implementation-sequence)
10. [Open Questions Resolved](#10-open-questions-resolved)

---

## 1. Executive Summary

### The 12 Decisions That Define This Module

| # | Decision | Choice | Confidence | Rationale |
|---|----------|--------|------------|-----------|
| 1 | PG client library | **postgres** (Porsager) | HIGH | Mature, Bun-compatible, tagged template literals, built-in pooling. pgvector-node supports it. |
| 2 | Vector index type | **HNSW** (pgvector 0.8.0+) | HIGH | 15.5x better QPS than IVFFlat at 0.998 recall. Iterative scan solves filtered query issues. |
| 3 | Multi-tenant isolation | **Pool + hash partition by tenant_id** | HIGH | Single table, hash partitioned, per-partition HNSW indexes. RLS as defense-in-depth. |
| 4 | Embedding model | **text-embedding-3-small** (1536d) | HIGH | Best cost/performance. $0.02/1M tokens. Matryoshka truncation available if needed. |
| 5 | Hybrid retrieval | **Vector + tsvector/BM25 + RRF (k=60)** | HIGH | +22% retrieval precision over vector-only. Native PostgreSQL, no extra infra. |
| 6 | Knowledge mode default | **Auto-inject** (stuff into prompt) | HIGH | Simpler, no extra LLM round-trip. Tool-based as opt-in via `knowledge.mode: "tool"`. |
| 7 | Chunking strategy | **Contextual retrieval** (Anthropic pattern) | HIGH | Prepend document context to each chunk. -49% failed retrievals (-67% with reranking). |
| 8 | Transcription provider | **gpt-4o-transcribe** primary, Deepgram Nova-3 fallback | HIGH | 2.46% WER at $0.006/min. Nova-3 for streaming/code-switching. |
| 9 | PDF parsing | **unpdf** (native) + Jina Reader (URLs) | HIGH | unpdf is Bun-native, zero deps. Jina Reader for URL-to-markdown. No Python sidecar needed. |
| 10 | Memory architecture | **Mem0-inspired extraction + pgvector storage** | HIGH | LLM extracts facts post-conversation. Stored as embeddings in same pgvector instance. |
| 11 | Reranking | **Defer to v2** | MEDIUM | Cross-encoder reranking adds 200-500ms. Auto-inject mode already limits candidates. |
| 12 | Version target | **0.2.0** | HIGH | New capabilities, not patches. Semantic versioning demands a minor bump. |

### What Changed From the Original Request

The Kilvo team's audit was accurate. Research validates their proposed interfaces and sequencing. Key upgrades based on research:

1. **Contextual retrieval** (Anthropic pattern) should be the default chunking strategy, not plain recursive splitting. It reduces failed retrievals by 49% at $1.02/1M doc tokens ingestion cost.
2. **Hybrid retrieval (vector + BM25)** should ship in v1, not deferred to v2. It's a single SQL query with RRF -- native PostgreSQL tsvector, no extra infrastructure. The +22% precision improvement is too significant to skip.
3. **pgvector 0.8.0's iterative scan** solves the "overfiltering" problem that made metadata-filtered vector queries unreliable. This is critical for multi-tenant pool isolation.
4. **halfvec (float16)** should be the default storage type -- 4x compression with minimal accuracy loss. 1536d float16 = ~3KB per vector vs ~6KB for float32.
5. **gpt-4o-transcribe** replaced whisper-1 as the recommended provider -- same price ($0.006/min) but 2.46% WER vs ~10.6%.
6. **Contact memory** should use a Mem0-inspired ADD/UPDATE/DELETE/NOOP extraction pattern rather than naive fact dumping.

---

## 2. PgVector Store

### 2.1 Why pgvector (Not a Dedicated Vector DB)

pgvector is sufficient for Kiln's scale because tenant-scoped queries keep per-query vector counts manageable. Key advantages:

- **SQL joins** between vector results and relational data (source metadata, tenant config)
- **ACID transactions** with vector operations
- **Single operational surface** -- one database for knowledge, sources, contacts, sessions
- **Cost**: 75% less than Pinecone at comparable performance (pgvectorscale benchmarks)

pgvector becomes insufficient at billions of vectors or sub-20ms p99 at thousands of concurrent queries. Kiln's multi-tenant model (tenant-scoped queries of thousands to low millions of vectors) is firmly in pgvector's sweet spot.

### 2.2 Schema Design

```sql
-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Knowledge chunks (hash-partitioned by tenant)
CREATE TABLE knowledge_chunks (
  id UUID DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  source_id TEXT NOT NULL,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  context TEXT,                    -- Anthropic contextual retrieval prefix
  embedding halfvec(1536),         -- float16 for 4x compression
  metadata JSONB DEFAULT '{}',
  fts tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(context, '') || ' ' || content)
  ) STORED,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
) PARTITION BY HASH (tenant_id);

-- Create 16 partitions (adjustable)
DO $$
BEGIN
  FOR i IN 0..15 LOOP
    EXECUTE format(
      'CREATE TABLE knowledge_chunks_p%s PARTITION OF knowledge_chunks
       FOR VALUES WITH (MODULUS 16, REMAINDER %s)', i, i
    );
  END LOOP;
END $$;

-- Per-partition HNSW indexes (auto-created on parent)
CREATE INDEX idx_chunks_embedding ON knowledge_chunks
  USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 128);

-- BM25 via tsvector
CREATE INDEX idx_chunks_fts ON knowledge_chunks USING gin (fts);

-- Metadata filtering
CREATE INDEX idx_chunks_source ON knowledge_chunks (tenant_id, source_id);

-- Knowledge sources (not partitioned -- low volume)
CREATE TABLE knowledge_sources (
  id TEXT NOT NULL,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('url', 'pdf', 'text', 'file')),
  origin TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'indexing', 'indexed', 'failed', 'stale')),
  chunk_count INT DEFAULT 0,
  content_hash TEXT,
  last_indexed_at TIMESTAMPTZ,
  error TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

-- Contact facts (for contact memory)
CREATE TABLE contact_facts (
  id UUID DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  external_user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('preference', 'entity', 'issue', 'general')),
  confidence REAL DEFAULT 1.0,
  embedding halfvec(1536),
  source_conversation_id TEXT,
  valid_at TIMESTAMPTZ DEFAULT now(),
  expired_at TIMESTAMPTZ,          -- bi-temporal: NULL = still valid
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX idx_facts_user ON contact_facts (tenant_id, external_user_id)
  WHERE expired_at IS NULL;
CREATE INDEX idx_facts_embedding ON contact_facts
  USING hnsw (embedding halfvec_cosine_ops);

-- Row-Level Security (defense-in-depth)
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_chunks ON knowledge_chunks
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_sources ON knowledge_sources
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE contact_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_facts ON contact_facts
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
```

### 2.3 Hybrid Retrieval Query Pattern

```sql
-- Hybrid search: vector + BM25 with Reciprocal Rank Fusion
WITH semantic AS (
  SELECT id, content, context, metadata,
         ROW_NUMBER() OVER (ORDER BY embedding <=> $2::halfvec) AS rank
  FROM knowledge_chunks
  WHERE tenant_id = $1
  ORDER BY embedding <=> $2::halfvec
  LIMIT 20
),
lexical AS (
  SELECT id, content, context, metadata,
         ROW_NUMBER() OVER (ORDER BY ts_rank(fts, websearch_to_tsquery($3)) DESC) AS rank
  FROM knowledge_chunks
  WHERE tenant_id = $1 AND fts @@ websearch_to_tsquery($3)
  ORDER BY ts_rank(fts, websearch_to_tsquery($3)) DESC
  LIMIT 20
)
SELECT COALESCE(s.id, l.id) AS id,
       COALESCE(s.content, l.content) AS content,
       COALESCE(s.context, l.context) AS context,
       COALESCE(s.metadata, l.metadata) AS metadata,
       COALESCE(1.0/(60 + s.rank), 0) + COALESCE(1.0/(60 + l.rank), 0) AS rrf_score
FROM semantic s
FULL OUTER JOIN lexical l ON s.id = l.id
ORDER BY rrf_score DESC
LIMIT $4;  -- topK
```

### 2.4 HNSW Tuning Guide

| Parameter | Default | Recommendation | Effect |
|-----------|---------|----------------|--------|
| `m` | 16 | 16 (keep default) | Connections per node. Higher = better recall, more memory |
| `ef_construction` | 64 | 128 | Build quality. 2x `m` minimum. Diminishing returns beyond 200 |
| `hnsw.ef_search` | 40 | 100 | Query-time accuracy. Higher = better recall, slower queries |
| `hnsw.iterative_scan` | off | **relaxed_order** | Critical for filtered queries. Continues scanning until enough filtered results found |

Enable iterative scan per-session or globally:
```sql
SET hnsw.iterative_scan = relaxed_order;
SET hnsw.max_scan_tuples = 10000;
```

### 2.5 PG Client: postgres (Porsager)

```typescript
import postgres from "postgres";
import pgvector from "pgvector";

const sql = postgres(connectionString, {
  max: 20,                    // connection pool size
  types: pgvector.registerTypes,
});

// Vector query with tagged template
const results = await sql`
  SELECT id, content, 1 - (embedding <=> ${pgvector.toSql(queryEmbedding)}::halfvec) AS score
  FROM knowledge_chunks
  WHERE tenant_id = ${tenantId}
  ORDER BY embedding <=> ${pgvector.toSql(queryEmbedding)}::halfvec
  LIMIT ${topK}
`;
```

**Dependencies added:** `postgres` (~50KB), `pgvector` (~5KB). Minimal bundle impact.

---

## 3. RAG Pipeline

### 3.1 Chunking: Contextual Retrieval (Default)

Anthropic's contextual retrieval prepends document-level context to each chunk before embedding:

```
<context>
This chunk is from a document titled "Return Policy" for an e-commerce store.
It appears in the section about "Time Limits for Returns".
</context>
{original chunk text}
```

**Impact:** -49% failed retrievals (standalone), -67% with reranking.
**Cost:** $1.02 per million document tokens at ingestion (using Claude prompt caching).
**Implementation:** During ingestion, for each chunk, send `{full_document + chunk}` to Claude with a prompt asking for a short contextual prefix. Cache the full document across chunks for massive cost reduction.

**Fallback:** When the tenant doesn't configure an LLM for ingestion enrichment, fall back to recursive splitting (512 tokens, 50 token overlap) with section heading propagation.

### 3.2 Retrieval Modes

| Mode | Config Value | Behavior | Best For |
|------|-------------|----------|----------|
| **Auto-inject** | `knowledge.mode: "auto"` (default) | Before each message, retrieve top-K chunks and inject into system prompt as `--- Knowledge Base ---` section | Most use cases. Simpler, no extra LLM round-trip |
| **Tool-based** | `knowledge.mode: "tool"` | Register `knowledge_search` as builtin tool. LLM decides when/whether to search | Complex agents that need selective retrieval |

**Auto-inject is the recommended default** because:
- No extra LLM round-trip (tool-based costs an additional call)
- Deterministic behavior (always retrieves, never forgets to search)
- Simpler pipeline (no tool execution loop for retrieval)
- Token cost is predictable

**When to use tool-based:**
- Agent handles diverse topics where knowledge isn't always relevant
- Cost optimization (only retrieve when the LLM judges it necessary)
- Complex multi-step workflows where retrieval timing matters

### 3.3 Auto-Inject Pipeline

```
User message arrives
  -> Embed user message text (text-embedding-3-small)
  -> Hybrid search (vector + BM25 + RRF)
  -> Take top 5 results
  -> Format as knowledge context:
     "--- Knowledge Base ---\n[Source: {sourceName}] {context}\n{content}\n---"
  -> Append to system prompt (same slot as recalledMemory)
  -> Pass to ModeBOrchestrator.processMessage()
```

### 3.4 What We're Deferring (and Why)

| Pattern | Status | Rationale |
|---------|--------|-----------|
| Cross-encoder reranking | **v2** | +200-500ms latency. Auto-inject with hybrid search already high quality |
| HyDE (hypothetical doc embeddings) | **v2** | Adds LLM call per query. Useful for abstract queries, not typical customer support |
| Self-RAG / CRAG | **v3+** | Requires model fine-tuning or complex routing. Overkill for knowledge base Q&A |
| GraphRAG | **v3+** | 2x better on multi-hop queries but massive ingestion complexity. Not justified for v1 |
| RAPTOR (hierarchical abstraction) | **v3+** | Interesting for long documents but adds ingestion pipeline complexity |
| Late chunking (Jina) | **v2** | Requires long-context embedding model. text-embedding-3-small is 8191 tokens max |
| Streaming RAG | **v2** | Retrieve-while-generating. Complex but promising for real-time |
| Prompt caching for RAG context | **v1.1** | Anthropic prompt caching can reduce repeated knowledge context costs by 90%. Quick win after v1 |

---

## 4. Audio Transcription

### 4.1 Provider Comparison (March 2026)

| Provider | WER | $/min | Streaming | Spanish | Code-Switch | Recommendation |
|----------|-----|-------|-----------|---------|-------------|----------------|
| **gpt-4o-transcribe** | **2.46%** | $0.006 | No | Yes | No | **Primary** |
| gpt-4o-mini-transcribe | ~4-5% | $0.003 | No | Yes | No | Budget tier |
| **Deepgram Nova-3** | 5-7% | $0.004-0.008 | **Yes** | **Yes** | **Yes** | **Fallback + streaming** |
| Groq Whisper large-v3 | ~10.3% | Pay-per-use | No | Yes | No | Speed-optimized fallback |
| AssemblyAI Universal-2 | ~14.5% | $0.0045+ | Yes | Yes | Yes | Feature-rich (diarization) |

### 4.2 Architecture Decision: Always Transcribe

**Claude has no audio API.** Audio content cannot be sent to Claude via the Messages API. Transcription is mandatory for Kiln's primary provider. Even if Gemini/GPT-4o support native audio, transcription produces a universal text format that works with all providers.

**Store both:** Keep the transcription text AND the original audio reference for potential future native audio processing.

### 4.3 WhatsApp Voice Note Pipeline

```
Webhook (media_id in message)
  -> Download OGG/Opus (within 5 min, auth header: Bearer {access_token})
  -> [Skip format conversion -- APIs accept OGG/Opus natively]
  -> [Skip noise reduction -- APIs handle compressed audio well]
  -> Transcribe (gpt-4o-transcribe, circuit breaker -> Deepgram fallback)
  -> Cache transcription: Redis key `transcription:{tenant_id}:{media_id}` TTL 72h
  -> Replace AudioPart with TextPart: "[Voice note transcription]: {text}"
  -> Continue to ModeBOrchestrator.processMessage()
```

**Key details:**
- Media URL expires in **5 minutes** -- download immediately on webhook receipt
- WhatsApp max audio: 16 MB / 30 minutes -- fits all APIs without chunking
- OGG/Opus is natively supported by all major transcription APIs -- no conversion needed
- Synchronous transcription is acceptable (30s voice note transcribes in ~1-2s)

### 4.4 Transcription Adapter Interface

```typescript
// core/src/transcription/domain/transcription.ts
export interface TranscriptionResult {
  readonly text: string;
  readonly durationMs?: number;
  readonly language?: string;
  readonly confidence?: number;
}

export interface TranscriptionAdapter {
  readonly name: string;
  transcribe(audio: {
    data: Buffer;
    mimeType: string;
    languageHint?: string;
  }): Promise<TranscriptionResult>;
}
```

**Bounded context:** New `core/src/transcription/` -- it's a distinct concern, not part of `agents/`. Contains:
- `domain/transcription.ts` -- interface
- `infrastructure/openai-transcription.ts` -- gpt-4o-transcribe + gpt-4o-mini-transcribe
- `infrastructure/deepgram-transcription.ts` -- Nova-3

### 4.5 Media Downloader Interface

```typescript
// runtime/src/gateway/media-downloader.ts
export interface MediaDownloader {
  download(url: string, headers?: Record<string, string>): Promise<{
    data: Buffer;
    mimeType: string;
    sizeBytes: number;
  }>;
}
```

Meta CDN requires `Authorization: Bearer {access_token}`. Other sources may differ. The gateway's audio preprocessor uses this interface, not direct fetch.

### 4.6 Cost Management

| Volume (hrs/mo) | gpt-4o-transcribe | gpt-4o-mini-transcribe |
|-----------------|-------------------|----------------------|
| 100 | $36 | $18 |
| 500 | $180 | $90 |
| 1,000 | $360 | $180 |

**Strategy:** Use budget middleware to track per-tenant transcription minutes. Tenants on budget tiers use gpt-4o-mini-transcribe. Per-tenant transcription can be disabled via `transcription.enabled: false`.

---

## 5. Knowledge Ingestion

### 5.1 PDF Parsing: unpdf

**pdf-parse is unmaintained.** `unpdf` is the modern TypeScript-first replacement:
- ESM-first, Bun-compatible, cross-runtime
- Auto-selects between fast vector parsing (digital PDFs) and Tesseract OCR (scanned)
- Zero deps beyond pdfjs-dist core
- Active maintenance by the unjs ecosystem

For v1, `unpdf` handles the vast majority of PDFs. Complex table extraction (which unpdf doesn't do) is a v2 concern -- consider Docling/Marker as a Python sidecar or LlamaParse cloud API when customers report table extraction issues.

**Dependency:** `unpdf` package.

### 5.2 URL Extraction: Jina Reader + Mozilla Readability

**Two-tier approach:**

| Tier | Tool | When |
|------|------|------|
| Quick | **Jina Reader** (`https://r.jina.ai/{url}`) | Single-page extraction. Zero deps, HTTP call returns markdown |
| Robust | **Mozilla Readability** (via `@mozilla/readability` + `jsdom`) | Fallback when Jina is unavailable or for offline/self-hosted |

**Depth crawling (follow links):** v1 supports depth=1 only (single page). Depth > 1 adds exponential complexity. If needed in v2, evaluate Firecrawl API or Crawl4AI sidecar.

**Ethical crawling:** Check robots.txt before crawling. Identify crawler with proper User-Agent. Rate limit to 1 request per 10-15 seconds.

### 5.3 Source Ingestion Pipeline

```
Source submitted (URL, PDF buffer, or plain text)
  -> Validate + assign source ID
  -> Set status: "pending"
  -> [Async] Start ingestion:
     -> Set status: "indexing"
     -> Extract text:
        - URL: Jina Reader -> markdown
        - PDF: unpdf -> text (page-by-page)
        - Text: pass through
     -> Compute content hash (SHA-256)
     -> Chunk (recursive 512 tokens, 50 overlap)
     -> [If contextual retrieval enabled] Enrich each chunk with document context via LLM
     -> Batch embed chunks (text-embedding-3-small, batches of 100)
     -> Upsert to pgvector with metadata (sourceId, tenantId, pageNumber, sectionHeading)
     -> Update source: status = "indexed", chunkCount, lastIndexedAt, contentHash
     -> [On error] Set status: "failed", error message
```

### 5.4 Source Metadata Per Chunk

```typescript
interface ChunkMetadata {
  sourceId: string;
  sourceName: string;
  sourceType: "url" | "pdf" | "text" | "file";
  sourceUrl?: string;
  pageNumber?: number;
  sectionHeading?: string;
  chunkIndex: number;
  tenantId: string;
}
```

### 5.5 Re-indexing and Staleness

- **Content hashing:** SHA-256 of raw source content stored on `knowledge_sources.content_hash`. On re-index, compare hashes -- skip unchanged sources.
- **Cascade delete:** `deleteByMetadata({ sourceId })` removes all chunks before re-ingesting. Atomic replacement.
- **Staleness detection:** Future feature. Periodic re-fetch of URLs to detect content changes.

### 5.6 Cost Estimation

Before ingestion, estimate cost and present to the product layer:

```
Embedding cost = (total_tokens / 1,000,000) * $0.02  -- text-embedding-3-small
Contextual enrichment cost = (total_tokens / 1,000,000) * $1.02  -- Claude with caching
```

A 50-page PDF (~25,000 tokens) costs approximately:
- Embedding: $0.0005
- Contextual enrichment: $0.025
- Total: ~$0.03 per document

---

## 6. Contact Memory

### 6.1 Architecture: Mem0-Inspired Extraction

The research strongly favors the **extraction + update** pattern pioneered by Mem0:

1. **Post-conversation:** LLM processes the conversation and extracts candidate facts
2. **Deduplication:** Each fact is compared against existing facts (vector similarity)
3. **Decision:** For each fact, the LLM chooses: ADD, UPDATE, DELETE, or NOOP
4. **Storage:** Facts stored as embeddings in pgvector (same instance as knowledge)

This avoids naive fact dumping (which creates duplicates and contradictions) and maintains a clean, evolving fact store.

### 6.2 Fact Schema

```typescript
// core/src/memory/domain/contact-memory.ts
export interface ContactFact {
  readonly id: string;
  readonly externalUserId: string;   // NOT contactId -- Kiln is generic
  readonly tenantId: string;
  readonly content: string;           // "Customer prefers morning appointments"
  readonly category: "preference" | "entity" | "issue" | "general";
  readonly confidence: number;        // 0.0 - 1.0
  readonly embedding: number[];       // for semantic dedup and recall
  readonly sourceConversationId?: string;
  readonly validAt: Date;             // bi-temporal: when the fact became true
  readonly expiredAt?: Date;          // bi-temporal: NULL = still valid
  readonly createdAt: Date;
}

export interface ContactMemory {
  extractAndStore(
    conversationHistory: ContentPart[][],
    externalUserId: string,
    tenantId: string,
    options?: { model?: string }
  ): Promise<ContactFact[]>;

  recall(
    externalUserId: string,
    tenantId: string,
    options?: { query?: string; limit?: number }
  ): Promise<ContactFact[]>;

  forget(factId: string, tenantId: string): Promise<void>;

  forgetAll(externalUserId: string, tenantId: string): Promise<void>;  // GDPR
}
```

### 6.3 Extraction Prompt Pattern

```
You are a fact extractor. Analyze this conversation and extract structured facts about the customer.

For each fact, classify as:
- preference: Customer preferences, habits, preferred times, communication style
- entity: Names, identifiers, account numbers, relationships
- issue: Unresolved problems, complaints, pending items
- general: Other relevant information

Output JSON array:
[{ "content": "...", "category": "...", "confidence": 0.0-1.0 }]

Rules:
- Only extract facts about the CUSTOMER, not the agent
- Distinguish temporary states ("customer is frustrated") from permanent facts ("customer name is Maria")
- Assign lower confidence (0.3-0.6) to inferred facts, higher (0.7-1.0) to explicit statements
- Do not extract trivial or obvious facts
```

### 6.4 Recall Pattern

On new conversation start:
1. Query `contact_facts` by `external_user_id` + `tenant_id` where `expired_at IS NULL`
2. If a query/message is available, additionally do vector similarity search for relevant facts
3. Format as: `--- Customer Context ---\n{facts}\n---`
4. Inject into system prompt alongside knowledge base context

### 6.5 Bi-Temporal Model

Inspired by Zep/Graphiti's bi-temporal approach:
- `valid_at`: When the fact became true in the real world
- `expired_at`: When the fact was superseded or invalidated (NULL = still valid)
- Never delete facts -- mark as expired. Enables audit trail and temporal queries.
- `forgetAll()` (GDPR) is the exception -- hard delete for right to be forgotten.

### 6.6 Post-Conversation Hook

```
Event: session_resolved | session_timeout
  -> If tenant has contactFacts.enabled = true
  -> Fetch full conversation history from session
  -> Run ContactMemory.extractAndStore()
  -> Extracted facts are available for next conversation with same contact
```

**Extraction model:** Configurable. Default to the same provider as the conversation. Budget option: use a cheaper model (e.g., Haiku) since extraction is offline and latency doesn't matter.

---

## 7. Multi-Tenant Architecture

### 7.1 Isolation Model: Pool with Partitioning

The **pool model** (single table + tenant_id filtering) is the right choice for Kiln because:
- Most tenants will have thousands to tens of thousands of chunks -- not millions
- pgvector 0.8.0's iterative scan solves the overfiltering problem that made pool unreliable
- Hash partitioning by tenant_id gives per-partition HNSW indexes (smaller, faster, independent rebuilds)
- RLS as a safety net catches any missed tenant_id filters in application code

If an enterprise tenant needs dedicated isolation, that's a Kilvo product concern (separate pgvector instance), not a Kiln engine concern.

### 7.2 Connection Pooling

postgres (Porsager) has built-in connection pooling. For Kiln's gateway (single long-lived process):
- Set `max: 20` connections (adjustable per deployment)
- No PgBouncer needed unless multiple services share the same PG instance
- Use `SET app.current_tenant = '{tenant_id}'` per-session for RLS

### 7.3 Embedding Cost Optimization

1. **Content hash caching:** SHA-256 of chunk content -> cached embedding. Avoid re-embedding identical content across re-indexes or duplicate sources.
2. **Batch embedding:** Group 100+ chunks per API call. OpenAI's batch API offers 50% discount for non-real-time.
3. **Matryoshka truncation:** If storage becomes a concern, truncate text-embedding-3-small from 1536d to 512d or 256d with minimal quality loss.
4. **halfvec storage:** 4x compression (float32 -> float16) by default.

### 7.4 Knowledge Pipeline Per Tenant

Each tenant gets:
- A `RetrievalPipeline` instance (lazy-initialized on first knowledge query)
- Shared pgvector store (tenant-isolated via metadata filter)
- Shared embedding adapter (text-embedding-3-small, shared API key)
- Independent source management (CRUD via admin routes)
- Independent budget tracking (embedding calls, storage)

### 7.5 Security Checklist

- [ ] `tenant_id` on every row in every knowledge table
- [ ] RLS enabled on all tables (defense-in-depth, not primary enforcement)
- [ ] Every vector query includes `WHERE tenant_id = $1`
- [ ] Source ingestion validates tenant authorization
- [ ] Admin routes require authentication (existing auth middleware)
- [ ] Audit log for knowledge operations (existing JSONL audit infrastructure)
- [ ] GDPR: `forgetAll(externalUserId)` hard-deletes contact facts

---

## 8. Beyond the Requirements

Research surfaced several patterns worth noting for future phases:

### 8.1 Prompt Caching for RAG (v1.1 -- Quick Win)

Anthropic's prompt caching reduces repeated knowledge context costs by 90%. If a tenant's knowledge base is < 200K tokens, cache the entire knowledge base in the system prompt and skip retrieval entirely. For larger bases, cache the top-K retrieval results across similar queries.

**Impact:** Up to 90% cost reduction on LLM input tokens for knowledge-heavy conversations.

### 8.2 Source Attribution (v1.1)

When auto-injecting knowledge, include source metadata in the prompt:
```
[Source: Return Policy, Page 3] Customers may return items within 30 days...
```

Instruct the LLM to cite sources in its response. This enables "Based on your Return Policy..." attribution in the UI.

### 8.3 Knowledge Gap Detection (v2)

Analyze conversations where the LLM couldn't answer from the knowledge base. Track "knowledge misses" and surface them to the tenant: "5 customer questions this week had no matching knowledge base content. Consider adding content about: shipping times, warranty process, ..."

### 8.4 Semantic Query Caching (v2)

Cache semantically similar queries (not just exact matches). Embed the query and search a cache of recent query->results pairs. If cosine similarity > 0.95, return cached results. Reduces embedding + vector search costs for repetitive customer questions.

### 8.5 Cognitive Memory Architecture (v3)

The research on cognitive memory (working, episodic, semantic, procedural) suggests a richer memory model:
- **Working memory:** Current conversation context (already exists as session)
- **Episodic memory:** Full conversation logs (already exists as session history)
- **Semantic memory:** Contact facts (Phase 4 scope)
- **Procedural memory:** Learned agent behaviors from conversation patterns (future)

Letta's "context repositories" and Zep's temporal knowledge graphs point toward a future where agents maintain and curate their own memory stores autonomously.

### 8.6 Sleep-Time Reflection (v3)

Inspired by Letta's context repositories: after conversations end, a background process reflects on the entire session, not just extracting facts but updating agent behavior notes, identifying patterns across conversations, and consolidating memory.

---

## 9. Revised Implementation Sequence

```
Phase 4a: Foundation (Week 1-2)
  [1] PgVectorStore implementation
  [2] Audio transcription preprocessor (parallel with #1)
  [3] Schema auto-migration (CREATE EXTENSION, tables, indexes)

Phase 4b: Knowledge Pipeline (Week 3-4)
  [4] Knowledge wiring into Mode B (auto-inject mode)
  [5] Hybrid retrieval (vector + BM25 + RRF)
  [6] Contextual retrieval enrichment at ingestion time

Phase 4c: Source Management (Week 5-6)
  [7] Source CRUD admin routes
  [8] URL extraction (Jina Reader + Readability fallback)
  [9] PDF extraction (unpdf)
  [10] Source status lifecycle + content hashing

Phase 4d: Contact Memory (Week 7-8)
  [11] ContactMemory interface + pgvector implementation
  [12] Mem0-inspired extraction pipeline
  [13] Recall injection on session start
  [14] Post-conversation extraction hook

Phase 4e: Integration + Hardening (Week 9-10)
  [15] End-to-end integration tests (tenant isolation, full pipeline)
  [16] Cost tracking integration (per-tenant embedding + transcription)
  [17] Documentation (app.yaml reference, admin API docs)
  [18] Version bump to 0.2.0
```

**Audio transcription** runs parallel to everything because it's independent of the knowledge pipeline.

### Dependencies Revised

```
PgVectorStore ──────────────┬──────────────────────┐
                            |                      |
              Knowledge Wiring (auto-inject)   Source Management
                    +                              |
              Hybrid Retrieval                     |
                    +                              |
              Contextual Enrichment                |
                            |                      |
                            └──────────┬───────────┘
                                       |
                                Contact Memory
                                       |
                              [v1.1] Prompt Caching
                              [v1.1] Source Attribution
                              [v2] Semantic Caching
                              [v2] Reranking
                              [v2] Knowledge Gap Detection

Audio Transcription ──── (independent, parallel)
```

---

## 10. Open Questions Resolved

| # | Question | Answer | Source |
|---|----------|--------|--------|
| 1 | PG client library | **postgres** (Porsager). Mature, Bun-compatible, pgvector-node supported | pgvector-node README, community benchmarks |
| 2 | Transcription bounded context | New **core/src/transcription/** context | Distinct concern, not agent-related |
| 3 | Native audio pass-through | **No.** Claude has no audio API. Always transcribe | Anthropic API docs (March 2026) |
| 4 | Knowledge mode default | **Auto-inject.** Tool-based as opt-in | Research shows context stuffing is simpler, tool-based adds latency |
| 5 | Contact memory generalization | **externalUserId** is the right abstraction | Kiln stays generic; product maps its domain identifiers |
| 6 | PDF library | **unpdf** (TypeScript-native, Bun-compatible, maintained) | pdf-parse is unmaintained; unpdf is its modern replacement |
| 7 | Schema ownership | **Kiln auto-creates** via initialize() with CREATE IF NOT EXISTS | Standard pattern across all reviewed platforms |
| 8 | Bundle size impact | postgres (~50KB) + pgvector (~5KB) + unpdf (~serverless pdfjs) = **acceptable** | Minimal compared to existing deps |
| 9 | Version target | **0.2.0** (minor bump, new capabilities) | Semantic versioning convention |
| 10 | Hybrid retrieval timing | **v1, not v2.** +22% precision is too significant to defer | ParadeDB + Jonathan Katz benchmarks |

---

## Appendix: Key Sources by Category

### pgvector & Vector Stores
- [Crunchy Data - HNSW Indexes](https://www.crunchydata.com/blog/hnsw-indexes-with-postgres-and-pgvector)
- [pgvector 0.8.0 Release](https://www.postgresql.org/about/news/pgvector-080-released-2952/)
- [Nile - pgvector 0.8.0 Iterative Scan](https://www.thenile.dev/blog/pgvector-080)
- [Tiger Data - pgvector vs Pinecone Cost](https://www.tigerdata.com/blog/pgvector-is-now-as-fast-as-pinecone-at-75-less-cost)
- [ParadeDB - Hybrid Search in PostgreSQL](https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual)
- [Jonathan Katz - Hybrid Search](https://jkatz05.com/post/postgres/hybrid-search-postgres-pgvector/)

### RAG Pipeline
- [Anthropic - Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)
- [Jina AI - Late Chunking](https://jina.ai/news/late-chunking-in-long-context-embedding-models/)
- [Weaviate - Hybrid Search Explained](https://weaviate.io/blog/hybrid-search-explained)
- [RAGAS Framework](https://docs.ragas.io/en/stable/)
- [Anthropic - Prompt Caching](https://www.anthropic.com/news/prompt-caching)

### Audio Transcription
- [OpenAI - gpt-4o-transcribe](https://openai.com/index/introducing-our-next-generation-audio-models/)
- [Deepgram Nova-3](https://deepgram.com/learn/introducing-nova-3-speech-to-text-api)
- [Northflank - STT Benchmarks 2026](https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks)

### Knowledge Ingestion
- [unpdf (unjs)](https://github.com/unjs/unpdf)
- [Jina Reader](https://jina.ai/reader/)
- [Mozilla Readability](https://github.com/mozilla/readability)
- [Tensorlake - Citation-Aware RAG](https://www.tensorlake.ai/blog/rag-citations)

### Memory Systems
- [Mem0 Research Paper](https://arxiv.org/abs/2504.19413)
- [Zep/Graphiti - Temporal Knowledge Graphs](https://arxiv.org/abs/2501.13956)
- [Memory in the Age of AI Agents (Survey)](https://arxiv.org/abs/2512.13564)
- [ENGRAM](https://arxiv.org/abs/2511.12960)

### Multi-Tenant Architecture
- [Mavic Labs - Multi-Tenant RAG 2026](https://www.maviklabs.com/blog/multi-tenant-rag-2026)
- [Nile - Multi-Tenant RAG](https://www.thenile.dev/blog/multi-tenant-rag)
- [AWS - Multi-tenant RAG with Bedrock](https://aws.amazon.com/blogs/machine-learning/multi-tenant-rag-with-amazon-bedrock-knowledge-bases/)
- [Crunchy Data - RLS for Tenants](https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres)
