# Governed External Engagement

Governed external engagement is the Kiln surface for discovering, reading, and
turning external community evidence into governed product intake without giving
agents uncontrolled platform authority. X is the first adapter.

This is not an X bot, a scraping browser agent, or social posting automation.
Discovery, read evidence, signal extraction, review, decision, promotion,
action proposal, approval authority, and execution are separate phases with
separate contracts.

## Product Flow

The long-term flow is:

```text
Discover -> Read Evidence -> Extract Signals -> Review -> Decide -> Promote -> Propose Action -> Approve Authority -> Execute
```

The current public implementation completes the discovery, read, signal,
review, decision, and promotion side. It also defines provider-neutral action
proposal and approval contracts for future write-capable adapters, but it does
not execute public writes.

## Current Scope

The current X path can:

- run bounded X recent-search discovery by query or hashtag;
- accept X post URLs or post ids from the operator;
- deduplicate root post references;
- estimate the maximum read budget before network access;
- fetch root posts and a bounded number of replies;
- write a structured JSON evidence report;
- preserve source URLs, platform ids, author metadata, metrics, and retrieval
  evidence when available;
- transform reports into candidate, review, decision, and feature-intake
  artifacts without additional provider calls.

The current X path cannot:

- publish posts;
- reply;
- like;
- repost;
- follow accounts;
- read or send DMs;
- run unbounded timeline, search, reply, or browser loops;
- approve its own proposed public action.

## CLI

Preview a bounded search plan without touching the network:

```bash
kiln external-engagement x-search \
  --query "#mcp" \
  --max-posts 25 \
  --max-replies 3 \
  --max-requests 30 \
  --dry-run
```

Fetch a bounded search report:

```bash
kiln external-engagement x-search \
  --query "#mcp" \
  --max-posts 25 \
  --max-replies 3 \
  --max-requests 30 \
  --output ./.kiln/external-engagement/x-search-report.json
```

`x-search` uses X recent search and records the discovery scope in the evidence
report. Scope fields include query, search scope, maximum root posts, maximum
replies per root post, optional `--since` / `--until` ISO timestamps, optional
`--max-requests`, and sampling limitations. The command fails before credential
resolution or network access if the estimated request count exceeds
`--max-requests`.

Dry-run a report plan without touching the network:

```bash
kiln external-engagement x-report \
  --url https://x.com/example_author/status/1000000000000000001 \
  --max-replies 10 \
  --dry-run
```

Fetch a bounded report:

```bash
kiln external-engagement x-report \
  --input ./x-sources.txt \
  --max-replies 25 \
  --output ./.kiln/external-engagement/x-report.json
```

`x-search` and `x-report` cache successful reports by default under:

```text
.kiln/cache/external-engagement/x-report
```

For `x-report`, the cache key is based on X post ids and `--max-replies`, not
raw source URLs. For `x-search`, the cache key includes the bounded discovery
scope, not credentials or raw operator files. Use these flags when needed:

```bash
kiln external-engagement x-report --input ./x-sources.txt --no-cache
kiln external-engagement x-report --input ./x-sources.txt --refresh-cache
kiln external-engagement x-report --input ./x-sources.txt --cache-dir C:/tmp/kiln-x-cache
kiln external-engagement x-search --query "#mcp" --no-cache
```

Run a live read-only credential smoke check:

```bash
kiln external-engagement x-smoke \
  --allow-live
```

`x-smoke` performs exactly one X API request to the authenticated user lookup
endpoint and returns JSON with the credential reference id, authenticated user
identity, request count, and rate-limit headers when X returns them. It never
publishes, replies, likes, reposts, follows, reads DMs, or refreshes tokens.
The `--allow-live` flag is mandatory so live paid API access cannot happen by
accident.

Refresh an OAuth 2.0 user access token:

```bash
kiln external-engagement x-refresh \
  --allow-live \
  --secret-output C:/tmp/kiln-x-oauth2-tokens.json
```

`x-refresh` is a credential maintenance command, not an evidence report. It
requires explicit live approval and an explicit secret-bearing output path. The
command writes the refreshed access token, and the refresh token when X returns
one, only to `--secret-output`. Standard output contains a secret-free summary
with credential reference ids, scope metadata, expiry metadata, and booleans
indicating which token classes were received.

For OAuth 2.0 confidential clients, `x-refresh` resolves the refresh token,
client id, and client secret. For OAuth 2.0 public clients, use:

```bash
kiln external-engagement x-refresh \
  --allow-live \
  --public-client \
  --secret-output C:/tmp/kiln-x-oauth2-tokens.json
```

