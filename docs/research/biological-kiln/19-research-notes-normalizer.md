# 19 Research Notes Normalizer

## Research Prompt

```
I am going to paste raw research notes about biology, neuroscience, cybernetics, or memory.

Context: these notes are for Kiln, an AI orchestration engine (Bun/TypeScript) with these subsystems:
- Orchestrator (phase machine, sequential/supervisor/swarm strategies)
- Coordination Intelligence (ThresholdAllocator, CascadeController, TaskChannel, TeamComposer)
- Agents (6 provider adapters, MCP client, Tool RAG, model routing, complexity scoring)
- Memory (5 scopes, SQLite + FTS5, decay, compaction, contact memory)
- Safety (PII scanner, content classifier, policy rails, grounding rail, prompt injection defense)
- Knowledge RAG (PgVector, Cohere reranker, source manager)
- Tools (7 native dev tools, DevToolExecutionBridge, permission system)
- Events (EventBus with 43 typed events, OTel, Prometheus)
- Gateway (multi-tenant, 8 channel adapters, budget, auth, delegation)

Your task:
1. Clean and structure the notes
2. Separate hard mechanism from analogy
3. Extract direct Kiln implications
4. Identify whether each note belongs to:
   - orchestration
   - routing
   - coordination intelligence
   - memory
   - context governance
   - safety and security
   - tool execution
   - continuity and session state
   - observability

Then produce:
- concise structured notes
- a Kiln mapping section
- a "do not misuse this analogy" section

[PASTE RAW NOTES BELOW THIS LINE]
```
