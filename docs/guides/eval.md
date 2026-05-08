# Evaluation Framework

The evaluation framework measures agent output quality against labeled datasets using configurable scorers. It is declared in the `eval` block of `app.yaml` and runs through the dev API at `/dev/eval/`.

Source: `packages/core/src/eval/`.

## Dataset Format

Datasets are JSONL files where each line is a JSON object with the following fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | yes | Unique item identifier |
| `input` | `string` | yes | The prompt or user message sent to the agent |
| `expected` | `string` | no | Expected output (used by exact-match, faithfulness, etc.) |
| `context` | `string[]` | no | Reference passages for faithfulness and relevance scoring |
| `metadata` | `object` | no | Arbitrary metadata passed through to results |

```jsonl
{"id": "q1", "input": "What is the refund policy?", "expected": "30-day refund", "context": ["Our refund policy allows returns within 30 days."]}
{"id": "q2", "input": "How do I reset my password?", "expected": "Use the forgot password link on the login page."}
```

`parseDatasetJsonl()` validates each line and throws on malformed entries.

## Scorer Types

### Rule-Based Scorers

| Type | Score | Config Fields | Description |
|------|-------|---------------|-------------|
| `exact-match` | 0 or 1 | — | Output equals `expected` (trimmed, case-sensitive). |
| `contains` | 0 or 1 | `substrings: string[]` | Output contains all declared substrings. |
| `json-validity` | 0 or 1 | `schema?` | Output is valid JSON; optionally validates against a JSON Schema. |
| `length` | 0 or 1 | `minLength?`, `maxLength?` | Output length (characters) is within the declared range. |
| `latency` | 0 or 1 | `maxLatencyMs` | Response time is within the declared limit. |
| `cost` | 0 or 1 | `maxCostUsd` | Cost per call is within the declared limit. |
| `effort` | 0–1 | — | Customer Effort Score from `metadata.effortComponents`. Uses the enrichment pipeline's deterministic formula, normalized from 0-10 to 0-1. |
| `resolution` | 0–1 | — | Resolution quality from `metadata.resolution`. Maps status (resolved=1.0, partial=0.5, ambiguous=0.25, unresolved=0.0), weighted by confidence. |
| `tool-calling-accuracy` | 0–1 | — | BFCL-style deterministic tool calling accuracy. Compares `metadata.toolCalls` against `metadata.expectedToolCalls` using F1 score (precision + recall). Checks function name and parameter correctness. |
| `routing-accuracy` | 0 or 1 | — | Compares `metadata.activeAgentId` against `metadata.expectedAgentId`. Exact match. |
| `milestone` | 0–1 | — | Fraction of milestones completed. Reads `metadata.milestones` (array of `{name, completed}`). Reports missed milestones. |

### LLM-as-Judge Scorers

All LLM-as-judge scorers return a continuous score from 0.0 to 1.0 with a `reasoning` string.

| Type | Config Fields | What It Measures |
|------|---------------|-----------------|
| `faithfulness` | — | Output is grounded in `context`. Detects hallucinations relative to provided passages. |
| `relevance` | — | Output directly addresses the `input`. |
| `coherence` | — | Output is logically consistent and well-structured. |
| `hallucination` | — | Output contains factual claims absent from `context` (inverse of faithfulness). |
| `toxicity` | — | Output does not contain harmful, offensive, or inappropriate content. |
| `custom-prompt` | `prompt: string` | Custom LLM evaluation. The `prompt` receives `{input}`, `{output}`, `{expected}`, and `{context}` template variables. |
| `policy-adherence` | `policies: string[]` | Output complies with declared business policy rules. Enumerates policies in the prompt and evaluates adherence. |
| `context-relevance` | — | Retrieved `context` chunks are relevant to the `input` query. Measures retrieval quality, not answer quality. |
| `tool-trajectory` | — | Tool-use sequence (from `metadata.toolCalls`) is efficient and appropriate. Evaluates tool selection, ordering, and redundancy. |
| `multi-turn-consistency` | — | Context retention across conversation turns. Reads `metadata.conversationHistory` (array of `{role, content}`). Detects contradictions, forgotten facts, and unnecessary repetition. |
| `safety-preservation` | — | AgentDojo-inspired dual scorer: evaluates safety (attack resistance) AND utility (helpfulness) under adversarial input. Combined score = (safety + utility) / 2. Reads optional `metadata.attackType`. |
| `handoff-quality` | — | Context preservation across agent handoffs. Reads `metadata.handoffHistory` (array of `{fromAgent, toAgent, summary?, reason?}`). Evaluates handoff reason, context summary, and seamless pickup. |