Build feature candidates from an existing evidence report without touching X:

```bash
kiln external-engagement x-candidates \
  --report ./.kiln/external-engagement/x-report.json \
  --output ./.kiln/external-engagement/x-candidates.json
```

`x-candidates` is an offline transformation. It reads a prior `x-report`,
extracts conservative community signals when the report does not already
contain signals, and produces feature candidates with source signal kinds,
themes, evidence artifact ids, recommendation, confidence, and
engineering-standards assessment. Signals are grouped by theme and each
evidence artifact contributes to at most two signal groups to avoid noisy
candidate fan-out. It does not resolve credentials or call external APIs.

Build a review-friendly Markdown report from candidates:

```bash
kiln external-engagement x-review \
  --candidates ./.kiln/external-engagement/x-candidates.json \
  --output ./.kiln/external-engagement/x-review.md
```

`x-review` is also offline. The default Markdown review includes candidate
title, recommendation, confidence, evidence artifact ids, themes, and review
prompts. It does not include full artifact text by default, so private source
details stay in the underlying evidence report unless the operator explicitly
chooses to disclose them.

Record operator decisions against reviewed candidates:

```bash
kiln external-engagement x-decide \
  --candidates ./.kiln/external-engagement/x-candidates.json \
  --decisions ./.kiln/external-engagement/x-decisions-input.json \
  --output ./.kiln/external-engagement/x-decisions.json
```

The decisions input is JSON:

```json
{
  "decisions": [
    {
      "candidateId": "candidate-workflow-controls",
      "decision": "narrow",
      "evidenceArtifactIds": ["1000000000000000001"],
      "reason": "Useful public workflow, but the first implementation should only cover offline intake.",
      "narrowedScope": "Offline intake only."
    }
  ]
}
```

`x-decide` is offline and provider-neutral. It validates that every decision
references an existing candidate and only evidence artifact ids already present
on that candidate. `accept`, `reject`, and `narrow` decisions require a reason;
`narrow` also requires `narrowedScope`. The resulting decision report stores
candidate ids, titles, themes, evidence artifact ids, and operator reasoning.
It does not copy full source text, author handles, or source URLs.

Promote accepted or narrowed decisions into provider-neutral feature intake:

```bash
kiln external-engagement x-promote \
  --decisions ./.kiln/external-engagement/x-decisions.json
```

Without `--output`, `x-promote` writes to
`.kiln/external-engagement/feature-intake.json` under the current workspace.
Use `--workspace-dir` when running from another directory, or `--output` for an
explicit destination.

`x-promote` only promotes `accept` and `narrow` decisions. `defer` and `reject`
remain in the decision report but do not become feature-intake proposals. The
intake report contains candidate ids, titles, themes, evidence artifact ids,
operator reason, scope, and the architecture boundary. It is the handoff point
for implementation planning; it still does not grant write-capable engagement
authority.

Input files are newline-delimited and may contain X URLs or post ids:

```text
https://x.com/example_author/status/1000000000000000001
1000000000000000002
```

## Credentials

The CLI resolves credentials through Kiln's provider-agnostic `SecretRef`
boundary. X search and report reads use the same reusable
`x-oauth2-access-token` reference with purpose `external-engagement:x:read` and
scopes `x:post.read` and `x:user.read`. The current CLI adapter resolves that
reference through an env-backed secret source for an OAuth 2.0 access token:

```text
KILN_X_OAUTH2_ACCESS_TOKEN
```

The X OAuth 2.0 refresh command resolves these additional default references:

```text
KILN_X_OAUTH2_REFRESH_TOKEN
KILN_X_CLIENT_ID
KILN_X_CLIENT_SECRET
```

Override the refresh variable names when needed:

```bash
kiln external-engagement x-refresh \
  --allow-live \
  --secret-output C:/tmp/kiln-x-oauth2-tokens.json \
  --refresh-token-env MY_X_REFRESH_TOKEN \
  --client-id-env MY_X_CLIENT_ID \
  --client-secret-env MY_X_CLIENT_SECRET
```

Override the variable name when needed:

```bash
kiln external-engagement x-report \
  --input ./x-sources.txt \
  --access-token-env MY_X_ACCESS_TOKEN
```

The same override works for search:

```bash
kiln external-engagement x-search \
  --query "#mcp" \
  --access-token-env MY_X_ACCESS_TOKEN
```

Do not commit tokens, refresh tokens, API keys, API secrets, screenshots of
credentials, or real operator research source lists.

Credential diagnostics are secret-free. They may show the reference id, purpose,
scopes, source env var name, availability status, and lifecycle status, but
never the resolved token value.

