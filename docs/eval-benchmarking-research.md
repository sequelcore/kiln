# Eval & Benchmarking Research

> Research date: March 2026
> Status: Research complete, roadmap actionable
> Context: Survey of official benchmarks, academic papers, industry frameworks, and standardization efforts for AI agent evaluation

## 1. Official Benchmarks for AI Agents

### 1.1 Directly Applicable to Kiln

#### tau-bench / tau2-bench (Sierra Research)

The most relevant benchmark for Kiln's primary use case (customer service orchestration).

- **Measures:** Customer service agent quality -- task completion while adhering to business policies, handling dynamic user interactions
- **Methodology:** Simulates conversations between LLM-user and LLM-agent with domain APIs and policy guidelines. tau2-bench (2025) adds dual-control where both agent and user actively modify shared world state
- **Key metric: pass^k** -- Can the agent solve the same problem k times consistently? GPT-4o scores 85% on pass^1 but drops to 25% on pass^8. This gap between "demo-ready" and "production-ready" is the single most revealing metric in agent evaluation
- **Applicability:** Very high. Directly maps to Kiln's Mode B, tenant routing, and policy adherence needs
- Paper: https://arxiv.org/pdf/2406.12045
- GitHub: https://github.com/sierra-research/tau2-bench

#### BFCL v4 -- Berkeley Function Calling Leaderboard (UC Berkeley)

- **Measures:** Function calling accuracy across serial, parallel, and multi-turn scenarios. V4 (July 2025) adds agentic evaluation with multi-hop reasoning and error recovery
- **Methodology:** AST-based evaluation that scales to thousands of functions. Tests abstention, reasoning in stateful multi-step settings, format sensitivity
- **Key finding:** SOT LLMs excel at single-turn calls but struggle with memory, dynamic decision-making, and long-horizon reasoning
- **Applicability:** Very high. Directly tests tool-use capabilities that Kiln orchestrates (ToolRAG, PerCallToolConfig, ModeBOrchestrator)
- Leaderboard: https://gorilla.cs.berkeley.edu/leaderboard.html

#### MultiAgentBench / MARBLE (UIUC, ACL 2025)

- **Measures:** Collaboration AND competition quality in multi-agent LLM systems using milestone-based KPIs
- **Methodology:** Evaluates coordination protocols (star, chain, tree, graph topologies) + strategies (group discussion, cognitive planning)
- **Key finding:** Graph structure performs best; cognitive planning improves milestone achievement by 3%
- **Applicability:** Very high. Kiln's sequential/supervisor/swarm strategies map directly to these topologies
- Paper: https://arxiv.org/abs/2503.01935
- GitHub: https://github.com/ulab-uiuc/MARBLE

#### AgentDojo (Invariant Labs + ETH Zurich)

- **Measures:** Agent utility under adversarial attacks (prompt injection). 97 realistic tasks + 629 security test cases
- **Applicability:** High. Validates Kiln's 2-tier prompt injection scanner and safety pipeline
- Blog: https://invariantlabs.ai/blog/agentdojo

#### RAGAS (RAG Assessment)

- **Measures:** RAG pipeline quality with reference-free metrics: faithfulness, answer relevance, context precision, context recall
- **Applicability:** Very high. Directly applicable to Kiln's knowledge pipeline (RetrievalPipeline, PgVectorStore, CohereReranker)
- Paper: https://arxiv.org/abs/2309.15217

### 1.2 Useful Reference

