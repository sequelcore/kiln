import { operatorColorToHex, operatorContrastRatio } from "./colors.js";
import type {
  OperatorColor,
  OperatorThemeDefinition,
  OperatorThemePalette,
  SemanticAdjacencyContrastValidation,
  SemanticContrastAdjacency,
  SemanticContrastCheck,
} from "./types.js";
import { assertOperatorThemeDefinition, assertOperatorThemePalette } from "./validation.js";

/** The stable semantic foreground/background relationships checked for every palette. */
export const OPERATOR_SEMANTIC_CONTRAST_ADJACENCIES: readonly SemanticContrastAdjacency[] = [
  { id: "text.default-on-surface.default", foreground: "text.default", background: "surface.default", minimumRatio: 7 },
  { id: "text.muted-on-surface.default", foreground: "text.muted", background: "surface.default", minimumRatio: 4.5 },
  {
    id: "text.placeholder-on-surface.input",
    foreground: "text.placeholder",
    background: "surface.input",
    minimumRatio: 4.5,
  },
  {
    id: "control.accentForeground-on-control.accent",
    foreground: "control.accentForeground",
    background: "control.accent",
    minimumRatio: 4.5,
  },
  {
    id: "conversation.code.foreground-on-conversation.code.background",
    foreground: "conversation.code.foreground",
    background: "conversation.code.background",
    minimumRatio: 7,
  },
  {
    id: "sidebar.foreground-on-sidebar.background",
    foreground: "sidebar.foreground",
    background: "sidebar.background",
    minimumRatio: 7,
  },
  {
    id: "toolbar.foreground-on-toolbar.background",
    foreground: "toolbar.foreground",
    background: "toolbar.background",
    minimumRatio: 7,
  },
  {
    id: "terminal.foreground-on-terminal.background",
    foreground: "terminal.foreground",
    background: "terminal.background",
    minimumRatio: 7,
  },
  {
    id: "status.error.foreground-on-status.error.surface",
    foreground: "status.error.foreground",
    background: "status.error.surface",
    minimumRatio: 4.5,
  },
  {
    id: "status.warning.foreground-on-status.warning.surface",
    foreground: "status.warning.foreground",
    background: "status.warning.surface",
    minimumRatio: 4.5,
  },
  {
    id: "status.update.foreground-on-status.update.surface",
    foreground: "status.update.foreground",
    background: "status.update.surface",
    minimumRatio: 4.5,
  },
  {
    id: "status.success.foreground-on-status.success.surface",
    foreground: "status.success.foreground",
    background: "status.success.surface",
    minimumRatio: 4.5,
  },
  {
    id: "status.info.foreground-on-status.info.surface",
    foreground: "status.info.foreground",
    background: "status.info.surface",
    minimumRatio: 4.5,
  },
  {
    id: "status.error.color-on-status.error.surface",
    foreground: "status.error.color",
    background: "status.error.surface",
    minimumRatio: 3,
  },
  {
    id: "status.warning.color-on-status.warning.surface",
    foreground: "status.warning.color",
    background: "status.warning.surface",
    minimumRatio: 3,
  },
  {
    id: "status.update.color-on-status.update.surface",
    foreground: "status.update.color",
    background: "status.update.surface",
    minimumRatio: 3,
  },
  {
    id: "status.success.color-on-status.success.surface",
    foreground: "status.success.color",
    background: "status.success.surface",
    minimumRatio: 3,
  },
  {
    id: "status.info.color-on-status.info.surface",
    foreground: "status.info.color",
    background: "status.info.surface",
    minimumRatio: 3,
  },
];

function colorAtPath(palette: OperatorThemePalette, path: string): OperatorColor {
  const [section, role, nestedRole] = path.split(".");
  if (section === "surface" && role !== undefined && role in palette.surface) {
    return palette.surface[role as keyof OperatorThemePalette["surface"]];
  }
  if (section === "text" && role !== undefined && role in palette.text) {
    return palette.text[role as keyof OperatorThemePalette["text"]];
  }
  if (section === "control" && role !== undefined && role in palette.control) {
    return palette.control[role as keyof OperatorThemePalette["control"]];
  }
  if (section === "conversation" && role === "code" && nestedRole !== undefined && nestedRole in palette.conversation.code) {
    return palette.conversation.code[nestedRole as keyof OperatorThemePalette["conversation"]["code"]];
  }
  if (section === "sidebar" && role !== undefined && role in palette.sidebar) {
    return palette.sidebar[role as keyof OperatorThemePalette["sidebar"]];
  }
  if (section === "toolbar" && role !== undefined && role in palette.toolbar) {
    return palette.toolbar[role as keyof OperatorThemePalette["toolbar"]];
  }
  if (section === "terminal" && role !== undefined && role in palette.terminal) {
    return palette.terminal[role as keyof OperatorThemePalette["terminal"]];
  }
  if (section === "status" && role !== undefined && nestedRole !== undefined && role in palette.status) {
    const status = palette.status[role as keyof OperatorThemePalette["status"]];
    if (nestedRole in status) {
      return status[nestedRole as keyof typeof status];
    }
  }
  throw new Error(`Unknown operator semantic color path: ${path}`);
}

/** Evaluates every stable semantic color adjacency for a palette. */
export function validateSemanticAdjacencyContrast(palette: OperatorThemePalette): SemanticAdjacencyContrastValidation {
  assertOperatorThemePalette(palette);
  const checks: SemanticContrastCheck[] = OPERATOR_SEMANTIC_CONTRAST_ADJACENCIES.map((adjacency) => {
    const foreground = colorAtPath(palette, adjacency.foreground);
    const background = colorAtPath(palette, adjacency.background);
    const ratio = operatorContrastRatio(foreground, background);
    return {
      ...adjacency,
      ratio,
      passes: ratio >= adjacency.minimumRatio,
    };
  });
  return {
    valid: checks.every((check) => check.passes),
    checks,
    violations: checks.filter((check) => !check.passes),
  };
}

/** Returns true when all required semantic adjacencies meet their thresholds. */
export function isSemanticAdjacencyContrastValid(palette: OperatorThemePalette): boolean {
  return validateSemanticAdjacencyContrast(palette).valid;
}

/** Throws when a palette violates one or more required semantic adjacencies. */
export function assertSemanticAdjacencyContrast(palette: OperatorThemePalette): void {
  const validation = validateSemanticAdjacencyContrast(palette);
  if (!validation.valid) {
    const details = validation.violations
      .map((violation) => `${violation.id}=${violation.ratio.toFixed(3)}<${violation.minimumRatio}`)
      .join(", ");
    throw new RangeError(`Operator theme contrast requirements failed: ${details}`);
  }
}

/** Validates all variants present on a theme definition. */
export function validateOperatorThemeDefinitionContrast(
  definition: OperatorThemeDefinition,
): Readonly<Partial<Record<"light" | "dark", SemanticAdjacencyContrastValidation>>> {
  assertOperatorThemeDefinition(definition);
  const result: Partial<Record<"light" | "dark", SemanticAdjacencyContrastValidation>> = {};
  if (definition.variants.light !== undefined) {
    result.light = validateSemanticAdjacencyContrast(definition.variants.light);
  }
  if (definition.variants.dark !== undefined) {
    result.dark = validateSemanticAdjacencyContrast(definition.variants.dark);
  }
  return result;
}

export { operatorColorToHex, operatorContrastRatio };
