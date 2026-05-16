# Knowledge

Knowledge provides RAG (Retrieval-Augmented Generation) capabilities for Kiln Apps. Ingest documents from files, URLs, or PDFs; chunk, embed, and store them; then retrieve relevant context at query time to ground agent responses.

Sources: `packages/core/src/knowledge/`, `packages/core/src/engine/domain/knowledge-config.ts`

---

## Overview

The Knowledge pipeline has two phases:

- **Ingest:** Content is extracted, chunked, optionally enriched with contextual metadata, embedded, and stored in a vector store.
- **Retrieve:** User queries are embedded and matched against stored chunks via vector similarity (or hybrid search when using PgVector).

Knowledge works transparently -- configure it in `app.yaml`, and the gateway injects context into agent prompts automatically.

---

## Retrieval Modes

| Mode | Behavior |
|------|----------|
| `auto` (default) | Retrieved context is injected into the system prompt before each agent turn. Zero application code required. |
| `tool` | A `knowledge_search` tool is registered on the agent. The agent decides when to search. Useful when retrieval is expensive or queries are selective. |

```yaml
knowledge:
  mode: auto   # or "tool"
```

---

## Sources

Sources define what content to ingest. Each source has a `name`, `path`, and optional `type`:

```yaml
knowledge:
  sources:
    - name: docs
      path: ./docs
      type: file
    - name: website
      path: https://example.com/faq
      type: url
    - name: manual
      path: ./assets/manual.pdf
      type: pdf
```

| Type | Extractor | Notes |
|------|-----------|-------|
| `file` | `FileExtractor` | Local text/markdown files |
| `url` | `UrlExtractor` | Fetches via Jina Reader, falls back to raw fetch. Supports auth headers via `ExtractionOptions`. |
| `pdf` | `PdfExtractor` | Uses `unpdf` (optional dependency, dynamic import) |

### Source Lifecycle

The `SourceManager` handles a three-phase lifecycle for each source:

1. **Extract** -- content is pulled from the source (file, URL, or PDF) via the appropriate extractor.
2. **Hash** -- a SHA-256 digest of the raw content is computed and stored on the source record (`contentHash`). On re-index, the hash is compared first -- unchanged sources are skipped entirely.
3. **Ingest** -- content is chunked, optionally enriched, embedded, and stored in the vector store. Re-ingestion cascade-deletes existing chunks before inserting new ones for atomic replacement.

This deduplication ensures that re-indexing is idempotent and avoids redundant embedding API calls for unchanged content.

### Authenticated Sources

URL and PDF extractors support custom HTTP headers for fetching from authenticated endpoints. Pass headers when creating a source via the admin API:

```json
POST /admin/{app}/knowledge/sources
{
  "name": "internal-docs",
  "type": "url",
  "uri": "https://api.example.com/docs",
  "headers": {
    "Authorization": "Bearer sk-..."
  }
}
```

Headers are persisted with the source record and used on every extraction (including re-index).

### Content Push

For internal APIs where Kiln cannot fetch content directly, push content to a source instead of having Kiln extract it:

```
POST /admin/{app}/knowledge/sources/:sourceId/content
Content-Type: application/json

{ "content": "The full text content to ingest..." }
```

Accepts JSON body (`{ "content": "..." }`) or raw text. Content is hashed, chunked, embedded, and stored -- same pipeline as extracted content. Skips re-ingestion if the content hash is unchanged.

### Source Admin API

The Gateway exposes CRUD routes for managing sources at runtime:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/{app}/knowledge/sources` | List all sources |
| `POST` | `/admin/{app}/knowledge/sources` | Create a source (optional `headers` for auth) |
| `GET` | `/admin/{app}/knowledge/sources/:sourceId` | Get source details (includes `error` on failure) |
| `POST` | `/admin/{app}/knowledge/sources/:sourceId/reindex` | Re-extract and re-ingest |
| `POST` | `/admin/{app}/knowledge/sources/:sourceId/content` | Push content directly (bypasses extraction) |
| `DELETE` | `/admin/{app}/knowledge/sources/:sourceId` | Delete source and its chunks |

---

## Chunking

Two strategies are available:

| Strategy | Class | Best For |
|----------|-------|----------|
| `recursive` | `RecursiveTextChunker` | General text, code |
| `markdown` | `MarkdownChunker` | Markdown with headers |

```yaml
knowledge:
  chunking:
    strategy: recursive
    chunkSize: 512      # tokens (default: 512)
    chunkOverlap: 50    # tokens (default: 50)
