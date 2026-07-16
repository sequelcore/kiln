export interface OperatorColor {
  readonly lightness: number;
  readonly chroma: number;
  readonly hue: number;
}

export interface OperatorStatusColors {
  readonly foreground: OperatorColor;
  readonly background: OperatorColor;
  readonly border: OperatorColor;
}

export interface OperatorThemePalette {
  readonly appearance: "dark" | "light";
  readonly surface: {
    readonly canvas: OperatorColor;
    readonly panel: OperatorColor;
    readonly raised: OperatorColor;
    readonly sunken: OperatorColor;
    readonly interactive: OperatorColor;
    readonly hover: OperatorColor;
    readonly selected: OperatorColor;
  };
  readonly border: {
    readonly subtle: OperatorColor;
    readonly default: OperatorColor;
    readonly control: OperatorColor;
    readonly focus: OperatorColor;
  };
  readonly text: {
    readonly default: OperatorColor;
    readonly muted: OperatorColor;
    readonly subtle: OperatorColor;
    readonly inverse: OperatorColor;
  };
  readonly brand: {
    readonly accent: OperatorColor;
    readonly muted: OperatorColor;
  };
  readonly action: {
    readonly primary: OperatorColor;
    readonly hover: OperatorColor;
    readonly foreground: OperatorColor;
  };
  readonly status: {
    readonly success: OperatorStatusColors;
    readonly warning: OperatorStatusColors;
    readonly danger: OperatorStatusColors;
    readonly info: OperatorStatusColors;
  };
}

export const OPERATOR_THEME_NAMES = [
  "kiln-dark",
  "kiln-graphite",
  "kiln-light",
  "system-follow",
] as const;

export type OperatorThemeName = (typeof OPERATOR_THEME_NAMES)[number];
export type ConcreteOperatorThemeName = Exclude<OperatorThemeName, "system-follow">;

export const OPERATOR_THEME_LABELS: Record<OperatorThemeName, string> = {
  "kiln-dark": "Kiln Obsidian",
  "kiln-graphite": "Kiln Graphite",
  "kiln-light": "Kiln Paper",
  "system-follow": "System",
};

function color(lightness: number, chroma: number, hue: number): OperatorColor {
  return { lightness, chroma, hue };
}

export const OPERATOR_THEME_PALETTES: Record<ConcreteOperatorThemeName, OperatorThemePalette> = {
  "kiln-dark": {
    appearance: "dark",
    surface: {
      canvas: color(0.135, 0.008, 250),
      panel: color(0.17, 0.01, 250),
      raised: color(0.205, 0.012, 250),
      sunken: color(0.11, 0.007, 250),
      interactive: color(0.23, 0.014, 250),
      hover: color(0.275, 0.016, 250),
      selected: color(0.245, 0.035, 220),
    },
    border: {
      subtle: color(0.25, 0.012, 250),
      default: color(0.34, 0.016, 250),
      control: color(0.49, 0.018, 250),
      focus: color(0.75, 0.1, 220),
    },
    text: {
      default: color(0.89, 0.012, 250),
      muted: color(0.7, 0.018, 250),
      subtle: color(0.6, 0.02, 250),
      inverse: color(0.13, 0.01, 250),
    },
    brand: {
      accent: color(0.72, 0.13, 65),
      muted: color(0.25, 0.045, 65),
    },
    action: {
      primary: color(0.75, 0.1, 220),
      hover: color(0.81, 0.09, 220),
      foreground: color(0.13, 0.02, 220),
    },
    status: {
      success: { foreground: color(0.77, 0.11, 150), background: color(0.22, 0.035, 150), border: color(0.51, 0.07, 150) },
      warning: { foreground: color(0.8, 0.12, 85), background: color(0.23, 0.04, 85), border: color(0.52, 0.08, 85) },
      danger: { foreground: color(0.75, 0.14, 25), background: color(0.22, 0.04, 25), border: color(0.52, 0.09, 25) },
      info: { foreground: color(0.78, 0.1, 250), background: color(0.22, 0.035, 250), border: color(0.51, 0.07, 250) },
    },
  },
  "kiln-graphite": {
    appearance: "dark",
    surface: {
      canvas: color(0.18, 0.008, 250),
      panel: color(0.215, 0.009, 250),
      raised: color(0.25, 0.011, 250),
      sunken: color(0.155, 0.007, 250),
      interactive: color(0.275, 0.013, 250),
      hover: color(0.32, 0.015, 250),
      selected: color(0.29, 0.035, 220),
    },
    border: {
      subtle: color(0.3, 0.012, 250),
      default: color(0.39, 0.016, 250),
      control: color(0.55, 0.018, 250),
      focus: color(0.77, 0.1, 220),
    },
    text: {
      default: color(0.91, 0.01, 250),
      muted: color(0.73, 0.016, 250),
      subtle: color(0.63, 0.018, 250),
      inverse: color(0.15, 0.01, 250),
    },
    brand: {
      accent: color(0.71, 0.12, 65),
      muted: color(0.29, 0.045, 65),
    },
    action: {
      primary: color(0.77, 0.1, 220),
      hover: color(0.83, 0.09, 220),
      foreground: color(0.14, 0.02, 220),
    },
    status: {
      success: { foreground: color(0.78, 0.1, 150), background: color(0.27, 0.035, 150), border: color(0.54, 0.065, 150) },
      warning: { foreground: color(0.81, 0.11, 85), background: color(0.28, 0.04, 85), border: color(0.55, 0.075, 85) },
      danger: { foreground: color(0.77, 0.13, 25), background: color(0.27, 0.04, 25), border: color(0.55, 0.085, 25) },
      info: { foreground: color(0.8, 0.09, 250), background: color(0.27, 0.035, 250), border: color(0.55, 0.065, 250) },
    },
  },
  "kiln-light": {
    appearance: "light",
    surface: {
      canvas: color(0.965, 0.006, 240),
      panel: color(0.99, 0.003, 240),
      raised: color(0.94, 0.008, 240),
      sunken: color(0.92, 0.009, 240),
      interactive: color(0.935, 0.01, 240),
      hover: color(0.9, 0.014, 240),
      selected: color(0.91, 0.035, 220),
    },
    border: {
      subtle: color(0.88, 0.01, 240),
      default: color(0.8, 0.014, 240),
      control: color(0.6, 0.018, 240),
      focus: color(0.48, 0.085, 220),
    },
    text: {
      default: color(0.25, 0.012, 250),
      muted: color(0.43, 0.018, 250),
      subtle: color(0.52, 0.02, 250),
      inverse: color(0.98, 0.005, 240),
    },
    brand: {
      accent: color(0.47, 0.108, 60),
      muted: color(0.93, 0.035, 60),
    },
    action: {
      primary: color(0.47, 0.085, 220),
      hover: color(0.4, 0.07, 220),
      foreground: color(0.98, 0.005, 240),
    },
    status: {
      success: { foreground: color(0.4, 0.1, 150), background: color(0.94, 0.035, 150), border: color(0.61, 0.07, 150) },
      warning: { foreground: color(0.4, 0.078, 85), background: color(0.94, 0.04, 85), border: color(0.62, 0.08, 85) },
      danger: { foreground: color(0.45, 0.14, 25), background: color(0.94, 0.028, 25), border: color(0.63, 0.09, 25) },
      info: { foreground: color(0.43, 0.1, 250), background: color(0.94, 0.027, 250), border: color(0.62, 0.07, 250) },
    },
  },
};

