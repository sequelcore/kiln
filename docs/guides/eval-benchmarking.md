# Eval Benchmarking

Kiln's eval framework implements 23 scorers aligned with leading AI agent benchmarks and academic research. This document maps each scorer to its research basis, explains the metrics that predict real-world agent quality, and catalogs the industry standards Kiln's eval aligns with.

Source: `packages/core/src/eval/`.

## Scorer Alignment with Research

### Outcome Scorers (Highest Predictive Value)

| Scorer | Type | Research Basis | What It Validates |
|--------|------|----------------|-------------------|
| `ConsistencyRunner` (pass^k) | Utility | tau-bench (Sierra Research) | Production reliability. An agent scoring 85% on pass^1 may score 25% on pass^5. |
| `policy-adherence` | LLM-judge | tau-bench | Business rule compliance beyond task completion. |
| `effort` | Rule-based | CES research | Customer Effort Score -- most predictive metric for customer loyalty. |
| `resolution` | Rule-based | Industry FCR | First Contact Resolution quality (resolved/partial/ambiguous/unresolved). |

### Tool & Function Calling Scorers

| Scorer | Type | Research Basis | What It Validates |
|--------|------|----------------|-------------------|
| `tool-calling-accuracy` | Rule-based | BFCL v4 (UC Berkeley) | Deterministic F1 accuracy: function name + parameter correctness. |
| `tool-trajectory` | LLM-judge | BFCL v4, MINT | Tool-use sequence efficiency: selection, ordering, redundancy. |

### RAG & Knowledge Scorers

| Scorer | Type | Research Basis | What It Validates |
|--------|------|----------------|-------------------|
| `faithfulness` | LLM-judge | RAGAS | Output grounded in context (hallucination detection). |
| `context-relevance` | LLM-judge | RAGAS | Retrieval quality -- are context chunks relevant to the query? |
| `hallucination` | LLM-judge | RAGAS | Factual claims absent from context (inverse faithfulness). |

### Multi-Agent Coordination Scorers

| Scorer | Type | Research Basis | What It Validates |
|--------|------|----------------|-------------------|
| `routing-accuracy` | Rule-based | MultiAgentBench/MARBLE | Did the correct agent handle the message? |
| `handoff-quality` | LLM-judge | MultiAgentBench/MARBLE | Context preservation across agent switches. |
| `milestone` | Rule-based | MultiAgentBench/MARBLE | Intermediate checkpoint achievement in multi-step workflows. |

### Safety & Adversarial Scorers

| Scorer | Type | Research Basis | What It Validates |
|--------|------|----------------|-------------------|
| `safety-preservation` | LLM-judge | AgentDojo (Invariant Labs + ETH Zurich) | Dual score: attack resistance + utility preservation under adversarial input. |
| `toxicity` | LLM-judge | SimpleSafetyTests, OWASP Agentic | Harmful, offensive, or inappropriate content detection. |
| Safety adversarial dataset (145 items) | Dataset | AgentDojo, OWASP | PII, content safety, prompt injection, policy, benign controls. |

### Conversation Quality Scorers

| Scorer | Type | Research Basis | What It Validates |
|--------|------|----------------|-------------------|
| `multi-turn-consistency` | LLM-judge | MINT (ICLR 2024) | Context retention across turns -- contradictions, forgotten facts. |
| `relevance` | LLM-judge | General NLP | Output directly addresses the input. |
| `coherence` | LLM-judge | General NLP | Logical consistency and structure. |
| `custom-prompt` | LLM-judge | Anthropic eval guide | Operator-defined evaluation criteria. |

### Operational Scorers

| Scorer | Type | Research Basis | What It Validates |
|--------|------|----------------|-------------------|
| `latency` | Rule-based | SLA requirements | Response time within declared limit. |
| `cost` | Rule-based | Budget management | Cost per call within declared limit. |
| `exact-match` | Rule-based | Standard NLP eval | Output matches expected (deterministic). |
| `contains` | Rule-based | Standard NLP eval | Output contains required substrings. |
| `json-validity` | Rule-based | Structured output eval | Valid JSON, optional schema validation. |
| `length` | Rule-based | Output constraints | Character count within declared range. |

## Metrics Ranked by Predictive Power

Based on research consensus across tau-bench, BFCL, MultiAgentBench, AgentDojo, and RAGAS:

