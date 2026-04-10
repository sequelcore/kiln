# 13 Kiln Memory — Applied Today

## Research Prompt

```
You are a senior research architect doing a deep architecture review of Kiln's memory-like systems, using biological memory as the analytical lens.

Kiln's current memory-like systems (be precise about these — they are real, not hypothetical):

1. Long-term memory (SqliteMemoryStore):
   - 5 scopes: user, agent, team, project, org
   - SQLite + FTS5 full-text search
   - Exponential decay (configurable half-life)
   - Compaction (LLM-based summarization of related memories)
   - Tenant namespacing
   - Git sync capability
   - CRUD via MCP tools (memory_store, memory_recall, memory_forget)

2. Contact memory (ContactMemoryServiceImpl):
   - Per-user fact extraction via LLM
   - Mem0 pattern: ADD/UPDATE/DELETE/NOOP operations
   - Recall at session start
   - GDPR forgetAll
   - Injected as [Contact Context] block in system prompt

3. Session state (ModeBSession):
   - Version tracking, optimistic concurrency
   - Token/turn tracking
   - Conversation history (ContentPart[] messages)
   - User context (Record<string, string>, merge semantics)
   - Session mode state machine (ai_active/queued/human_active/resolved)
   - Pluggable SessionStore (in-memory, Redis)

4. Knowledge RAG:
   - Source lifecycle: extract → hash → ingest (content dedup via SHA-256)
   - Retrieval: chunk → embed → search → rerank (Cohere)
   - PgVector with halfvec + HNSW + RRF hybrid search
   - Knowledge modes: auto-inject vs tool
   - Injected as [Knowledge Context] block in system prompt

5. Skill system:
   - SKILL.md format (markdown + YAML frontmatter)
   - SkillRegistry: 3-tier discovery (project, user, global)
   - SkillGenerator: auto-generate post-session
   - SkillCaptureService: two-phase (extractSummary → generateSkill)
   - Injected via PerCallToolConfig.skillInstructions

6. Cross-agent memory (SwarmStore):
   - MCP-backed key-value with tag conventions (_swarm:, _member:, _claim:)
   - join/leave/status/broadcast/claim/release operations
   - Used for multi-agent coordination state

7. Context artifacts:
   - Preamble builder: domain, memory snapshot, project path
   - User context interpolation ({{user.*}} tokens)
   - Context formatter: merges knowledge + contact context sources

Task:
1. Build a clean taxonomy of these as separate but related memory concepts
2. Identify overlaps, duplication, and conceptual leaks between them
3. Map each to a biological memory analogue (working, episodic, semantic, procedural, etc.)
4. Recommend a future biological memory architecture for Kiln
5. Explain which current layers should merge, which should stay separate, and why

Be strict. Prefer deletion and boundary clarity over accommodation.

End with these sections:
- Mechanisms
- Software Abstractions
- Direct Kiln Mappings
- Risks / Misuse
- Where The Analogy Breaks
- Actionable Research Follow-Ups
```
