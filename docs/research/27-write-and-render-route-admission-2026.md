# Write and Render Route Admission

Date: 2026-08-01

## Decision

Kiln admits `opencode-go/glm-5.2` as its only managed write worker from this
evaluation. It passed all five backend repetitions under the bounded write
profile. The admitted routes require approval before apply, disable network
access, and expose no shell.

No OpenCode frontend model is admitted for writes. Kimi K2.7 Code, Kimi K3,
GLM 5.2, and Qwen3.7 Max all failed the live render gate in different ways.
They remain read-only candidates where an existing consumer needs them.

DeepSeek V4 Pro and Kimi K2.7 Code remain read-only backend challengers. Each
passed four of five backend repetitions and failed the reservation contract
once. That is useful capability evidence, but it does not satisfy Kiln's
strict pass^5 admission rule.

Codex OAuth Terra was not scored. The top-level benchmark path reached Kiln's
intentional pooled-credential guard because four executable Codex credentials
exist and this benchmark does not yet lease a configured virtual model. The
failure is a benchmark capability gap, not model evidence. The former Terra
write route was removed until the exact leased route can be evaluated.

## Profiles and Authority

The new profiles are:

- `kiln-model-roster-backend-write` version 1;
- `kiln-model-roster-frontend-render` version 1.

Both copy only a versioned synthetic fixture into an OS-temporary lease. They
reject symlinks and non-files, hash the canonical fixture, snapshot the lease,
record exact changed paths and hashes, verify that the canonical fixture did
not change, and remove the lease in `finally`.

The model receives only these executable tools:

`read`, `read_many`, `grep`, `glob`, `tree`, `stat`, `write`, `edit`, `patch`.

The per-call sandbox grants read/write access only to the lease and grants no
network access. Strict projection also filters runtime-attached tools, so an
operator tool cannot reappear after the core allowlist is built. A regression
test proves that an absolute same-prefix sibling path is denied.

Dataset metadata cannot claim verifier output, workspace changes, fixture
hashes, or benchmark context kind. Those fields are executor-owned evidence.

## Backend Verification

The backend fixture asks the model to implement an idempotent stock reservation
contract in one file. The out-of-process verifier runs four hidden behavior
tests in this exact image:

`node:24.15.0-alpine@sha256:d1b3b4da11eefd5941e7f0b9cf17783fc99d9c6fc34884a665f40a06dbdfc94f`

The container has no network, a read-only root filesystem, dropped
capabilities, `no-new-privileges`, bounded processes/CPU/memory, a read-only
lease mount, and a read-only hidden-test mount. Node's Permission Model is an
additional seatbelt, not the security boundary. The Docker isolation and
allowed-diff check are the security boundary.

Only `src/order-service.mjs` may change. Quality credit requires both hidden
tests and exact diff integrity.

| Exact route | Correct runs | pass^5 | Median duration | Decision |
| --- | ---: | ---: | ---: | --- |
| `opencode-go/glm-5.2` | 5/5 | 1.00 | 6.8 s | Admit as the sole backend writer. |
| `opencode-go/deepseek-v4-pro` | 4/5 | 0.00 | 23.8 s | Read-only challenger; one run omitted required `remaining` output. |
| `opencode-go/kimi-k2.7-code` | 4/5 | 0.00 | 10.4 s | Read-only challenger; one run failed a hidden contract test. |

The profile records pass^5, not the arithmetic success fraction. One failed
repetition therefore makes the admission result zero. This is deliberate for
write authority.

During screening, the trajectory scorer incorrectly treated a read after a
mutation as a redundant exact call. That was repaired: `write`, `edit`, or
`patch` invalidates earlier read-state observations. The scorer still rejects
forbidden tools, truly duplicate reads without an intervening mutation, and
tool-budget violations.

## Frontend Verification

The frontend fixture asks the model to repair one React component. Verification
runs in a locally built image whose complete verifier inputs are locked by
source digest:

- base: `mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e`;
- admitted local verifier image ID: `sha256:dbac9bef7a818c11a1c1e0602504481b5692c2a7c635203f6559fb870dd615f4`;
- Playwright 1.62.1;
- axe-core and `@axe-core/playwright` 4.12.1;
- React and React DOM 19.2.8;
- esbuild 0.28.1;
- verifier source digest `sha256:79717a4c691b4c926e98c1e0d8ceafe6d578a5ecf5f8ec04362c202ec1db6336`.