| Benchmark | Source | Measures | Kiln Relevance |
|-----------|--------|----------|----------------|
| GAIA2 | Meta FAIR + HuggingFace | General AI assistant in dynamic environments | Medium -- tests reasoning, not orchestration |
| GDPval | OpenAI | Real-world economically valuable task completion across 44 occupations | Medium -- evaluates output quality |
| MINT | ICLR 2024, UIUC | Multi-turn interaction with tools and language feedback | High -- multi-turn tool use is core Kiln |
| AgentThreatBench | UK AISI | OWASP Top 10 for Agents as executable tests | High for safety pipeline validation |
| MAESTRO | Academic | Compares 12 multi-agent architectures | Useful for strategy benchmarking |
| AgentBench | Tsinghua | LLM-as-Agent across 8 environments | Medium -- individual agent, not orchestration |
| SWE-bench | Princeton | Software engineering issue resolution | Low -- methodology is instructive |

### 1.3 Safety & Security Benchmarks

| Benchmark | Scope | Kiln Component |
|-----------|-------|----------------|
| AgentDojo | Prompt injection resistance (97 tasks + 629 adversarial) | `security/` PromptScanner |
| AgentThreatBench | OWASP Agentic Top 10 as executable tests | `safety/` + `security/` |
| SimpleSafetyTests | 100 prompts across 5 harm areas | `safety/` ContentClassifier |
| AgentHarm | Potentially harmful agent behaviors | `safety/` PolicyRails |

## 2. Key Academic Papers

### LLM-as-Judge (Survey, 2024-2025)

Validates Kiln's existing approach (6 LLM-as-judge scorers). Key insights:

- **Agent-as-Judge** framework evaluates entire chain of actions/decisions, not just final answer
- **Multi-agent debate evaluation** improves robustness
- **Known biases:** position bias, verbosity bias, chain-of-thought bias
- **Debiasing:** meta-judging and ensemble approaches show promise
- Paper: https://arxiv.org/abs/2411.15594

### Judge's Verdict Benchmark (ICLR 2026 submission)

- Tests how well 54 LLMs can replicate human judgment when scoring RAG/agentic pipeline outputs
- Directly informs which models work best as judges in Kiln's eval scorers
- Paper: https://openreview.net/forum?id=jVyUlri4Rw

### MINT -- Multi-turn Interaction (ICLR 2024)

- Performance gains of 1-8% per tool-use turn, 2-17% with language feedback
- **Critical finding:** Better single-turn performance does NOT guarantee better multi-turn performance
- SIFT and RLHF generally hurt multi-turn capabilities
- Paper: https://arxiv.org/abs/2309.10691

### Anthropic Agent Eval Best Practices

Key takeaways from Anthropic's engineering guide:

1. **Grade outcomes, not paths** -- Checking specific tool call sequences is too rigid
2. **Three grader types** -- Code-based, model-based, human. Combine them per task
3. **Scoring approaches** -- Weighted (combined threshold), binary (all pass), or hybrid
4. **Clear rubrics for LLM judges** -- Isolated judges per dimension, regular calibration
5. **Compound error problem** -- Agent mistakes propagate across turns; evaluate intermediate states
- Guide: https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents

## 3. Industry Eval Platforms

| Platform | Type | Focus | Differentiation |
|----------|------|-------|-----------------|
| **Arize Phoenix** | OSS | Tracing + eval at scale | Production-grade, millions/day scoring |
| **DeepEval** | OSS | TDD for LLMs | pytest-compatible, CI/CD integration |
| **RAGAS** | OSS | RAG-specific metrics | Reference-free, widely adopted |
| **Inspect AI** | OSS (UK AISI) | Government-grade evals | Run GAIA/SWE-bench with one command |
| **Bloom** | Anthropic | Automated behavioral evals | Agentic generation of targeted evaluations |
| **LangSmith** | Commercial | LangChain ecosystem | Ecosystem lock-in |
| **Braintrust** | Commercial | Collaborative prompt design | Human-in-the-loop |
| **Patronus AI** | Commercial | Safety evaluation API | Self-serve API for guardrails |

## 4. Standardization Efforts

### NIST AI Agent Standards Initiative (Feb 2026)

NIST's CAISI launched an initiative for interoperable and secure AI agents. Focus areas: security considerations, autonomous action safety, interoperability standards.

