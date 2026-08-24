# @kilnai/operator-appearance

Pure appearance policy for Kiln's operator surfaces.

This package owns the shared semantic OKLCH palettes, built-in Automata,
Phosphor, and Vesper theme definitions, boundary validation, contrast checks,
and deterministic resolution of an appearance preference. It has no filesystem,
DOM, configuration, frame, watcher, or lifecycle dependencies. Renderers should
project the resolved palette into their own representations.

```typescript
import {
  DEFAULT_OPERATOR_APPEARANCE_PREFERENCE,
  OPERATOR_THEME_DEFINITIONS,
  resolveOperatorAppearance,
} from "@kilnai/operator-appearance";

const result = resolveOperatorAppearance(
  DEFAULT_OPERATOR_APPEARANCE_PREFERENCE,
  OPERATOR_THEME_DEFINITIONS,
  "dark",
);
```

Theme definitions are schema-versioned values with one or more explicit light
or dark variants. Boundary validation rejects unsupported shapes, invalid OKLCH
values, missing variants, duplicate catalog IDs, and mismatched variant polarity.
