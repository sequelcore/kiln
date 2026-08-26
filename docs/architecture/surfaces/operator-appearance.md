# Operator Appearance

Operator appearance is one policy projected into GUI and TUI renderers. The
pure `@kilnai/operator-appearance` package owns theme definitions, semantic
OKLCH roles, validation, contrast checks, deterministic resolution, and the
built-in catalog. It has no filesystem, DOM, terminal, Runtime, or Gateway
dependency.

## Canonical Preference

Global config v5 owns the durable preference as one atomic value:

```yaml
ui:
  appearance:
    mode: system
    themeByScheme:
      light: automata
      dark: phosphor
```

`mode` is `system`, `light`, or `dark`. Both scheme selections are always
present so switching modes does not destroy an operator choice. The CLI config
mutation authority is the only durable writer; it provides validation,
revision fencing, locking, atomic replacement, and read-back. GUI localStorage
is only a versioned startup projection cache and is replaced from the settings
snapshot. It is never configuration authority.

Legacy appearance contracts have no compatibility reader or migration path.
There are no external consumers; canonical operator state was replaced with
v5 in place.

## Resolution and Surface Boundaries

The resolver takes `(preference, catalog, observedScheme)` and returns the
effective scheme, theme, palette, and explicit fallback evidence. The GUI can
observe the operating-system color scheme and re-resolves `system` changes.
The TUI cannot do so reliably, therefore `system` resolves to the documented
dark fallback. A surface may adapt semantic colors to CSS or terminal-safe
sRGB, but may not own another palette. Inline code, fenced code, source
viewers, and terminal output consume their canonical foreground/background
pairs. Renderer-specific syntax scopes may map to existing semantic roles, but
must not introduce fixed light or dark editor palettes.

`operator_set_theme` is a live session actuator only. Runtime sends one
`operator_theme_set` frame to an attached GUI or TUI and reports its
acknowledgement. It cannot persist config. CLI has no live visual surface and
therefore returns an explicit capability error. Durable changes belong to the
human settings/config path.

The GUI Appearance page owns mode and per-scheme selection. Built-in themes
are Automata, Phosphor, Sequel, and Vesper. Kiln does not yet have a canonical custom
theme store, so create/import controls are intentionally absent; adding them
requires a single catalog owner with bounded parsing, atomic writes, revisions,
and a secret-free snapshot rather than browser-owned files.

The widget is outside this contract because it is an embeddable consumer whose
host owns presentation. A future surface joins by consuming the pure policy
package and implementing only its renderer adapter and observation capability.

## Invariants and Verification

- One durable owner: global `ui.appearance`.
- One palette/catalog owner: `@kilnai/operator-appearance`.
- Session overrides never update durable config or its local cache projection.
- Canonical preferences admit only built-in themes with a variant matching the
  selected scheme. Missing system observation resolves deterministically.
- Theme definitions must pass structural and semantic contrast validation.
- Conversation code foreground/background must meet the normal-text contrast
  gate independently of the surrounding message surface.
- GUI and TUI projection tests prove their renderer mappings; configuration
  tests prove canonical admission and revision-fenced writes.