### OWASP Top 10 for Agentic Applications (Dec 2025)

Shaped by hundreds of experts. Covers: excessive agency, memory poisoning, improper output handling, prompt injection, insecure tool use. AgentThreatBench operationalizes this into executable test cases.

### UK AISI Autonomous Systems Evaluation Standard

Government standard for evaluating autonomous AI systems with sandboxing toolkit.

### Communication Protocol Standards

- MCP (Model Context Protocol) -- Kiln implements this
- A2A (Agent-to-Agent) -- Kiln implements this
- ACP (Agent Communication Protocol) -- emerging
- ANP (Agent Network Protocol) -- emerging

### METR Time Horizons

De facto standard for measuring agent autonomy progression. Measures longest task duration agents can reliably complete. Frontier doubling every ~7 months. Claude Opus 4.6 leads at 14h30m 50%-time-horizon.

## 5. Metrics That Predict Real-World Agent Quality

Ranked by predictive power based on research consensus:

### Outcome Metrics (most predictive)

| # | Metric | Why It Matters | Source |
|---|--------|----------------|--------|
| 1 | **pass^k consistency** | Run same eval k times, measure variance. The gap between pass^1 and pass^8 separates demo from production | tau-bench |
| 2 | **Policy adherence** | Did the agent follow business rules, not just complete the task? | tau-bench |
| 3 | **First Contact Resolution (FCR)** | Resolved without escalation. Industry target: 70-80% | Industry standard |
| 4 | **Customer Effort Score (CES)** | Most predictive of customer loyalty in AI-first service | Kiln already computes this |

### Process Metrics (diagnostic)

| # | Metric | Why It Matters | Source |
|---|--------|----------------|--------|
| 5 | **Token efficiency** | Same quality with fewer tokens = better orchestration | Multiple |
| 6 | **Tool selection accuracy** | Right tool, right params, right sequence | BFCL v4 |
| 7 | **Robustness / variance** | Performance consistency across input variations | Multiple |
| 8 | **Milestone achievement** | Intermediate progress, not just final outcome | MultiAgentBench |

### Safety Metrics (non-negotiable)

| # | Metric | Why It Matters | Source |
|---|--------|----------------|--------|
| 9 | **Prompt injection resistance** | Utility maintained under attack | AgentDojo |
| 10 | **Containment rate** | % handled without escalation (20-40% early, 60-80% mature) | Industry |
| 11 | **PII leakage rate** | Zero tolerance in production | OWASP Agentic |

### Critical Research Insight

> Automatic scoring overestimates real-world performance. METR's study found that agents "often implement functionally correct code that cannot be easily used as-is." The gap between benchmark scores and production quality is the central unsolved problem in agent evaluation.

## 6. Gap Analysis: Kiln's Current Eval vs Research

### What Kiln Already Has (Strong Foundation)

| Component | Status | Research Validation |
|-----------|--------|---------------------|
| 6 rule-based scorers (exact match, contains, JSON, length, latency, cost) | Implemented | Anthropic recommends code-based graders |
| 6 LLM-as-judge scorers (faithfulness, relevance, coherence, hallucination, toxicity, custom) | Implemented | Validated by LLM-as-Judge survey |
| Dataset loader + experiment runner | Implemented | Matches industry pattern |
| Experiment comparator | Implemented | Standard A/B eval approach |
| CompositeScorer | Implemented | Anthropic recommends weighted/binary scoring |
| Enrichment pipeline (effort score, sentiment, resolution) | Implemented | CES is top-4 predictive metric |

### Gaps Worth Closing

