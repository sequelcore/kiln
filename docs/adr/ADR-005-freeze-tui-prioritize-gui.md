# ADR-005: Freeze TUI Surface, Prioritize GUI as Primary Operator Interface

**Status:** Accepted (2026-04-17), amended (2026-04-30)
**Date:** 2026-04-17
**Author:** Ricardo Armenta
**Scope:** `packages/tui/`, `packages/cli/`, `packages/gui/`, `STRATEGY.md` Phase G (Operator Surfaces)

---

## 2026-04-30 Amendment

GUI Phase 1 parity is closed and the GUI is the primary operator surface.
`packages/tui/` remains in the repository as a frozen maintenance surface for
terminal-first workflows, fallback use, and future reassessment if concrete
operator demand returns.

The current TUI policy is:

- no new TUI feature development by default
- critical fixes and shared-contract compatibility repairs are allowed
- no TUI-only runtime, provider, memory, tool, or authority paths
- renewed TUI product investment requires an explicit decision

Canonical current policy lives in `docs/guides/gui-parity.md` and
`docs/guides/tui-maintenance.md`.

---

## Context

Kiln's canonical doctrine (see `STRATEGY.md` §1 and `docs/architecture/identity.md`)
positions the system as a **cybernetic control plane for governed AI work**. The
architecture is deliberately split into a headless core (`@kilnai/core`,
`@kilnai/runtime`) and pluggable operator surfaces (`cli`, `tui`, `sdk`,
`widget`, `studio`). Surfaces are thin clients over core contracts; no surface
is load-bearing for the control plane itself.

Today, `packages/tui` (built on `@opentui/core` + `@opentui/react` 0.1.92) is
one of two interactive operator surfaces. It has absorbed non-trivial
investment and occupies a slot in Phase G of the roadmap.

### Signals that forced this decision

1. **Peer category evidence.** Every direct peer in Kiln's adjacent category —
   Temporal, LangSmith, Langfuse, Prefect, CrewAI — ships GUI-first as the
   operator surface. The feature requests in those communities are for richer
   dashboards, traces, and inspection UIs, not for TUIs. There is no
   observable category pull toward terminal-native operator interfaces for
   governed AI work.

2. **Internal developer signal.** The sole current operator of Kiln's TUI
   (Ricardo) finds it frustrating and uses it only out of obligation. The
   TUI has no product-market fit with its only tester — a negative signal
   strong enough to act on even without external data.

3. **Technical reality.** Every legitimate use case previously attributed to
   a TUI is covered by the existing CLI plus a future GUI:
   - Remote operation: GUI + daemon/thin-client or SSH port-forward to a
     local web surface
   - Latency: modern web/Tauri rendering is not the bottleneck; the model
     is
   - Keyboard-native: command palette + vim bindings in a GUI match TUI
     ergonomics
   - Scripting / CI / one-shot commands: `@kilnai/cli` already owns this
     and is the correct surface

4. **Compliance tailwinds.** SOC2, HIPAA, and WCAG accessibility
   expectations for operator-facing surfaces favor GUI. TUI has no
   plausible path to WCAG conformance.

5. **Architectural invariant preserved.** Because the core is headless
   (`docs/architecture/invariants.md`), removing a surface drops only a
   window, not a capability. A new GUI surface binds to the same
   `@kilnai/core` + `@kilnai/runtime` contracts the TUI binds to today.

### Honest caveats

- Kiln has no external users yet. This decision is made on convergent
  internal + research signal, not statistical proof from production usage.
- Any logic that has leaked from `@kilnai/core` into `@kilnai/tui` must be
  pulled back into core *before* freeze, or the freeze will trap
  control-plane behavior behind a deprecated surface. The parallel leakage
  audit completed on 2026-04-17 and found the TUI clean: only a read-only
  `getFieldStore().snapshot()` telemetry poll in `packages/tui/src/app.tsx`
  touches core, which is appropriate consumer behavior. No pull-back
  required.
- The original cleanup target assumed parity would require removing the TUI.
  Actual usage changed that policy: GUI parity is closed, and the old active
  TUI roadmap path is removed by freezing TUI ownership and promoting the GUI
  to primary surface, not by deleting the terminal package.

---

## Decision

1. **Freeze `@kilnai/tui` feature development, effective immediately.**
   No new features, no new bindings, no new dependencies. The package is
   marked `experimental` in its `package.json` and in `docs/guides/tui.md`.
   Only critical bug fixes (crashes, data loss, security) are permitted.

