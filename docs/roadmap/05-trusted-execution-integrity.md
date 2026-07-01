# 05 - Trusted Execution Integrity

Status: Active; Slice 1 complete
Started: 2026-07-01

## Objective

Represent trusted/full-access execution as provider-neutral evidence so Kiln
can distinguish desired policy, native projection, session selection, observed
runtime authority, enforcement capability, and operator authorization without
inventing equivalence across harnesses.

## Goals

- Establish one serialized permission-integrity contract.
- Classify verified, intentional, drifted, mismatched, unproven, unsupported,
  dangerous, stale, partial, and failed observations deterministically.
- Keep trusted authority operator-local, explicit, auditable, and revocable.
- Make native projection, managed execution, doctor, CLI, GUI, and TUI consume
  the same canonical evidence in later slices.

## Scope

Five independently verified slices own the contract/domain model, harness
adapters and projection, managed-agent authority, shared operator surfaces,
and durable documentation/roadmap closure. Exact file ownership and gates are
defined in `docs/plan.md`.

## Non-Goals

- No UI selection, model statement, stale observation, or native setting is
  accepted as runtime proof.
- No repository configuration may authorize or broaden personal authority.
- No OpenCode permission rule is represented as sandbox enforcement.
- No doctor repair, silent native overwrite, duplicate surface policy, dead
  code, legacy hack, or unsupported compatibility shim is admitted.

## Research Basis

The design is gated on current first-party harness documentation, available
local harness source, repository observations, and clearly separated community
reports and inference. Kiln terminology remains provider-neutral.

## Delivery Slices

1. **Complete - contract and evidence taxonomy.** Slice 1 defines the
   serialized contract, classification precedence, freshness/proof invariants,
   capability honesty, operator-local authorization boundary, finite
   Core/Gateway vocabulary parity, and current-verified rejection for stale,
   unknown, UI-only, or mismatched evidence.
2. **Next - harness adapters and native projection.** Translate Codex,
   Claude Code, and OpenCode semantics with explicit loss evidence while
   preserving unmanaged fields and idempotency.
3. **Pending - runtime and managed agents.** Record requested, projected, and
   observed child authority and fail closed for unproven unattended execution.
4. **Pending - doctor and shared surfaces.** Project one read-only status
   contract through CLI, GUI, TUI, setup, Gateway, and model-callable reads.
5. **Pending - canonical documentation and closure.** Promote durable doctrine,
   record verification and reviews, then remove this active roadmap.

## Promotion Gates

Each behavioral slice requires intentional red tests, focused and package
green tests, typecheck, independent review, and an atomic commit. Blocking
architecture, security, projection, managed-agent, quality, or adversarial
findings must be resolved before promotion.

## Verification

Slice 1 red commands:

```bash
bun run --cwd packages/gateway-contracts test -- tests/config-status.test.ts
bun run --cwd packages/core test -- tests/security/trusted-execution-integrity.test.ts
```

Slice 1 closeout on 2026-07-01:

```bash
bun run --cwd packages/gateway-contracts test -- tests/config-status.test.ts
bun run --cwd packages/core test -- tests/security/trusted-execution-integrity.test.ts
bun run --cwd packages/cli test -- tests/config/trusted-execution-contract-parity.test.ts
bun run --filter @kilnai/gateway-contracts test
bun run --filter @kilnai/core test
bun run --filter @kilnai/cli test -- tests/config/trusted-execution-contract-parity.test.ts
bun run typecheck
git diff --check
```

Independent Slice 1 review found and verified closure of three blockers:
Gateway no longer serializes `current-verified` with stale or unknown optional
evidence, Gateway no longer serializes `current-verified` with persisted native
policy mismatch, and Core no longer treats UI-selected desired evidence as
current verified.

Final closure requires the canonical workspace test, typecheck, build, GUI E2E,
projection consistency, stale-reference scan, `git diff --check`, and a clean
worktree. Credentialed live probes require separate operator authorization.

## Completion Criteria

All five slices are committed and verified; every surface consumes the shared
contract; harness limitations and unobservable runtime states remain explicit;
durable decisions are promoted to canonical documentation; roadmap references
are current; and no unrelated pre-existing changes are included.