### Outcome Metrics (Most Predictive)

| # | Metric | Kiln Scorer | Source |
|---|--------|-------------|--------|
| 1 | pass^k consistency | `ConsistencyRunner` | tau-bench |
| 2 | Policy adherence | `policy-adherence` | tau-bench |
| 3 | First Contact Resolution | `resolution` | Industry |
| 4 | Customer Effort Score | `effort` | CES research |

### Process Metrics (Diagnostic)

| # | Metric | Kiln Scorer | Source |
|---|--------|-------------|--------|
| 5 | Token efficiency | `cost`, `latency` | Multiple |
| 6 | Tool selection accuracy | `tool-calling-accuracy`, `tool-trajectory` | BFCL v4 |
| 7 | Context retention | `multi-turn-consistency` | MINT |
| 8 | Milestone achievement | `milestone` | MultiAgentBench |

### Safety Metrics (Non-Negotiable)

| # | Metric | Kiln Scorer | Source |
|---|--------|-------------|--------|
| 9 | Prompt injection resistance | `safety-preservation` | AgentDojo |
| 10 | Routing accuracy | `routing-accuracy` | MultiAgentBench |
| 11 | Handoff quality | `handoff-quality` | MultiAgentBench |

## Key Research Findings

### tau-bench: pass^k Is the Most Revealing Metric

The gap between pass^1 and pass^k separates demo-ready from production-ready agents. GPT-4o scores 85% on pass^1 but drops to 25% on pass^8. Kiln's `ConsistencyRunner` implements this metric with configurable `k` and `passThreshold`.

### BFCL v4: Single-Turn vs Multi-Turn Tool Calling

State-of-the-art LLMs excel at single-turn function calls but struggle with memory, dynamic decision-making, and long-horizon reasoning. Kiln addresses this with both `tool-calling-accuracy` (deterministic F1) and `tool-trajectory` (LLM-judged efficiency).

### MINT: Multi-Turn Performance Is Independent

Better single-turn performance does NOT guarantee better multi-turn performance. SIFT and RLHF generally hurt multi-turn capabilities. The `multi-turn-consistency` scorer directly measures this.

### AgentDojo: Utility Under Attack

Agent utility must be measured under adversarial conditions, not just clean inputs. The `safety-preservation` scorer implements AgentDojo's dual evaluation (safety + utility).

### Anthropic Agent Eval Best Practices

1. Grade outcomes, not paths
2. Combine code-based and model-based graders per task
3. Use isolated judges per dimension with regular calibration
4. Evaluate intermediate states (the compound error problem)

Kiln follows all four: rule-based scorers for deterministic checks, LLM-as-judge for subjective quality, composite scorer for weighted/binary scoring, and milestone scorer for intermediate state evaluation.

### METR Time Horizons

Automatic scoring overestimates real-world performance. The gap between benchmark scores and production quality is the central unsolved problem in agent evaluation. Use pass^k to surface this gap.

## Industry Standards Alignment

| Standard | Status | Kiln Coverage |
|----------|--------|---------------|
| NIST AI Agent Standards (Feb 2026) | Active | Safety pipeline, audit log, prompt injection scanning |
| OWASP Top 10 for Agentic Apps (Dec 2025) | Active | PII scanner, content classifier, policy rails, indirect injection scanning |
| MCP (Model Context Protocol) | Implemented | MCP client with circuit breaker |
| A2A (Agent-to-Agent) | Implemented | A2AClient for cross-app delegation |
| UK AISI Evaluation Standard | Reference | Sandbox isolation, safety pipeline |

## Safety Adversarial Dataset

Built-in dataset at `packages/core/evals/safety-adversarial.jsonl` (145 test cases):

| Category | Cases | Coverage |
|----------|-------|----------|
| PII | 21 | Email, phone, SSN, credit card (Luhn-valid), IP, DOB, mixed |
| Content Safety | 22 | Hate, violence, sexual, self-harm, harassment, misinformation |
| Prompt Injection | 67 | All 10 scanner categories (role hijacking, jailbreak, multi-language, etc.) |
| Policy | 17 | Topic, competitor, escalation, compliance |
| Benign Controls | 18 | Normal questions, educational content, false positive validation |

Each item has `metadata.category` and `metadata.subcategory` for filtering.

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
