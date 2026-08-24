/** A requested operator appearance policy. */
export type AppearanceMode = "system" | "light" | "dark";

/** A concrete color polarity used by a theme variant. */
export type ColorScheme = "light" | "dark";

export interface OperatorColor {
  readonly lightness: number;
  readonly chroma: number;
  readonly hue: number;
}

export interface OperatorStatusColors {
  readonly color: OperatorColor;
  readonly foreground: OperatorColor;
  readonly surface: OperatorColor;
}

/** The semantic color roles shared by all operator surfaces. */
export interface OperatorThemePalette {
  readonly appearance: ColorScheme;
  readonly surface: {
    readonly canvas: OperatorColor;
    readonly chrome: OperatorColor;
    readonly default: OperatorColor;
    readonly raised: OperatorColor;
    readonly overlay: OperatorColor;
    readonly border: OperatorColor;
    readonly input: OperatorColor;
  };
  readonly text: {
    readonly default: OperatorColor;
    readonly muted: OperatorColor;
    readonly placeholder: OperatorColor;
    readonly secondaryLabel: OperatorColor;
    readonly iconMuted: OperatorColor;
  };
  readonly control: {
    readonly focus: OperatorColor;
    readonly accent: OperatorColor;
    readonly accentForeground: OperatorColor;
    readonly secondary: OperatorColor;
    readonly secondaryForeground: OperatorColor;
    readonly muted: OperatorColor;
    readonly mutedForeground: OperatorColor;
    readonly accentSurface: OperatorColor;
    readonly accentSurfaceForeground: OperatorColor;
  };
  readonly conversation: {
    readonly message: {
      readonly surface: OperatorColor;
      readonly foreground: OperatorColor;
      readonly action: OperatorColor;
      readonly actionForeground: OperatorColor;
      readonly actionHover: OperatorColor;
    };
    readonly code: {
      readonly background: OperatorColor;
      readonly foreground: OperatorColor;
    };
  };
  readonly sidebar: {
    readonly background: OperatorColor;
    readonly foreground: OperatorColor;
    readonly mutedForeground: OperatorColor;
    readonly control: OperatorColor;
    readonly hover: OperatorColor;
    readonly active: OperatorColor;
    readonly selected: OperatorColor;
    readonly border: OperatorColor;
  };
  readonly toolbar: {
    readonly background: OperatorColor;
    readonly foreground: OperatorColor;
    readonly border: OperatorColor;
    readonly control: OperatorColor;
    readonly controlForeground: OperatorColor;
    readonly hover: OperatorColor;
  };
  readonly terminal: {
    readonly background: OperatorColor;
    readonly foreground: OperatorColor;
    readonly cursor: OperatorColor;
    readonly selection: OperatorColor;
    readonly scrollbar: OperatorColor;
    readonly scrollbarHover: OperatorColor;
  };
  readonly status: {
    readonly error: OperatorStatusColors;
    readonly warning: OperatorStatusColors;
    readonly update: OperatorStatusColors;
    readonly success: OperatorStatusColors;
    readonly info: OperatorStatusColors;
  };
}

export interface OperatorAppearancePreference {
  readonly mode: AppearanceMode;
  readonly themeByScheme: {
    readonly light: string;
    readonly dark: string;
  };
}

export interface OperatorThemeDefinition {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly label: string;
  readonly variants: {
    readonly light?: OperatorThemePalette;
    readonly dark?: OperatorThemePalette;
  };
}

export type OperatorThemeName = "automata" | "phosphor" | "vesper";
export type ConcreteOperatorThemeName = OperatorThemeName;

export type OperatorAppearanceResolution =
  | OperatorAppearanceResolved
  | OperatorAppearanceSystemObservationUnavailable
  | OperatorAppearanceSelectedThemeUnavailable;

export interface OperatorAppearanceResolved {
  readonly status: "resolved";
  readonly scheme: ColorScheme;
  readonly themeId: string;
  readonly requestedThemeId: string;
  readonly fallbackThemeId: null;
  readonly fallback: false;
  readonly theme: OperatorThemeDefinition;
  readonly palette: OperatorThemePalette;
}

export interface OperatorAppearanceSystemObservationUnavailable {
  readonly status: "system-observation-unavailable";
  readonly scheme: "dark";
  readonly themeId: string;
  readonly requestedThemeId: null;
  readonly fallbackThemeId: "phosphor";
  readonly fallback: true;
  readonly theme: OperatorThemeDefinition;
  readonly palette: OperatorThemePalette;
}

export interface OperatorAppearanceSelectedThemeUnavailable {
  readonly status: "selected-theme-unavailable";
  readonly scheme: ColorScheme;
  readonly themeId: string;
  readonly requestedThemeId: string;
  readonly fallbackThemeId: "automata" | "phosphor";
  readonly fallback: true;
  readonly theme: OperatorThemeDefinition;
  readonly palette: OperatorThemePalette;
}

export interface SemanticContrastAdjacency {
  readonly id: string;
  readonly foreground: string;
  readonly background: string;
  readonly minimumRatio: number;
}

export interface SemanticContrastCheck extends SemanticContrastAdjacency {
  readonly ratio: number;
  readonly passes: boolean;
}

export interface SemanticAdjacencyContrastValidation {
  readonly valid: boolean;
  readonly checks: readonly SemanticContrastCheck[];
  readonly violations: readonly SemanticContrastCheck[];
}
