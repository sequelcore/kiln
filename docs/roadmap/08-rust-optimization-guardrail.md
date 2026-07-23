# 08 - Rust Optimization Guardrail

Status: Guardrail
Execution: Guardrail - no implementation without a module-specific ADR, parity contract, and benchmark.
Created: 2026-05-17

## Objective

Define when Rust, WASM, N-API, or sidecars may accelerate an approved Kiln hot
path without creating a second runtime, schema, policy engine, or operator truth.

## Ownership

Bun/TypeScript retains control-plane semantics, routing, authority, memory,
configuration, managed jobs, approvals, gateway contracts, and surfaces. Native
modules may implement narrow replaceable kernels behind TypeScript-owned ports.

## Scope

- Admission and promotion gates for measured native helpers or compute kernels.
- TypeScript reference behavior, deterministic parity, fallback, and packaging evidence.
- Transport selection only after current hot-path and bridge-cost measurement.

## Non-Goals

- No generic Rust readiness command or retained spike package.
- No Rust ownership of routing, authority, permissions, goals, work items, approvals, or UI state.
- No transport choice by fashion or theoretical throughput.
- No native operator-surface implementation in this track.

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

## Promotion Gates

- Canonical contract-shaped input and output.
- Deterministic parity across supported platforms.
- Native absence/crash preserves TypeScript semantics.
- Material measured advantage after TypeScript cleanup.
- Cross-platform build and release cost is accepted.
- No forbidden ownership boundary is crossed.
- Focused parity tests, typecheck, build, benchmark, and review pass.

## Verification

This document is a decision boundary and requires `git diff --check`. Any admitted
module supplies its own fixtures, benchmarks, parity tests, fallback proof, and
release verification in the owning roadmap or ADR.

## Completion Criteria

The boundary remains explicit and future native work can be admitted or rejected
without duplicate control planes or retained speculative code.
