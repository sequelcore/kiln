# 09 - Rust Optimization Guardrail

Status: Guardrail
Execution: Guardrail - no implementation without a module-specific ADR, parity contract, and benchmark.
Created: 2026-05-17

## Objective

Define when Rust, WASM, N-API, or sidecars may accelerate an approved Kiln hot
path without creating a second runtime, schema, policy engine, or operator
truth. Bun/TypeScript and Rust are both selected for their strengths: Bun owns
orchestration and contracts; Rust owns approved compute/native kernels that
consume and produce those same contracts.

## Goals

- Keep Bun/TypeScript as the Kiln control plane.
- Admit Rust, WASM, or sidecar modules only through measured, approved
  hot-path slices.
- Preserve shared contracts, deterministic parity, and TypeScript-owned
  semantic references.
- Prevent native helpers from becoming duplicate policy, routing, authority,
  or surface owners.

## Principle

Bun/TypeScript owns control-plane semantics because Kiln's runtime, gateway,
contracts, tests, and surfaces already encode that policy. Rust may accelerate
measured native or CPU-heavy paths only when it removes real latency or
unlocks native capability without duplicating policy. No redundancy, no
parallel truth, no private surface semantics. Rust may be a kernel, helper, or
packaging substrate; it must not become a second Kiln.

## Ownership

Bun/TypeScript retains control-plane semantics, routing, authority, memory,
configuration, Agent Tasks, approvals, gateway contracts, and surfaces. Native
modules may implement narrow replaceable kernels behind TypeScript-owned ports.

Bun/TypeScript remains the owner for: runtime policy and orchestration;
provider routing and model selection; authority, permission, and approval
gates; managed-agent route admission and write evidence; memory, config,
work-governance, and closeout semantics; gateway HTTP/WebSocket contracts;
GUI, TUI, CLI, SDK, widget, and native-surface integration; test-first
contract evolution; cross-surface projection contracts in
`@kilnai/gateway-contracts`.

[Roadmap 06.5](06.5-end-to-end-harness-efficiency.md) owns task-level latency
and cost attribution. This track admits or rejects native acceleration only
after that evidence identifies a bounded hot path; it does not own the general
performance roadmap or its benchmark results.

Rust, WASM, or sidecars may be used for: packaged local launcher or native
helper binaries; high-density event presentation/projection; replay indexes
and cursor maps; timeline, session, invocation, tool, cost, and provider
summary hot paths; OS-specific helpers where Bun/TypeScript cannot provide
reliable access; sandbox or process-supervision helpers if separately
approved. Rust candidates must consume canonical contract-shaped data and
return canonical contract-shaped output, and must be replaceable by the
TypeScript implementation without changing runtime semantics.

## Scope

- Admission and promotion gates for measured native helpers or compute
  kernels.
- TypeScript reference behavior, deterministic parity, fallback, and
  packaging evidence.
- Transport selection only after current hot-path and bridge-cost
  measurement.
- The TypeScript-owned port rule for any native helper or kernel.

## Non-Goals

- No generic Rust readiness command or retained spike package.
- No Rust ownership of routing, authority, permissions, goals, work items,
  approvals, or UI state.
- No transport choice by fashion or theoretical throughput.
- No native operator-surface implementation in this track.
- No WASM, sidecar, or TypeScript/Rust bridge outside an approved module
  slice.

## Forbidden Rust Ownership

Rust, WASM, or sidecars must not own: authority decisions; provider or model
routing decisions; tool admission decisions; memory mutation decisions;
config mutation decisions; managed-agent policy; goal or work-item lifecycle
policy; approval lifecycle truth; benchmark-only prompt paths or private
schemas; surface-specific state that should remain a shared contract; native
absence or failure behavior that changes operator semantics.

## Admission Sequence

1. A product roadmap or ADR identifies one concrete hot path and real consumer.
2. Straightforward TypeScript cleanup is measured first.
3. A TypeScript-owned port defines inputs, outputs, order, errors, and fallback.
4. Approved fixtures establish semantic parity.
5. Candidate transport overhead and cross-platform distribution are measured.
6. Promotion occurs only for material latency, memory, or OS-capability advantage.
7. Dead spike code is deleted or converted atomically.

## Candidate Boundaries

Potential consumers include high-density presentation/replay projections and
separately approved OS helpers. Startup discovery and provider readiness remain
TypeScript/I/O concerns unless an OS capability proves otherwise.

Local measurements on 2026-05-17 separate startup and projection concerns
(historical artifacts at `.kiln/benchmarks/rust-readiness-2026-05-17.json` and
its CPU/heap profiles):

