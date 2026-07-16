import {
  isOperatorThemeName,
  operatorColorToCss,
  operatorColorToHex,
  resolveOperatorThemePalette,
  type OperatorColor,
  type OperatorThemeName,
  type OperatorThemePalette,
} from "@kilnai/gateway-contracts";

export const OPERATOR_THEME_APPLIED_EVENT = "kiln:operator-theme-applied";

function projectOperatorThemeVariables(
  palette: OperatorThemePalette,
  render: (color: OperatorColor) => string,
): Readonly<Record<string, string>> {
  return {
    "--color-background": render(palette.surface.canvas),
    "--color-background-panel": render(palette.surface.panel),
    "--color-background-element": render(palette.surface.interactive),
    "--color-surface-raised": render(palette.surface.raised),
    "--color-surface-sunken": render(palette.surface.sunken),
    "--color-surface-hover": render(palette.surface.hover),
    "--color-surface-selected": render(palette.surface.selected),
    "--color-border-subtle": render(palette.border.subtle),
    "--color-border": render(palette.border.default),
    "--color-border-control": render(palette.border.control),
    "--color-border-active": render(palette.border.focus),
    "--color-text": render(palette.text.default),
    "--color-text-muted": render(palette.text.muted),
    "--color-text-subtle": render(palette.text.subtle),
    "--color-text-inverse": render(palette.text.inverse),
    "--color-accent": render(palette.brand.accent),
    "--color-accent-muted": render(palette.brand.muted),
    "--color-primary": render(palette.action.primary),
    "--color-primary-hover": render(palette.action.hover),
    "--color-primary-foreground": render(palette.action.foreground),
    "--color-success": render(palette.status.success.foreground),
    "--status-success-background": render(palette.status.success.background),
    "--status-success-border": render(palette.status.success.border),
    "--color-warning": render(palette.status.warning.foreground),
    "--status-warning-background": render(palette.status.warning.background),
    "--status-warning-border": render(palette.status.warning.border),
    "--color-error": render(palette.status.danger.foreground),
    "--status-danger-background": render(palette.status.danger.background),
    "--status-danger-border": render(palette.status.danger.border),
    "--color-info": render(palette.status.info.foreground),
    "--status-info-background": render(palette.status.info.background),
    "--status-info-border": render(palette.status.info.border),
  };
}

export function projectOperatorThemeCssVariables(palette: OperatorThemePalette): Readonly<Record<string, string>> {
  return projectOperatorThemeVariables(palette, operatorColorToCss);
}

export function projectOperatorThemeHexVariables(palette: OperatorThemePalette): Readonly<Record<string, string>> {
  return projectOperatorThemeVariables(palette, operatorColorToHex);
}

export function resolveAppliedOperatorThemePalette(
  root: HTMLElement,
  systemPrefersDark: boolean,
): OperatorThemePalette {
  const theme = isOperatorThemeName(root.dataset.kilnTheme) ? root.dataset.kilnTheme : "kiln-dark";
  return resolveOperatorThemePalette(theme, systemPrefersDark);
}

export function applyOperatorTheme(
  theme: OperatorThemeName,
  systemPrefersDark: boolean,
  root: HTMLElement = document.documentElement,
): void {
  const palette = resolveOperatorThemePalette(theme, systemPrefersDark);
  root.dataset.theme = palette.appearance;
  root.dataset.kilnTheme = theme;
  root.style.colorScheme = palette.appearance;
  for (const [property, value] of Object.entries(projectOperatorThemeCssVariables(palette))) {
    root.style.setProperty(property, value);
  }
  root.dispatchEvent(new Event(OPERATOR_THEME_APPLIED_EVENT));
}