Kiln builds this local artifact with BuildKit provenance and SBOM attestations
disabled so identical locked inputs produce the same manifest ID. It inspects
the human-readable tag but executes the admitted image by that exact image ID.
A rebuild with different bytes fails preparation even if its labels claim the
same source/version.

The verifier bundles only the trusted bootstrap and candidate component, runs
Chromium inside the same network-disabled container, blocks non-loopback
requests, fixes viewport and reduced motion, and checks:

1. heading and table accessible names;
2. native keyboard activation;
3. modal accessible name;
4. initial focus;
5. Tab and Shift+Tab focus trapping;
6. Escape dismissal;
7. focus restoration;
8. zero automated WCAG A/AA violations;
9. screenshot hash and bytes;
10. exact one-file diff integrity.

| Exact route | Result | Observed failure | Decision |
| --- | --- | --- | --- |
| `opencode-go/kimi-k2.7-code` | 0/1 | Reasoned until response exhaustion and never mutated the component. | No write route. |
| `opencode-go/glm-5.2` | 0/1 | Mutated the component, but Tab did not move focus to Cancel; it also exceeded the tool budget. | No write route. |
| `opencode-go/kimi-k3` | 0/1 | Passed the earlier browser checks but did not restore focus to the trigger. | No write route. |
| `opencode-go/qwen3.7-max` | no result | Exceeded the 240 s bounded execution timeout before producing evidence. | No write route. |
| `codex-oauth/gpt-5.6-terra` | not scored | Preflight rejected unbound multi-credential pool access. | Re-evaluate only through virtual-model leasing. |

Automated accessibility checks do not replace manual visual and assistive-
technology review. They are a deterministic admission floor for this fixture.

## Effective Team After Closeout

- Codex Sol: configured architecture escalation/advisor candidate; no new write
  authority from this evaluation.
- Codex Terra: read-only reasoning and planning through the leased managed
  route; write evaluation pending benchmark virtual-model support.
- Codex Auto Review: independent read-only review.
- Claude Opus 5, Sonnet 5, and Haiku 4.5: exact-ID, read-only plan harness
  routes for advisor, reviewer, and scout work respectively. Fable is not
  configured because Kiln cannot yet enforce operator-only exceptional route
  selection.
- GLM 5.2: OpenCode architecture/research candidate and the only admitted
  approved-write worker.
- Kimi K3 and Kimi K2.7 Code: read-only frontend challengers.
- DeepSeek V4 Pro and Kimi K2.7 Code: read-only backend challengers.
- Qwen3.7 Max: read-only source-grounded research challenger.

This topology intentionally leaves frontend write work without a specialist.
Until a model passes the render profile repeatedly, frontend changes must be
performed by an operator-authorized route outside that unproven specialist
assignment and verified by the normal Sequel gates.

## Configuration Closeout

The canonical global config now exposes only:

- `opencode-go-critical-approved-write`;
- `opencode-go-service-approved-write`.

Both resolve to `opencode-go/glm-5.2`, require approval before apply, use
runtime-selected account policy `managed-opencode-glm-5-2`, disable network,
and allow only bounded filesystem tools. The previous Terra, Kimi frontend,
DeepSeek backend, and Qwen research write routes were deleted rather than kept
as compatibility or provisional paths.

## Re-admission Requirements

- Frontend: pass a smoke, then pass all five render repetitions under the same
  pinned verifier and strict authority.
- Codex: add benchmark execution through configured virtual-model leasing;
  prove route/model/account evidence; then run the same k=5 profiles.
- Backend challengers: use a new versioned fixture or materially expanded
  dataset before rerunning, to reduce overfitting to this one contract.
- Any provider/catalog change: rediscover exact model identity, data terms,
  retention, quotas, and adapter capability before comparing old evidence.

## Primary References

- Node.js Permission Model: https://nodejs.org/docs/latest-v24.x/api/permissions.html
- Playwright accessibility testing: https://playwright.dev/docs/accessibility-testing
- axe-core releases and rules engine: https://github.com/dequelabs/axe-core
- Docker runtime security options: https://docs.docker.com/engine/containers/run/