2. **Elevate a new GUI surface to the primary operator interface slot in
   Phase G of the roadmap.** Web-first. Tauri (desktop wrapper) considered
   later once the web surface stabilizes. The GUI binds to the same
   `@kilnai/core` + `@kilnai/runtime` contracts currently used by CLI and
   TUI — it does not introduce a parallel control-plane.

3. **Retain and invest in `@kilnai/cli`** as the canonical terminal
   surface for scripting, automation, CI, and one-shot commands. CLI and
   GUI are the two supported operator surfaces going forward.

4. **Precondition satisfied.** The TUI→core leakage audit completed on
   2026-04-17 found no business logic leakage; the freeze can take binding
   effect without pull-back work.

5. **6-month review clause (by 2026-10-17).** If external user demand for
   a TUI surfaces during the review window — with concrete use cases not
   covered by CLI + GUI — this ADR is revisited. Otherwise:

6. **Retain TUI in maintenance mode.** Once GUI Phase 1 parity is satisfied,
   `packages/tui/` remains available but frozen. The GUI is the focused
   operator surface. TUI work is limited to critical fixes and shared-contract
   compatibility unless a new decision reopens product investment.

### Scope boundaries

**Unchanged by this ADR:**
- `@kilnai/core`, `@kilnai/runtime` — headless engine, unchanged
- `@kilnai/sdk` (`@kilnai/react`) — programmatic integration surface
- `@kilnai/widget` — embeddable UI surface
- `@kilnai/studio` — development and inspection tooling
- `@kilnai/cli` — retained and invested in

**Changed by this ADR:**
- `@kilnai/tui` — frozen, experimental, maintenance-only
- Phase G (Operator Surfaces) — GUI promoted to primary; TUI demoted to
  deprecated
- A new `packages/gui/` package to be proposed in a follow-up ADR that
  defines its stack, boundaries, and binding contract

---

## Consequences

### Positive

- Engineering attention concentrates on the surface with category pull and
  accessibility tailwinds
- Operator surface strategy aligns with peer category (Temporal, LangSmith,
  Langfuse, Prefect, CrewAI)
- Explicit maintenance limits prevent `@kilnai/tui` from drifting into a
  parallel product surface
- Headless-core invariant is reinforced: surfaces are replaceable, the
  control plane is not

### Negative / risks

- Short-term: the current operator (Ricardo) loses the TUI as an active
  investment target before the GUI exists. Mitigated by CLI remaining
  fully supported during the transition.
- Sunk-cost optics: the TUI has absorbed real investment. This is
  acknowledged and accepted — sunk cost is not a reason to keep a surface
  that lacks demand.
- External demand could still surface late. The 6-month review clause is
  the explicit escape hatch.

### Follow-ups required

- [ ] Follow-up ADR: `packages/gui/` stack, boundaries, and binding
      contract
- [ ] Update `STRATEGY.md` Phase G to reflect GUI-primary, TUI-frozen
- [ ] Update `docs/guides/tui.md` to surface the experimental/maintenance
      status
- [ ] Update `packages/tui/package.json` with `experimental` marker and
      maintenance status
- [ ] Schedule 2026-10-17 review checkpoint
- [ ] Resolve ADR-002 number duplication (separate cleanup)

---

## Alternatives Considered

### A. Keep investing in both TUI and GUI

Rejected. Kiln has no external users and one internal operator. Running two
operator surfaces in parallel fragments attention, duplicates binding
logic, and creates two drift surfaces against the core. There is no
evidence of demand that justifies parallel investment.

### B. Freeze TUI but keep it in maintenance mode

Accepted by the 2026-04-30 amendment. Actual GUI usage proved the product
focus shift, while terminal fallback remains useful enough to retain. The
guardrail is strict ownership: TUI maintenance cannot become a second product
track or a private runtime path.

### C. Remove TUI immediately

Rejected. GUI does not yet exist; the current operator would be stranded
between CLI and nothing. Under the 2026-04-30 amendment, this remains rejected
because the GUI is now primary and the frozen TUI still has fallback value.

### D. Replace TUI with a terminal-native web UI (e.g., textual-web,
    browser-in-terminal)

Rejected. Adds a novel surface category with no category evidence behind
it, and does not address the accessibility or compliance gaps that drove
the GUI decision in the first place.

---

## References

- `STRATEGY.md` §1 Executive Thesis, §3 Strategic Laws (law 8), Phase G,
  Phase I
- `docs/architecture/identity.md` — headless core + pluggable surfaces
- `docs/architecture/invariants.md` — surface replaceability invariant
- `docs/guides/tui.md` — current TUI documentation (to be updated)
- ADR-001 through ADR-004 — prior architectural decisions (none conflict
  with this decision; ADR-002 number duplication flagged as separate
  cleanup)
