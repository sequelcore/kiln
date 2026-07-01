# 00 - Rust Module Optimization

Status: Active Rust optimization boundary
Created: 2026-05-17

This track owns staged Rust, WASM, and sidecar optimization for Kiln modules.
It is separate from the native operator surface roadmap. The product direction
is to keep Bun/TypeScript as the control plane and use Rust for measured native
helpers or hot paths where it provides real advantage. This roadmap is the
decision boundary only: no Rust proof harness, readiness command, bridge, or
implementation package is kept in the repo until an approved module slice or ADR
defines the production shape and parity gate.

## Objective

Define how Rust is introduced for module optimization without creating a second
runtime, private schemas, or duplicate policy engines. Bun/TypeScript and Rust
are both selected for their strengths: Bun owns orchestration and contracts;
Rust owns approved compute/native kernels that consume and produce those same
contracts.

## Goals

- Keep Bun/TypeScript as the Kiln control plane.
- Admit Rust, WASM, or sidecar modules only through measured, approved hot-path
  slices.
- Preserve shared contracts, deterministic parity, and TypeScript-owned
  semantic references.
- Prevent native helpers from becoming duplicate policy, routing, authority, or
  surface owners.

## Principle

Bun/TypeScript owns control-plane semantics because Kiln's runtime, gateway,
contracts, tests, and surfaces already encode that policy. Rust may accelerate
measured native or CPU-heavy paths only when it removes real latency or unlocks
native capability without duplicating policy.

No redundancy, no parallel truth, no private surface semantics. Rust may be a
kernel, helper, or packaging substrate; it must not become a second Kiln.

## Sequel Standards

- No parallel control plane or private schema.
- No dead spike code retained after a decision.
- No native optimization without current benchmark evidence.
- No promotion without parity tests, typecheck, build, benchmark evidence, and
  review.

## Bun/TypeScript Responsibilities

Bun/TypeScript remains the owner for:

- runtime policy and orchestration
- provider routing and model selection
- authority, permission, and approval gates
- managed-agent route admission and write evidence
- memory, config, work-governance, and closeout semantics
- gateway HTTP/WebSocket contracts
- GUI, TUI, CLI, SDK, widget, and native-surface integration
- test-first contract evolution
- cross-surface projection contracts in `@kilnai/gateway-contracts`

## Rust/WASM/Sidecar Responsibilities

Rust, WASM, or sidecars may be used for:

- packaged local launcher or native helper binaries
- high-density event presentation/projection
- replay indexes and cursor maps
- timeline, session, invocation, tool, cost, and provider summary hot paths
- OS-specific helpers where Bun/TypeScript cannot provide reliable access
- sandbox or process-supervision helpers if separately approved

Rust candidates must consume canonical contract-shaped data and return
canonical contract-shaped output. They must be replaceable by the TypeScript
implementation without changing runtime semantics.

Candidate code must enter through a narrow port owned by the Bun/TypeScript
control plane. The port contract must define input shape, output shape,
deterministic ordering, failure semantics, and TypeScript reference behavior before
any native implementation is admitted.

## Forbidden Rust Ownership

Rust, WASM, or sidecars must not own:

- authority decisions
- provider or model routing decisions
- tool admission decisions
- memory mutation decisions
- config mutation decisions
- managed-agent policy
- goal or work-item lifecycle policy
- approval lifecycle truth
- benchmark-only prompt paths or private schemas
- surface-specific state that should remain a shared contract
- native absence or failure behavior that changes operator semantics

## Current Target Evidence

Local measurements on 2026-05-17 separate startup and projection concerns.
Historical local benchmark artifacts were written to
`.kiln/benchmarks/rust-readiness-2026-05-17.json`, with CPU profile output at
`.kiln/benchmarks/profiles/rust-readiness-2026-05-17.cpuprofile.md` and heap
profile output at
`.kiln/benchmarks/profiles/rust-readiness-2026-05-17.heapsnapshot`.

| Path | Mean wall time | Decision signal |
| --- | ---: | --- |
| GUI startup to banner | 4376ms | Startup is blocked by pre-surface discovery/setup. |
| Managed-agent provider discovery | 3547ms | I/O/process problem; this is not the first Rust target. |
| 100k event presentation | 2841ms mean, 2933ms p95 | CPU hot path; profile is dominated by native `format`/`NumberFormat`, so TypeScript cleanup evidence comes before Rust implementation. |
| 100k read-only operator projection | 3477ms mean, 3490ms p95 | CPU and allocation hot path; Rust/WASM implementation evidence belongs here after the TypeScript reference is cleaned up. |
| 100k view-state filtering | 7.3ms mean, 8.2ms p95 | Filtering alone does not justify Rust. |

The completed near-term startup work is now canonicalized in architecture and
guide docs. Rust kernel implementation starts in projection/replay only after
parity and measured advantage are proven.