```

### Contextual Enrichment

Implements the [Anthropic contextual retrieval pattern](https://www.anthropic.com/news/contextual-retrieval). Before embedding, each chunk is sent to an LLM with the full document as context. The LLM generates a short situational summary that is prepended to the chunk, improving retrieval accuracy.

```yaml
knowledge:
  chunking:
    strategy: recursive
    contextual:
      enabled: true
      provider: anthropic       # or openai, deepseek, ollama
      model: claude-haiku-4-5-20251001
      apiKeyEnv: ANTHROPIC_API_KEY
      concurrency: 5            # parallel enrichment calls
```

Enrichment is fail-open: if a chunk fails enrichment, the original chunk is stored unchanged.

---

## Vector Stores

| Backend | Class | Use Case |
|---------|-------|----------|
| `memory` | `InMemoryVectorStore` | Dev mode, small datasets |
| `pgvector` | `PgVectorStore` | Production. PostgreSQL + pgvector with halfvec, HNSW index, hybrid search (RRF). |

```yaml
knowledge:
  store:
    backend: pgvector
    connectionString: ${DATABASE_URL}
  embedding:
    provider: openai
    model: text-embedding-3-small
    apiKeyEnv: OPENAI_API_KEY
```

> **OpenAI API Key Permissions:** The key referenced by `apiKeyEnv` must have the `model.request` scope. If using a restricted key, set the parent **"Model capabilities"** dropdown to **Request** (not just the Embeddings sub-item). As of March 2026, OpenAI has a known bug where restricted keys with only sub-item permissions fail with `Missing scopes: model.request`. The safest option is to use a key with **All** permissions.

PgVector features:
- **halfvec storage** -- 4x compression vs full float32 vectors (1536d float16 = ~3KB per vector vs ~6KB for float32), with minimal accuracy loss
- **HNSW index** -- fast approximate nearest neighbor search (15.5x better QPS than IVFFlat at 0.998 recall)
- **Hybrid search** -- combines vector similarity with BM25 text search via Reciprocal Rank Fusion (RRF, k=60). The k=60 constant balances emphasis between high-ranked and mid-ranked results, yielding +22% retrieval precision over vector-only search. Uses native PostgreSQL tsvector -- no extra infrastructure.
- **Metadata filtering** -- JSONB `@>` containment queries

The `postgres` package (Porsager) is a peer dependency. Install with `bun add postgres`.

---

## Contact Memory

Per-user persistent fact storage across conversations. Implements the Mem0 ADD/UPDATE/DELETE/NOOP extraction pattern.

After each conversation, an LLM extracts facts about the customer (preferences, entities, issues). Facts are stored as vector entries and recalled at session start to personalize responses.

```yaml
knowledge:
  contactMemory:
    enabled: true
    provider: anthropic
    model: claude-haiku-4-5-20251001
    apiKeyEnv: ANTHROPIC_API_KEY
```

Facts use bi-temporal tracking (`validAt`, `expiredAt`). Updates expire old facts and create new versions rather than overwriting.

### GDPR Compliance

The Gateway exposes admin routes for data deletion:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/{app}/contact-memory/facts` | List facts for a user |
| `DELETE` | `/admin/{app}/contact-memory/facts/:factId` | Delete a single fact |
| `DELETE` | `/admin/{app}/contact-memory/facts` | Delete all facts for a user (GDPR forgetAll) |

---

## Reranking

When enabled, the `CohereReranker` (Cohere Rerank API v2) re-scores retrieved chunks using a cross-encoder model for higher-quality ordering. The reranker uses a 4x over-fetch strategy: it retrieves 4 times the requested `topK` from the vector store, reranks all candidates, and returns only the top results.

```yaml
knowledge:
  reranker:
    provider: cohere
    apiKeyEnv: COHERE_API_KEY
    topK: 5          # final results returned
```

Reranking adds 200-500ms of latency per query. It is most valuable when precision matters more than speed, or when the corpus is large enough that vector similarity alone produces noisy results.

---

## Speech-to-Text

Audio messages, including WhatsApp voice notes, are transcribed before
processing when the app declares voice input. Configure STT under the top-level
`voice` key, not under gateway-local configuration.

| Provider | Adapter |
|----------|---------|
| OpenAI | `OpenAISttAdapter` |
| Deepgram | `DeepgramSttAdapter` |

```yaml
voice:
  stt:
    provider: openai
    model: gpt-4o-transcribe
    apiKeyEnv: OPENAI_API_KEY
```

Transcription behavior is governed by `voice.policy`. See
[Voice](voice.md) for the canonical configuration shape and
[Voice Capability](../architecture/voice-capability.md) for architecture
boundaries.

---

## YAML Reference

See [App YAML Reference](../configuration/app-yaml.md) for the full `knowledge:` configuration schema.