function assertOperatorColor(colorValue: OperatorColor): void {
  if (
    !Number.isFinite(colorValue.lightness)
    || colorValue.lightness < 0
    || colorValue.lightness > 1
    || !Number.isFinite(colorValue.chroma)
    || colorValue.chroma < 0
    || !Number.isFinite(colorValue.hue)
    || colorValue.hue < 0
    || colorValue.hue >= 360
  ) {
    throw new RangeError("Operator color must be a finite OKLCH value within its canonical ranges.");
  }
}

export function operatorColorToCss(colorValue: OperatorColor): string {
  assertOperatorColor(colorValue);
  return `oklch(${colorValue.lightness} ${colorValue.chroma} ${colorValue.hue})`;
}

function linearSrgbChannel(channel: number): number {
  return channel <= 0.0031308
    ? 12.92 * channel
    : (1.055 * (channel ** (1 / 2.4))) - 0.055;
}

export function operatorColorToHex(colorValue: OperatorColor): string {
  assertOperatorColor(colorValue);
  const hueRadians = colorValue.hue * (Math.PI / 180);
  const a = colorValue.chroma * Math.cos(hueRadians);
  const b = colorValue.chroma * Math.sin(hueRadians);
  const l = (colorValue.lightness + (0.3963377774 * a) + (0.2158037573 * b)) ** 3;
  const m = (colorValue.lightness - (0.1055613458 * a) - (0.0638541728 * b)) ** 3;
  const s = (colorValue.lightness - (0.0894841775 * a) - (1.291485548 * b)) ** 3;
  const linearChannels = [
    (4.0767416621 * l) - (3.3077115913 * m) + (0.2309699292 * s),
    (-1.2684380046 * l) + (2.6097574011 * m) - (0.3413193965 * s),
    (-0.0041960863 * l) - (0.7034186147 * m) + (1.707614701 * s),
  ];

  if (linearChannels.some((channel) => channel < -0.000001 || channel > 1.000001)) {
    throw new RangeError(`Operator color ${operatorColorToCss(colorValue)} is outside the sRGB gamut.`);
  }

  return `#${linearChannels
    .map((channel) => Math.round(
      linearSrgbChannel(Math.max(0, Math.min(1, channel))) * 255,
    ).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function isOperatorThemeName(value: unknown): value is OperatorThemeName {
  return typeof value === "string" && (OPERATOR_THEME_NAMES as readonly string[]).includes(value);
}

export function isDarkOperatorTheme(theme: OperatorThemeName, systemPrefersDark = true): boolean {
  if (theme === "system-follow") {
    return systemPrefersDark;
  }
  return OPERATOR_THEME_PALETTES[theme].appearance === "dark";
}

export function resolveOperatorThemePalette(
  theme: OperatorThemeName,
  systemPrefersDark = true,
): OperatorThemePalette {
  if (theme === "system-follow") {
    return systemPrefersDark ? OPERATOR_THEME_PALETTES["kiln-dark"] : OPERATOR_THEME_PALETTES["kiln-light"];
  }
  return OPERATOR_THEME_PALETTES[theme];
}