If credential lifecycle metadata says the access token is expired, refresh-due,
or rotation-due, the command fails before X network access. Refresh execution is
not part of the read-only report command. It is a separate operator-approved
command because refresh tokens can rotate; operators must persist the returned
token bundle to their selected secret manager after reviewing the secret output
file.

Teams may populate env vars through their preferred secret manager or runtime
platform. Doppler-style env injection is one internal Sequel example, not a
public Kiln assumption or dependency.

The underlying `SecretRef` contract also supports provider-neutral managed
secret-manager references and runtime credential-pool references for future
integrations. The X pilot keeps the CLI surface env-backed because that is the
smallest explicit operator-controlled source for read-only evidence reports.

## Cost Controls

X API reads are metered through X's pay-per-use credit model. Treat external
platform API access as a paid external resource.

The report budget is computed before network access from:

- root post count;
- maximum replies per root post;
- author metadata reads;
- expected request batches.

The search budget is computed before credential resolution from:

- one bounded recent-search request;
- maximum discovered root posts;
- maximum reply searches, capped by root posts and `--max-replies`;
- maximum reply reads;
- author metadata reads;
- optional `--max-requests`.

Keep early runs small. Use `--dry-run` first and keep `--max-replies` explicit.
Leave cache enabled for repeated exploration. Use `--refresh-cache` only when
you intentionally want to spend fresh X requests for the same query.
Tests must use synthetic fixtures or mocked fetchers, not live X calls.
Use `x-smoke --allow-live` only when intentionally validating a real X
credential; it is bounded to one request.
Use `x-refresh --allow-live` only when intentionally rotating real OAuth 2.0
credentials; refresh tokens may be replaced by the provider response.
Use `x-candidates` for repeated analysis of an existing report because it is
offline and does not consume X API credits.
Use `x-review` when discussing candidates with operators or maintainers because
it is review-oriented and avoids copying full source text by default.
Use `x-decide` after review to preserve the operator decision without another
provider call.
Use `x-promote` to produce the provider-neutral feature-intake handoff without
another provider call.

## Sampling Limits

External community evidence is useful product input, not a representative
market study by itself. X search samples visible public posts that match the
query and the authenticated account's access. It may overrepresent frequent
posters, highly active threads, emotionally intense comments, platform-native
communities, and people who choose to discuss the topic publicly.

Every search report records sampling limitations so downstream review can
treat the artifact as directional evidence. Use review and decision reports to
separate "this is a real observed signal" from "this represents the whole
market." Validate high-impact product decisions with additional evidence such
as user interviews, support data, usage analytics, direct customer feedback,
or formal research.

## Conversational UX Contract

Users should be able to ask Kiln to explore X posts, a hashtag, or a topic.
The governed translation is a bounded plan, not free browsing:

```text
User request: Explore X posts about #mcp.
Kiln plan: x-search query="#mcp", maxPosts=25, maxReplies=3,
maxRequests=30, scope=recent, cache=enabled.
Operator checkpoint: review budget, sampling limits, credentials, and output
artifact path before live provider access.
```

The model reasons over the resulting evidence, candidate, review, decision, and
intake artifacts. It must not browse X freely or hide raw browsing state inside
the conversation.

## Architecture Boundary

The public feature is governed external engagement. X is only the first
provider.

Current ownership:

- `@kilnai/core`: source-neutral evidence contracts, read-only effect envelope,
  bounded discovery scopes, URL/id normalization, request-budget estimation,
  report construction, conservative signal extraction, feature-candidate
  reporting, candidate decision reporting, provider-neutral feature intake,
  future action proposal/approval/execution contracts, and provider-agnostic
  credential references.
- `@kilnai/cli`: first operator surface, env-backed credential resolver, and X
  REST fetch/search boundary.
- GUI/TUI/SDK: should consume the same provider-neutral reports and future
  runtime events. This slice does not add placeholder UI because the shared
  runtime channel for external-engagement artifacts is not yet the owning
  surface.
- `@kilnai/runtime`: not touched in this slice. A runtime channel or
  write-capable adapter requires a later action-proposal and approval workflow.

This completes the read-only X lifecycle:

1. bounded discovery;
2. external evidence ingestion;
3. candidate extraction;
4. operator review;
5. operator decision;
6. provider-neutral feature intake.

Write-capable engagement uses a separate future contract:

1. external evidence ingestion;
2. action proposal;
3. approval authority from a human, designated agent, or policy;
4. external action execution;
5. audit record.

Approval authority must be explicit and separately modeled. The proposer must
not approve its own external action. Do not merge read authority and write
authority into one adapter.