| Path | Mean wall time | Decision signal |
| --- | ---: | --- |
| GUI startup to banner | 4376ms | Startup is blocked by pre-surface discovery/setup, not a Rust target. |
| Managed-agent provider discovery | 3547ms | I/O/process problem; not the first Rust target. |
| 100k event presentation | 2841ms mean, 2933ms p95 | CPU hot path; profile is dominated by native `format`/`NumberFormat`, so TypeScript cleanup evidence comes before Rust implementation. |
| 100k read-only operator projection | 3477ms mean, 3490ms p95 | CPU and allocation hot path; Rust/WASM implementation evidence belongs here after the TypeScript reference is cleaned up. |
| 100k view-state filtering | 7.3ms mean, 8.2ms p95 | Filtering alone does not justify Rust. |

The completed near-term startup work is now canonicalized in architecture and
guide docs. Rust kernel implementation starts in projection/replay only after
parity and measured advantage are proven. Startup latency and projection
latency are separate decisions: startup discovery and provider readiness must
be fixed in the Bun/TypeScript owner unless an approved native helper is
required for an OS capability.

## Evidence Still Missing

Rust is selected for native/hot-path work, but the transport and package shape
remain evidence-driven. Before choosing WASM, N-API, sidecar, or another Rust
integration path, collect:

- TypeScript cleanup evidence for the exact Rust target hot path on repo HEAD.
- A proven bottleneck that remains after straightforward TypeScript cleanup.
- IPC/bridge overhead for each candidate transport under the same input size.
- Cross-platform build/distribution cost for Windows, macOS, and Linux.
- Output parity against canonical `@kilnai/gateway-contracts` fixtures through
  the approved module parity harness.
- Failure behavior proving Rust absence or crash falls back to the TypeScript
  reference without changing operator semantics.
- A deletion/conversion plan for any external spike code before production
  promotion.

Until that evidence exists, Rust remains staged behind the TypeScript-owned
port and outside runtime/surface packages.

### Decision at 2026-08-30

The completed Runtime-ownership and CLI-startup investigation admits no Rust,
WASM, N-API, or sidecar implementation. It measures fresh-process startup and
static loading reachability but has no runtime trace that attributes latency to
a local CPU path; its deterministic long-turn fixture is a correctness audit,
not a CPU profile. No local deterministic kernel on repository HEAD is shown to
account for both 25% and 100ms of product p95 after direct TypeScript cleanup.
The benchmark evidence is internal-decision-ready only for the bounded
TypeScript CLI composition decision. Rust therefore remains gated until a
module-specific roadmap or ADR supplies the missing hot-path, parity,
bridge-cost, fallback, and cross-platform evidence below.

## Research Basis

- Bun is an all-in-one JavaScript/TypeScript runtime/toolkit with fast startup,
  built-in TypeScript execution, package management, tests, and bundling —
  this supports keeping Kiln orchestration, contracts, and surface integration
  in Bun/TypeScript.
- Bun's Node-API support is the stable production path for native add-ons;
  `bun:ffi` is documented as experimental and must not be the production
  bridge for Kiln hot paths.
- Rust is a strong fit for reliable, efficient, memory-safe compute kernels
  and native helpers.
- WebAssembly is the least invasive first decision path for pure compute
  kernels — it keeps the boundary narrow and suits code compiled from
  languages like Rust into a portable module.
- N-API/NAPI-RS is the production path only after a proof shows WASM or
  TypeScript is insufficient; ABI stability reduces runtime churn but
  increases packaging and release complexity.
- Sidecars are appropriate for OS capability helpers and crash isolation, not
  tight projection loops unless IPC overhead is proven acceptable.
- CLI subprocesses are acceptable for manual spikes or one-shot tools, not
  steady-state hot paths.

Implementation rule: prove the hot path in TypeScript first, then prove bridge
cost, then select the Rust transport. Do not select Rust transport by fashion
or theoretical throughput alone. Do not add a generic Rust readiness benchmark
command — future evidence must be owned by the specific Rust module slice.

## Promotion Gates

A Rust/WASM/sidecar module may be promoted only when all are true:

- Canonical contract-shaped input and output.
- Deterministic parity across supported platforms.
- Native absence/crash preserves TypeScript semantics.
- Material measured advantage after TypeScript cleanup.
- Cross-platform build and release cost is accepted.
- Rust hot-path evidence includes an accepted parity report from the approved
  TypeScript-owned port for that module.
- The owning roadmap states how the TypeScript implementation remains
  available as the semantic reference, fallback path, or removable baseline
  after promotion.
- No forbidden ownership boundary is crossed.
- Focused parity tests, typecheck, build, benchmark, and review pass.

## Verification

This document is a decision boundary and requires `git diff --check`. Any
admitted module supplies its own fixtures, benchmarks, parity tests, fallback
proof, and release verification in the owning roadmap or ADR.

## Completion Criteria

The boundary remains explicit and future native work can be admitted or
rejected without duplicate control planes or retained speculative code.
Architecture and roadmap docs clearly distinguish Bun control-plane ownership
from Rust hot-path/native-helper ownership, future implementers can identify
which Rust slices are allowed, forbidden, or require escalation, and no
duplicate projection models or policy engines are introduced.
