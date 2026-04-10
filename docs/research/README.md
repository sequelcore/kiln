# Research

This directory contains the synthesized research basis for Kiln.

Research documents explain:

- why the architecture takes its current shape
- which biological and cybernetic mechanisms were useful
- where the analogies break
- how the current Kiln implementation maps to the research

Research is not the architecture source of truth.

For active architecture doctrine, use:

- `../architecture/README.md`

## Root Research Set

- `kiln-research-synthesis.md`
  High-level synthesis of the research program and the mechanisms that matter
  for Kiln.

- `cybernetic-foundations.md`
  Control-theory and regulation concepts that anchor the Kiln control-plane
  model.

- `biological-mechanisms.md`
  Biological mechanisms that informed architecture decisions, with explicit
  mechanism-to-software mappings and analogy limits.

- `current-state-mapping.md`
  Mapping from the research-derived model to Kiln as it exists today.

## Transitional Rule

During the documentation refactor:

- the final research synthesis should live at `docs/research/*`
- `docs/research/biological-kiln/*` remains temporary source material only
- no final research authority should remain trapped in the prompt-sequence tree
