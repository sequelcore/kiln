# Claude Model Route Validation, 2026-08-01

## Decision

Kiln admits these exact Claude Code models under the read-only
`foundation-readonly-plan` contract:

| Exact model | Team role | Live result |
| --- | --- | --- |
| `claude-opus-5` | Architecture advisor | Passed |
| `claude-sonnet-5` | Independent reviewer | Passed |
| `claude-haiku-4-5-20251001` | Bounded repository scout | Passed |

The moving aliases `default`, `opus`, `sonnet`, and `haiku` remain rejected.
Claude write authority remains unsupported and fails admission before launch.

These role assignments express current operating intent, not a claim that one
bounded functional proof establishes comparative model quality. Quality,
latency, and cost promotion still require task-specific repeatable evaluation.

## Live Evidence

Each exact model completed the opt-in Claude managed-agent proof with:

- authenticated catalog discovery of the configured exact ID;
- Claude Code plan mode and native structured output;
- the configured model as the SDK-observed primary identity;
- portable executable and version evidence;
- an unchanged fixture and zero accepted-write evidence; and
- no provider-session transcript persistence.

Observed proof durations were approximately 35 seconds for Opus, 41 seconds
for Sonnet, and 31 seconds for Haiku. These single-run timings are diagnostic,
not benchmarks.

The first Opus run also exposed an intermittent durable-evidence defect: the
native structured handoff could repeat the invocation workspace path. Kiln now
redacts that root recursively from all native structured string fields and the
derived summary before validation and persistence. A focused regression test
and a fresh Opus live proof passed after the change.

## Fable Boundary

Fable is deliberately neither configured nor admitted. The intended policy is
stronger than “low priority”: it must never enter automatic selection and must
require an explicit exceptional operator decision.

Kiln cannot enforce that policy today. Admitted routes participate in shared
automatic candidate pools, while `preferredRouteId` identifies a route but
does not prove that a human selected it. A prompt convention, agent profile, or
generic approval tool tag would therefore be advisory rather than an authority
boundary.

Before Fable can be considered, Kiln needs all of the following as executable
runtime contracts:

1. A route selection mode such as `automatic | explicit-route-only`.
2. Exclusion of explicit-only routes from orchestration, repair, catalog
   scoring, economic candidate collection, and every other automatic pool.
3. An exact incoming route ID for explicit-only invocation.
4. Runtime-owned operator approval evidence tied to that invocation and route.
5. Tests proving agent hints and model suitability cannot bypass the boundary.

After that capability exists, the authenticated Claude catalog must be
rediscovered and the exact Fable identity must receive its own bounded live
proof. Discovery observed during this investigation is not durable future
admission evidence.

## Residual Risk

Catalogs, entitlements, aliases, quotas, and native harness behavior can
change. Exact IDs eliminate alias drift but do not eliminate provider drift;
diagnostics and opt-in live proofs remain the promotion evidence when versions
or subscriptions change.
