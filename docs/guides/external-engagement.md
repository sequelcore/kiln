# Governed External Engagement

Governed external engagement is the Kiln surface for working with external
platforms without giving agents uncontrolled authority. The first supported
slice is read-only X evidence reporting through the CLI.

This is not social posting automation. Read, draft, approval, and execution are
separate phases with separate authority.

## Phase 1 Scope

The phase 1 X path can:

- accept X post URLs or post ids from the operator;
- deduplicate root post references;
- estimate the maximum read budget before network access;
- fetch root posts and a bounded number of replies;
- write a structured JSON evidence report;
- preserve source URLs, platform ids, author metadata, metrics, and retrieval
  evidence when available.

The phase 1 X path cannot:

- publish posts;
- reply;
- like;
- repost;
- follow accounts;
- read or send DMs;
- refresh OAuth tokens;
- run unbounded timeline, search, or reply loops.

## CLI

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

`x-report` caches successful reports by default under:

```text
.kiln/cache/external-engagement/x-report
```

The cache key is based on X post ids and `--max-replies`, not raw source URLs.
Use these flags when needed:

```bash
kiln external-engagement x-report --input ./x-sources.txt --no-cache
kiln external-engagement x-report --input ./x-sources.txt --refresh-cache
kiln external-engagement x-report --input ./x-sources.txt --cache-dir C:/tmp/kiln-x-cache
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

Input files are newline-delimited and may contain X URLs or post ids:

```text
https://x.com/example_author/status/1000000000000000001
1000000000000000002
```

## Credentials

The CLI resolves credentials through Kiln's provider-agnostic `SecretRef`
boundary. X read access is declared by a reusable `x-oauth2-access-token`
reference with purpose `external-engagement:x:read` and scopes `x:post.read`
and `x:user.read`. The current X report adapter resolves that reference through
an env-backed secret source for an OAuth 2.0 access token:

```text
KILN_X_OAUTH2_ACCESS_TOKEN
```

Override the variable name when needed:

```bash
kiln external-engagement x-report \
  --input ./x-sources.txt \
  --access-token-env MY_X_ACCESS_TOKEN
```

Do not commit tokens, refresh tokens, API keys, API secrets, screenshots of
credentials, or real operator research source lists.

Credential diagnostics are secret-free. They may show the reference id, purpose,
scopes, source env var name, availability status, and lifecycle status, but
never the resolved token value.

If credential lifecycle metadata says the access token is expired, refresh-due,
or rotation-due, the command fails before X network access. Refresh execution is
not part of the read-only report command; it belongs behind a resolver or
runtime adapter.

Teams may populate env vars through their preferred secret manager or runtime
platform. Doppler-style env injection is one internal Sequel example, not a
public Kiln assumption or dependency.

The underlying `SecretRef` contract also supports provider-neutral managed
secret-manager references and runtime credential-pool references for future
integrations. The X pilot keeps the CLI surface env-backed because that is the
smallest explicit operator-controlled source for read-only evidence reports.

## Cost Controls

X API reads are metered. Treat external platform API access as a paid external
resource.

The report budget is computed before network access from:

- root post count;
- maximum replies per root post;
- author metadata reads;
- expected request batches.

Keep early runs small. Use `--dry-run` first and keep `--max-replies` explicit.
Leave cache enabled for repeated exploration. Use `--refresh-cache` only when
you intentionally want to spend fresh X requests for the same query.
Tests must use synthetic fixtures or mocked fetchers, not live X calls.
Use `x-smoke --allow-live` only when intentionally validating a real X
credential; it is bounded to one request.

## Architecture Boundary

The public feature is governed external engagement. X is only the first
provider.

Current ownership:

- `@kilnai/core`: source-neutral evidence contracts, read-only effect envelope,
  URL/id normalization, request-budget estimation, report construction, and
  provider-agnostic credential references.
- `@kilnai/cli`: first operator surface, env-backed credential resolver, and X
  REST fetch boundary.
- `@kilnai/runtime`: not touched in phase 1. A runtime channel or write-capable
  adapter requires a later action-proposal and approval workflow.

Write-capable engagement must use a separate future contract:

1. external evidence ingestion;
2. action proposal;
3. human approval;
4. external action execution;
5. audit record.

Do not merge read authority and write authority into one adapter.
