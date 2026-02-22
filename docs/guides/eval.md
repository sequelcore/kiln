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

## Validation Rules

`validateEvalConfig()` enforces:

- `datasets`, `scorers`, and `experiments` arrays must all be non-empty.
- Dataset names must be unique across the `datasets` array.
- Scorer names must be unique across the `scorers` array.
- `composite` scorers must have a non-empty `scorers` sub-array.
- `custom-prompt` scorers must have a non-empty `prompt` string.
- `contains` scorers must have a non-empty `substrings` array.
- `length.minLength` must be less than `length.maxLength`.
- `latency.maxLatencyMs` and `cost.maxCostUsd` must be greater than 0.
- Each experiment's `dataset` must reference an existing dataset name.
- Each scorer name in `experiment.scorers` must reference an existing scorer name.
- `experiment.compare` cannot reference itself.
- Circular `compare` chains are detected and rejected.

All errors are collected before throwing, so the operator sees every problem in one pass.
