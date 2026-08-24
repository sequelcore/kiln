import type { OperatorColor } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOperatorColorShape(value: unknown): asserts value is OperatorColor {
  if (!isRecord(value)) {
    throw new TypeError("Operator color must be an object.");
  }
  const lightness = Reflect.get(value, "lightness");
  const chroma = Reflect.get(value, "chroma");
  const hue = Reflect.get(value, "hue");
  if (typeof lightness !== "number" || typeof chroma !== "number" || typeof hue !== "number") {
    throw new TypeError("Operator color must contain numeric lightness, chroma, and hue values.");
  }
  if (
    !Number.isFinite(lightness) ||
    lightness < 0 ||
    lightness > 1 ||
    !Number.isFinite(chroma) ||
    chroma < 0 ||
    !Number.isFinite(hue) ||
    hue < 0 ||
    hue >= 360
  ) {
    throw new RangeError("Operator color must be a finite OKLCH value within its canonical ranges.");
  }
}

/** Validates and narrows one canonical OKLCH color value. */
export function assertOperatorColor(value: unknown): asserts value is OperatorColor {
  assertOperatorColorShape(value);
}

/** Converts a canonical OKLCH color to a CSS `oklch()` value. */
export function operatorColorToCss(colorValue: OperatorColor): string {
  assertOperatorColorShape(colorValue);
  return `oklch(${colorValue.lightness} ${colorValue.chroma} ${colorValue.hue})`;
}

function linearSrgbChannel(channel: number): number {
  return channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
}

/** Converts a canonical OKLCH color to an sRGB hex value when it is in gamut. */
export function operatorColorToHex(colorValue: OperatorColor): string {
  assertOperatorColorShape(colorValue);
  const hueRadians = colorValue.hue * (Math.PI / 180);
  const a = colorValue.chroma * Math.cos(hueRadians);
  const b = colorValue.chroma * Math.sin(hueRadians);
  const l = (colorValue.lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (colorValue.lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (colorValue.lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linearChannels = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  if (linearChannels.some((channel) => channel < -0.000001 || channel > 1.000001)) {
    throw new RangeError(`Operator color ${operatorColorToCss(colorValue)} is outside the sRGB gamut.`);
  }

  return `#${linearChannels
    .map((channel) =>
      Math.round(linearSrgbChannel(Math.max(0, Math.min(1, channel))) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Returns relative luminance using the same sRGB conversion as the palette checker. */
export function operatorColorRelativeLuminance(colorValue: OperatorColor): number {
  const hex = operatorColorToHex(colorValue);
  const red = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const green = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const linearize = (channel: number): number =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue);
}

/** Returns the WCAG-style contrast ratio for two canonical colors. */
export function operatorContrastRatio(foreground: OperatorColor, background: OperatorColor): number {
  const lighter = Math.max(operatorColorRelativeLuminance(foreground), operatorColorRelativeLuminance(background));
  const darker = Math.min(operatorColorRelativeLuminance(foreground), operatorColorRelativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}