### Composite Scorer

`composite` averages the scores of a named list of sub-scorers. Sub-scorers must be declared in the same `scorers` array.

```yaml
scorers:
  - name: quality
    type: composite
    scorers:
      - name: faithfulness-check
        type: faithfulness
      - name: relevance-check
        type: relevance
```

## YAML Configuration

The `eval` block in `app.yaml` declares datasets, scorers, and experiments:

```yaml
eval:
  datasets:
    - name: support-qa
      path: ./evals/support-qa.jsonl
    - name: support-qa-v2
      path: ./evals/support-qa-v2.jsonl

  scorers:
    - name: exact
      type: exact-match
    - name: response-contains-policy
      type: contains
      substrings: ["30-day", "refund"]
    - name: grounded
      type: faithfulness
    - name: fast-response
      type: latency
      maxLatencyMs: 2000
    - name: overall-quality
      type: composite
      scorers:
        - name: grounded
          type: faithfulness
        - name: relevant
          type: relevance
    - name: custom-eval
      type: custom-prompt
      prompt: |
        Rate whether the following answer is accurate and helpful (0-1).
        Question: {input}
        Answer: {output}
        Expected: {expected}
        Respond with SCORE: <number> and REASONING: <explanation>

  experiments:
    - name: baseline
      dataset: support-qa
      team: support-team
      scorers: [exact, grounded, fast-response]

    - name: improved
      dataset: support-qa-v2
      team: support-team
      scorers: [exact, grounded, fast-response, overall-quality]
      compare: baseline
      overrides:
        model: claude-sonnet-4-6
```

## Experiment Runner

`ExperimentRunner` generates outputs for each dataset item by calling the target team, then scores each output independently with every declared scorer.

**Per-scorer error isolation:** If one scorer throws, its result is recorded as `score: 0` with the error message in `reasoning`. Other scorers in the same run are not affected.

**Overrides:** The `overrides` field on an experiment accepts arbitrary key-value pairs passed to the team at run time (e.g., substitute a different model without changing the App YAML).

Each `ExperimentResult` contains:
- `itemId`: dataset item ID
- `output`: agent's response string
- `scores`: array of `EvalScore` objects (one per scorer)
- `durationMs`: response latency
- `tokenUsage`: `{ inputTokens, outputTokens }`

## Experiment Comparator

The `compare` field names another experiment for side-by-side comparison. `compareExperiments()` produces a diff across all shared scorer names.

```yaml
experiments:
  - name: baseline
    dataset: support-qa
    team: support-team
    scorers: [grounded, relevant]

  - name: v2
    dataset: support-qa
    team: support-team
    scorers: [grounded, relevant]
    compare: baseline
```

The Eval Dashboard in Kiln Studio displays the comparison as a score table with delta indicators. See [studio](../sdk/studio.md).

## Consistency Runner (pass^k)

The `ConsistencyRunner` implements the tau-bench pass^k metric for measuring production readiness. It runs the same experiment `k` times and computes what fraction of dataset items pass ALL runs consistently.

```typescript
import { ConsistencyRunner, ExperimentRunner } from "@kilnai/core";

const runner = new ExperimentRunner({ /* ... */ });
const cr = new ConsistencyRunner({ runner, k: 5, passThreshold: 0.8 });
const result = await cr.run();

// result.passAtK -- fraction of items passing ALL 5 runs (0.0 to 1.0)
// result.itemResults -- per-item breakdown (passCount, allPassed)
```