Startup latency and projection latency are separate decisions. Startup discovery
and provider readiness must be fixed in the Bun/TypeScript owner unless an
approved native helper is required for an OS capability. Projection/replay work
may justify a Rust module only after the shared TypeScript projection is already
the accepted baseline.

## Scope

- Document the Bun/Rust responsibility split for module optimization.
- Define required parity evidence for Rust module candidates.
- Define promotion gates before Rust can enter runtime, surface, or packaging paths.
- Define the TypeScript-owned port rule for any native helper or kernel.
- Keep native operator surface work in its own roadmap.

## Non-Goals

- No promoted production Rust implementation in this boundary slice.
- No Rust ownership of runtime, policy, routing, authority, memory, config,
  managed agents, approval, gateway attach, dispatch, or native UI.
- No WASM, sidecar, or TypeScript/Rust bridge.
- No native operator surface implementation or promotion.
- No runtime ownership change.

## Promotion Gates

A Rust/WASM/sidecar module may be promoted only when all are true:

- the owning roadmap or ADR approves implementation scope
- the owning Bun/TypeScript port contract is documented
- TypeScript baseline fixtures are approved
- output parity is proven against canonical `@kilnai/gateway-contracts`
  projections
- ordering is deterministic across runs and platforms
- native absence or failure preserves the same operator semantics as the
  TypeScript reference behavior
- measured latency or memory advantage is material
- Rust hot-path evidence includes an accepted parity report from the approved
  TypeScript-owned port for that module
- the owning roadmap states how the TypeScript implementation remains available
  as the semantic reference, fallback path, or removable baseline after promotion
- no forbidden ownership boundary is crossed
- tests, typecheck, benchmark evidence, and review pass

## Implementation Evidence Still Missing

Rust is selected for native/hot-path work, but the transport and package shape
are still evidence-driven. The remaining evidence must be collected before
choosing WASM, N-API, sidecar, or another Rust integration path:

- TypeScript cleanup evidence for the exact Rust target hot path on repo HEAD;
  current CPU evidence shows expensive presentation formatting before any Rust
  bridge has been tested
- a proven bottleneck that remains after straightforward TypeScript cleanup
- IPC/bridge overhead for each candidate transport under the same input size
- cross-platform build/distribution cost for Windows, macOS, and Linux
- output parity against canonical `@kilnai/gateway-contracts` fixtures through
  the approved module parity harness
- failure behavior proving Rust absence or crash falls back to the TypeScript
  reference without changing operator semantics
- a deletion/conversion plan for any external spike code before production
  promotion

Until that evidence exists, Rust remains staged behind the TypeScript-owned
port and outside runtime/surface packages.

## Research Basis

Reviewed on 2026-05-17 from current official sources:

- Bun is an all-in-one JavaScript/TypeScript runtime/toolkit with fast startup,
  built-in TypeScript execution, package management, tests, and bundling. This
  supports keeping Kiln orchestration, contracts, and surface integration in
  Bun/TypeScript.
- Bun's Node-API support is the stable production path for native add-ons. Bun
  documents broad Node-API compatibility and direct loading of `.node` modules.
- Bun's `bun:ffi` can be fast and useful for local native experiments, but Bun
  documents it as experimental and says it should not be relied on in
  production. It must not be the production bridge for Kiln hot paths.
- Rust is a strong fit for reliable, efficient, memory-safe compute kernels and
  native helpers. Official Rust guidance emphasizes performance, low resource
  use, no garbage collector, and integration with other languages.
- WebAssembly is the least invasive first decision path for pure compute kernels:
  it keeps the boundary narrow and is suitable for code compiled from languages
  like Rust into a portable module.
- N-API/NAPI-RS is the production path only after a proof shows WASM or
  TypeScript is insufficient. Node-API's ABI stability and NAPI-RS platform
  support reduce runtime churn but increase packaging and release complexity.
- Sidecars are appropriate for OS capability helpers and crash isolation, not
  tight projection loops unless IPC overhead is proven acceptable.
- CLI subprocesses are acceptable for manual spikes or one-shot tools, not
  steady-state hot paths.

Implementation rule: prove the hot path in TypeScript first, then prove bridge
cost, then select the Rust transport. Do not select Rust transport by fashion or
theoretical throughput alone.

Do not add a generic Rust readiness benchmark command. Future evidence must be
owned by the specific Rust module slice and must measure current
Bun/TypeScript behavior, bridge cost, transport fit, parity, fallback behavior,
and cross-platform build/distribution before any external Rust module or
production package is approved.

## Completion Criteria

- Architecture and roadmap docs clearly distinguish Bun control-plane ownership
  from Rust hot-path/native-helper ownership.
- Future implementers can identify which Rust slices are allowed, forbidden, or
  require escalation.
- No duplicate projection models or policy engines are introduced.
- Cross-surface contracts remain the only shared operator truth.

## Verification

Documentation-only track verification:

```bash
git diff --check
```

Any future implementation slice must add focused parity tests and benchmark
evidence before promotion.
