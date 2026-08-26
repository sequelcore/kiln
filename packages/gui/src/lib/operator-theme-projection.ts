import {
  isOperatorThemeName,
  OPERATOR_THEME_DEFINITIONS,
  OPERATOR_THEME_DEFINITIONS_BY_ID,
  type OperatorAppearancePreference,
  type OperatorAppearanceResolution,
  type OperatorColor,
  type OperatorThemeName,
  type OperatorThemePalette,
  operatorColorToCss,
  operatorColorToHex,
  resolveOperatorAppearance,
} from "@kilnai/operator-appearance";

export const OPERATOR_THEME_APPLIED_EVENT = "kiln:operator-theme-applied";

function projectOperatorThemeVariables(
  palette: OperatorThemePalette,
  render: (color: OperatorColor) => string,
): Readonly<Record<string, string>> {
  return {
    "--kiln-canvas": render(palette.surface.canvas),
    "--kiln-chrome": render(palette.surface.chrome),
    "--kiln-surface": render(palette.surface.default),
    "--kiln-surface-raised": render(palette.surface.raised),
    "--kiln-surface-overlay": render(palette.surface.overlay),
    "--kiln-border": render(palette.surface.border),
    "--kiln-input": render(palette.surface.input),
    "--kiln-text": render(palette.text.default),
    "--kiln-text-muted": render(palette.text.muted),
    "--kiln-placeholder": render(palette.text.placeholder),
    "--kiln-secondary-label": render(palette.text.secondaryLabel),
    "--kiln-icon-muted": render(palette.text.iconMuted),
    "--kiln-focus": render(palette.control.focus),
    "--kiln-accent": render(palette.control.accent),
    "--kiln-accent-foreground": render(palette.control.accentForeground),
    "--kiln-secondary": render(palette.control.secondary),
    "--kiln-secondary-foreground": render(palette.control.secondaryForeground),
    "--kiln-muted": render(palette.control.muted),
    "--kiln-muted-foreground": render(palette.control.mutedForeground),
    "--kiln-accent-surface": render(palette.control.accentSurface),
    "--kiln-accent-surface-foreground": render(palette.control.accentSurfaceForeground),
    "--kiln-message-surface": render(palette.conversation.message.surface),
    "--kiln-message-foreground": render(palette.conversation.message.foreground),
    "--kiln-message-action": render(palette.conversation.message.action),
    "--kiln-message-action-foreground": render(palette.conversation.message.actionForeground),
    "--kiln-message-action-hover": render(palette.conversation.message.actionHover),
    "--kiln-code-background": render(palette.conversation.code.background),
    "--kiln-code-foreground": render(palette.conversation.code.foreground),
    "--kiln-sidebar": render(palette.sidebar.background),
    "--kiln-sidebar-foreground": render(palette.sidebar.foreground),
    "--kiln-sidebar-muted-foreground": render(palette.sidebar.mutedForeground),
    "--kiln-sidebar-control": render(palette.sidebar.control),
    "--kiln-sidebar-hover": render(palette.sidebar.hover),
    "--kiln-sidebar-active": render(palette.sidebar.active),
    "--kiln-sidebar-selected": render(palette.sidebar.selected),
    "--kiln-sidebar-border": render(palette.sidebar.border),
    "--kiln-toolbar": render(palette.toolbar.background),
    "--kiln-toolbar-foreground": render(palette.toolbar.foreground),
    "--kiln-toolbar-border": render(palette.toolbar.border),
    "--kiln-toolbar-control": render(palette.toolbar.control),
    "--kiln-toolbar-control-foreground": render(palette.toolbar.controlForeground),
    "--kiln-toolbar-hover": render(palette.toolbar.hover),
    "--kiln-terminal-background": render(palette.terminal.background),
    "--kiln-terminal-foreground": render(palette.terminal.foreground),
    "--kiln-terminal-cursor": render(palette.terminal.cursor),
    "--kiln-terminal-selection": render(palette.terminal.selection),
    "--kiln-terminal-scrollbar": render(palette.terminal.scrollbar),
    "--kiln-terminal-scrollbar-hover": render(palette.terminal.scrollbarHover),
    ...projectStatusVariables("error", palette.status.error, render),
    ...projectStatusVariables("warning", palette.status.warning, render),
    ...projectStatusVariables("update", palette.status.update, render),
    ...projectStatusVariables("success", palette.status.success, render),
    ...projectStatusVariables("info", palette.status.info, render),
  };
}

function projectStatusVariables(
  name: string,
  status: OperatorThemePalette["status"][keyof OperatorThemePalette["status"]],
  render: (color: OperatorColor) => string,
): Readonly<Record<string, string>> {
  return {
    [`--kiln-status-${name}`]: render(status.color),
    [`--kiln-status-${name}-foreground`]: render(status.foreground),
    [`--kiln-status-${name}-surface`]: render(status.surface),
  };
}

export function projectOperatorThemeCssVariables(palette: OperatorThemePalette): Readonly<Record<string, string>> {
  return projectOperatorThemeVariables(palette, operatorColorToCss);
}

export function projectOperatorThemeHexVariables(palette: OperatorThemePalette): Readonly<Record<string, string>> {
  return projectOperatorThemeVariables(palette, operatorColorToHex);
}

export function resolveAppliedOperatorThemePalette(root: HTMLElement): OperatorThemePalette {
  const theme = isOperatorThemeName(root.dataset.kilnTheme) ? root.dataset.kilnTheme : ("tesota" as const);
  const definition = OPERATOR_THEME_DEFINITIONS_BY_ID[theme];
  const palette =
    definition.variants[root.dataset.theme === "light" ? "light" : "dark"] ??
    OPERATOR_THEME_DEFINITIONS_BY_ID.tesota.variants.dark;
  if (!palette) throw new Error("Built-in Tesota dark fallback is unavailable.");
  return palette;
}

export function applyOperatorTheme(theme: OperatorThemeName, root: HTMLElement = document.documentElement): void {
  const definition = OPERATOR_THEME_DEFINITIONS_BY_ID[theme];
  const visibleScheme =
    root.dataset.theme === "light" || root.dataset.theme === "dark" ? root.dataset.theme : undefined;
  const palette =
    (visibleScheme ? definition.variants[visibleScheme] : undefined) ??
    definition.variants.dark ??
    definition.variants.light;
  if (!palette) throw new Error(`Theme '${theme}' has no applicable variant.`);
  applyResolvedPalette(theme, palette, root);
}

export function applyOperatorAppearance(
  preference: OperatorAppearancePreference,
  observedScheme: "light" | "dark" | null,
  root: HTMLElement = document.documentElement,
): OperatorAppearanceResolution {
  const resolution = resolveOperatorAppearance(preference, OPERATOR_THEME_DEFINITIONS, observedScheme);
  if (!isOperatorThemeName(resolution.themeId)) {
    throw new Error(`Resolved theme '${resolution.themeId}' is not available in the GUI catalog.`);
  }
  applyResolvedPalette(resolution.themeId, resolution.palette, root);
  return resolution;
}

function applyResolvedPalette(theme: OperatorThemeName, palette: OperatorThemePalette, root: HTMLElement): void {
  root.dataset.theme = palette.appearance;
  root.dataset.kilnTheme = theme;
  root.style.colorScheme = palette.appearance;
  for (const [property, value] of Object.entries(projectOperatorThemeCssVariables(palette))) {
    root.style.setProperty(property, value);
  }
  root.dispatchEvent(new Event(OPERATOR_THEME_APPLIED_EVENT));
}