**Why this matters:** An agent scoring 85% on a single run may only score 25% on pass^5. The gap between pass^1 and pass^k is the most revealing metric for production reliability (from Sierra Research's tau-bench).

- `k`: Number of independent runs (must be >= 1)
- `passThreshold`: Minimum score for a "pass" (default: 1.0)
- Runs are sequential to avoid rate limit storms from multiplied LLM calls

## Benchmark Baseline Readiness

Kiln separates ordinary eval experiments from benchmark validation. Ordinary
evals help improve apps and agents. Benchmark validation decides whether a
frozen Kiln surface is reproducible enough for external benchmark reporting.

`@kilnai/core` exports:

- `KILN_BENCHMARK_PROFILES`
- `KILN_EXTERNAL_BENCHMARK_TRACKS`
- `evaluateBenchmarkReadiness()`

The built-in benchmark-facing profiles are:

| Profile | Purpose |
| --- | --- |
| `kiln-tool-agent` | Tool/function-calling correctness under Kiln authority. |
| `kiln-managed-child-agent` | Managed child invocation, route selection, handoff, and evidence quality. |
| `kiln-managed-coding-agent` | Bounded coding with approved write authority and replayable evidence. |
| `kiln-safety-agent` | Prompt-injection resistance, policy preservation, and utility. |

Each profile declares required scorers, minimum `passAtK`, minimum `k`, and
reproducibility requirements. A baseline result must include the exact profile
version, dataset version, config hash, scorer set, pass^k result, and artifact
URIs before it can be treated as benchmark-ready.

```typescript
import {
  KILN_BENCHMARK_PROFILES,
  evaluateBenchmarkReadiness,
} from "@kilnai/core";

const toolProfile = KILN_BENCHMARK_PROFILES.find((profile) => profile.id === "kiln-tool-agent")!;
const report = evaluateBenchmarkReadiness({
  profiles: [toolProfile],
  baselines: [{
    profileId: "kiln-tool-agent",
    profileVersion: toolProfile.version,
    datasetName: "tool-calling-internal",
    datasetVersion: "2026-05-08",
    k: 5,
    passAtK: 0.92,
    scorers: ["tool-calling-accuracy", "tool-trajectory", "latency", "cost"],
    artifactUris: ["kiln://artifacts/eval/tool-calling-internal/result"],
    configHash: "sha256:...",
  }],
});
```

`evaluateBenchmarkReadiness()` returns:

- per-profile readiness
- blocked profile issues
- external-ready tracks when adapters are candidates and required surfaces pass
- blocked tracks when adapters or profiles are missing

See [Benchmark Validation](../architecture/benchmark-validation.md) for the
architecture contract and public reporting requirements.

## Metadata in Eval

`EvalInput.metadata` carries arbitrary structured data from dataset items to scorers. This enables scorers like `tool-trajectory` that need domain-specific data beyond input/output/context.

Dataset items with metadata:

```jsonl
{"id": "t1", "input": "Look up order #123", "expected": "Order shipped", "metadata": {"toolCalls": [{"name": "lookup_order", "args": {"orderId": "123"}, "result": "shipped"}]}}
```

The `ExperimentRunner` automatically forwards `DatasetItem.metadata` to `EvalInput.metadata`.

## Safety Adversarial Dataset

A built-in adversarial dataset at `packages/core/evals/safety-adversarial.jsonl` provides 145 test cases for validating the safety pipeline:

| Category | Cases | Coverage |
|----------|-------|----------|
| PII | 21 | email, phone, SSN, credit card (Luhn-valid), IP, DOB, mixed |
| Content Safety | 22 | hate, violence, sexual, self-harm, harassment, misinformation |
| Prompt Injection | 67 | All 10 scanner categories (role hijacking, jailbreak, multi-language, etc.) |
| Policy | 17 | Topic, competitor, escalation, compliance |
| Benign Controls | 18 | Normal questions, educational content, false positives |

Each item has `metadata.category` and `metadata.subcategory` for filtering.

## Validation Rules

`validateEvalConfig()` enforces:

- `datasets`, `scorers`, and `experiments` arrays must all be non-empty.
- Dataset names must be unique across the `datasets` array.
- Scorer names must be unique across the `scorers` array.
- `composite` scorers must have a non-empty `scorers` sub-array.
- `custom-prompt` scorers must have a non-empty `prompt` string.
- `contains` scorers must have a non-empty `substrings` array.
- `policy-adherence` scorers must have a non-empty `policies` array.
- `length.minLength` must be less than `length.maxLength`.
- `latency.maxLatencyMs` and `cost.maxCostUsd` must be greater than 0.
- Each experiment's `dataset` must reference an existing dataset name.
- Each scorer name in `experiment.scorers` must reference an existing scorer name.
- `experiment.compare` cannot reference itself.
- Circular `compare` chains are detected and rejected.

All errors are collected before throwing, so the operator sees every problem in one pass.
