# 14 Kiln Context Governance — Applied Today

## Research Prompt

```
You are a senior research architect studying context governance for Kiln through the lens of selective attention, working memory, and inhibitory control.

Kiln's current context governance systems:

1. Preamble builder (preamble-builder.ts):
   - Assembles <kiln-preamble> XML for harness sessions
   - Inputs: task, domain detection, memory snapshot, project path
   - buildProviderSystemPrompt() for direct provider sessions

2. Context formatter (context-formatter.ts):
   - formatKnowledgeContext(): knowledge RAG results → [Knowledge Context] block
   - formatContactContext(): contact memory facts → [Contact Context] block
   - mergeContextSources(): combines all context sources into system prompt

3. User context:
   - Record<string, string> on POST /message (merge semantics across turns)
   - Stored on ModeBSession._userContext, persisted via session-serializer
   - Injected as [User Context] block first in mergedMemory
   - {{user.*}} token interpolation in agent role/goal/backstory/instructions

4. Knowledge modes:
   - auto-inject: knowledge context added to every message automatically
   - tool: knowledge available via tool call only (agent decides when to retrieve)

5. Token tracking:
   - Per-role:model cache-aware cost tracking
   - Provider context tracker with compaction-threshold checks
   - Budget middleware (fail-open)
   - BUDGET_EXHAUSTED error code

6. Model routing (as attention):
   - Complexity scorer (5 signals, <1ms): determines how much compute to allocate
   - Rules router (Tier 1, priority-ordered): deterministic routing
   - AgentRAG (Tier 2, embedding-based): semantic routing
   - Model capability registry (17 models, eligible() filtering)

7. Tool selection (as attention):
   - Tool RAG: embedding-based tool relevance scoring
   - Per-tenant tool allowlists
   - PerCallToolConfig: per-tenant tool config (allowlist, rateLimiter, additionalTools, skillInstructions)

I need:
1. A critique of these context selection systems as if they were a cognitive attention system
2. A better biologically grounded architecture for context governance
3. Rules for salience, inhibition, reinforcement, overflow, and pruning
4. A direct mapping from these principles to:
   - CLI projected context
   - runtime support artifacts
   - continuity decisions
   - token budget regulation

Output should end with:
- a target architecture
- transition steps
- anti-patterns to remove

End with these sections:
- Mechanisms
- Software Abstractions
- Direct Kiln Mappings
- Risks / Misuse
- Where The Analogy Breaks
- Actionable Research Follow-Ups
```