| Gap | Priority | Effort | Research Basis | Impact |
|-----|----------|--------|----------------|--------|
| ~~**Consistency scorer (pass^k)**~~ | P0 | Low | tau-bench | **IMPLEMENTED** -- `ConsistencyRunner` in `eval/consistency-runner.ts` |
| ~~**Policy adherence scorer**~~ | P0 | Medium | tau-bench | **IMPLEMENTED** -- `PolicyAdherenceScorer` in `eval/scorers/policy-adherence-scorer.ts` |
| **RAG metrics (RAGAS)** | P1 | Medium | RAGAS framework | Partially covered: `ContextRelevanceScorer` implemented; `FaithfulnessScorer` already covers RAG faithfulness |
| ~~**Tool trajectory scorer**~~ | P1 | Medium | BFCL v4, MINT | **IMPLEMENTED** -- `ToolTrajectoryScorer` in `eval/scorers/tool-trajectory-scorer.ts` |
| **Safety eval dataset** | P1 | Low | AgentDojo | Validates existing safety pipeline with standard adversarial inputs |
| **Multi-agent coordination metrics** | P2 | High | MultiAgentBench | Routing accuracy, handoff quality, milestone tracking |
| **Intermediate state evaluation** | P2 | High | Anthropic guide | Evaluate checkpoints, not just final output |

## 7. Recommended Roadmap

### Phase A: High-Signal Additions (Low Effort)

1. ~~**ConsistencyRunner**~~ -- **DONE.** `ConsistencyRunner` class, pass^k metric, sequential runs
2. **Safety eval dataset** -- Curate 100+ adversarial inputs from AgentDojo patterns, run through existing safety pipeline scorers
3. **Enrichment-as-eval bridge** -- Feed enrichment results (effort score, sentiment, resolution) back as eval scores

### Phase B: Domain-Specific Scorers (Medium Effort)

4. ~~**PolicyAdherenceScorer**~~ -- **DONE.** LLM-as-judge with configurable `policies[]`
5. ~~**RAGFaithfulnessScorer**~~ -- **SKIPPED.** Already covered by existing `FaithfulnessScorer` (checks output vs context)
6. ~~**ContextRelevanceScorer**~~ -- **DONE.** Checks if retrieved chunks are relevant to the query
7. ~~**ToolTrajectoryScorer**~~ -- **DONE.** Evaluates tool-use sequence from `metadata.toolCalls`

### Phase C: Multi-Agent Eval (Higher Effort)

8. **RoutingAccuracyScorer** -- Did the right agent handle the message? (uses labeled dataset)
9. **HandoffQualityScorer** -- Was context preserved across agent switches?
10. **MilestoneScorer** -- Track intermediate checkpoint achievement in multi-step workflows

## References

- tau-bench: https://arxiv.org/pdf/2406.12045
- tau2-bench: https://github.com/sierra-research/tau2-bench
- BFCL v4: https://gorilla.cs.berkeley.edu/leaderboard.html
- MultiAgentBench/MARBLE: https://arxiv.org/abs/2503.01935
- AgentDojo: https://invariantlabs.ai/blog/agentdojo
- RAGAS: https://arxiv.org/abs/2309.15217
- LLM-as-Judge Survey: https://arxiv.org/abs/2411.15594
- Agent-as-Judge: https://arxiv.org/html/2508.02994v1
- MINT: https://arxiv.org/abs/2309.10691
- Anthropic Agent Eval Guide: https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- GAIA2: https://openreview.net/forum?id=9gw03JpKK4
- GDPval: https://arxiv.org/abs/2510.04374
- MAESTRO: https://arxiv.org/pdf/2601.00481
- AgentThreatBench: https://github.com/UKGovernmentBEIS/inspect_evals/issues/1031
- NIST AI Agent Standards: https://www.nist.gov/news-events/news/2026/02/announcing-ai-agent-standards-initiative-interoperable-and-secure
- OWASP Agentic Top 10: https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/
- METR Time Horizons: https://metr.org/time-horizons/
- AI Agent Benchmark Compendium: https://github.com/philschmid/ai-agent-benchmark-compendium
- Inspect AI: https://inspect.aisi.org.uk/
