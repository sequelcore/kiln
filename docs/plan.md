# Roadmap 06 Research Slice Plan

Objective: continue `docs/roadmap/00.06-live-browser-operator-surface.md`
after the committed Transcript Snapshot Gallery slice (`f7084e5`) by recording
the research decision required before live-browser implementation. The output
is a canonical topical research note that compares current browser-agent
surfaces and decides Kiln's next architecture direction.

Non-goals:

- Do not implement live viewport streaming in this slice.
- Do not add gateway frames, GUI state, or runtime provider code yet.
- Do not make a specific remote browser vendor mandatory.
- Do not move durable architecture doctrine out of `docs/architecture/`.

Surface map:

- `docs/roadmap/00.06-live-browser-operator-surface.md` marks the feature as a
  deferred research track, records Pre-Slice 0 as complete, and asks for
  comparison of labs/products before implementation.
- `docs/research/README.md` owns the canonical research index.
- `docs/architecture/operator-surfaces.md` already requires human surfaces to
  be projections of runtime contracts, not owners of control-plane semantics.
- `docs/architecture/runtime-surfaces.md` defines Operator Gateway and GUI as
  operator surfaces, not app runtime owners.

Implementation slices:

1. Research comparison:
   Compare current official docs for OpenAI, Anthropic, Browserbase,
   Cloudflare Browser Run, Steel, Hyperbrowser, and Browser Use Cloud across
   authority, live view, takeover, replay, and stream-token handling.

2. Research note:
   Add `docs/research/14-live-browser-operator-surface.md` with the findings,
   decision, architecture consequences, security constraints, and recommended
   next implementation slice.

3. Index update:
   Add the new research note to `docs/research/README.md`.

Next implementation slice after this commit:

1. Add gateway-contract types for browser session state and live stream
   lifecycle events.
2. Emit that state from the existing browser tool path when observations are
   produced.
3. Render the GUI Browser tab from the shared state with current snapshot
   behavior as fallback.
4. Add TUI/CLI degradation tests for session state and latest capture links.

Verification gates:

- `bun run typecheck`
- Documentation review gate focused on source support, architecture consistency,
  and whether the next slice is executable.

Residual risks:

- Vendor docs are temporally unstable; revisit before choosing a concrete
  stream provider or remote-browser adapter.
- The research recommends a contract slice next, so no runtime behavior changes
  are expected from this commit.
