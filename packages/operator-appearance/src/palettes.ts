import type {
  ConcreteOperatorThemeName,
  OperatorColor,
  OperatorThemeDefinition,
  OperatorThemePalette,
} from "./types.js";

function color(lightness: number, chroma: number, hue: number): OperatorColor {
  return { lightness, chroma, hue };
}

// Automata, Phosphor, and Vesper are adapted from the operator-selected themes
// at https://github.com/SunkenInTime/t3-themes. Sequel projects the company
// palette into the same semantic contract. All colors are canonical OKLCH.
export const OPERATOR_THEME_PALETTES: Readonly<Record<ConcreteOperatorThemeName, OperatorThemePalette>> = {
  phosphor: {
    appearance: "dark",
    surface: {
      canvas: color(0.141194, 0.015071, 144.725),
      chrome: color(0.141194, 0.015071, 144.725),
      default: color(0.17919, 0.021153, 147.474),
      raised: color(0.211418, 0.026024, 148.968),
      overlay: color(0.154761, 0.01316, 338.901),
      border: color(0.296291, 0.042512, 151.423),
      input: color(0.323523, 0.049446, 151.981),
    },
    text: {
      default: color(0.888896, 0.106477, 151.389),
      muted: color(0.626267, 0.104923, 151.144),
      placeholder: color(0.715062, 0.105605, 151.092),
      secondaryLabel: color(0.880303, 0.03077, 342.696),
      iconMuted: color(0.626267, 0.104923, 151.144),
    },
    control: {
      focus: color(0.879785, 0.23, 149.033),
      accent: color(0.879785, 0.23, 149.033),
      accentForeground: color(0.172621, 0.031557, 155.977),
      secondary: color(0.236849, 0.032549, 152.66),
      secondaryForeground: color(0.852897, 0.124038, 151.125),
      muted: color(0.296291, 0.042512, 151.423),
      mutedForeground: color(0.626267, 0.104923, 151.144),
      accentSurface: color(0.253648, 0.038904, 154.611),
      accentSurfaceForeground: color(0.852897, 0.124038, 151.125),
    },
    conversation: {
      message: {
        surface: color(0.212857, 0.031386, 149.49),
        foreground: color(0.888896, 0.106477, 151.389),
        action: color(0.879785, 0.23, 149.033),
        actionForeground: color(0.172621, 0.031557, 155.977),
        actionHover: color(0.892441, 0.195468, 151.065),
      },
      code: {
        background: color(0.180622, 0.026794, 148.585),
        foreground: color(0.852897, 0.124038, 151.125),
      },
    },
    sidebar: {
      background: color(0.165406, 0.02165, 147.551),
      foreground: color(0.863391, 0.115652, 150.902),
      mutedForeground: color(0.5849, 0.096352, 151.17),
      control: color(0.23366, 0.026081, 338.196),
      hover: color(0.23366, 0.026081, 338.196),
      active: color(0.23366, 0.026081, 338.196),
      selected: color(0.23366, 0.026081, 338.196),
      border: color(0.259666, 0.036309, 151.583),
    },
    toolbar: {
      background: color(0.141194, 0.015071, 144.725),
      foreground: color(0.852897, 0.124038, 151.125),
      border: color(0.296291, 0.042512, 151.423),
      control: color(0.313674, 0.030572, 310.061),
      controlForeground: color(0.848252, 0.038248, 307.961),
      hover: color(0.364912, 0.050794, 308.491),
    },
    terminal: {
      background: color(0.135832, 0.0163, 144.613),
      foreground: color(0.888896, 0.106477, 151.389),
      cursor: color(0.879785, 0.23, 149.033),
      selection: color(0.335301, 0.060639, 157.222),
      scrollbar: color(0.266817, 0.02897, 344.461),
      scrollbarHover: color(0.360924, 0.021469, 316.83),
    },
    status: {
      error: {
        color: color(0.616315, 0.18169, 359.272),
        foreground: color(0.901233, 0.057189, 343.694),
        surface: color(0.259022, 0.04799, 340.062),
      },
      warning: {
        color: color(0.76859, 0.164659, 70.08),
        foreground: color(0.836861, 0.164422, 84.429),
        surface: color(0.321706, 0.036256, 60.806),
      },
      update: {
        color: color(0.636126, 0.194115, 354.928),
        foreground: color(0.901233, 0.057189, 343.694),
        surface: color(0.256077, 0.063004, 342.914),
      },
      success: {
        color: color(0.879785, 0.23, 149.033),
        foreground: color(0.888896, 0.106477, 151.389),
        surface: color(0.253648, 0.038904, 154.611),
      },
      info: {
        color: color(0.670042, 0.086287, 297.481),
        foreground: color(0.880303, 0.03077, 342.696),
        surface: color(0.23366, 0.026081, 338.196),
      },
    },
  },
  sequel: {
    appearance: "dark",
    surface: {
      canvas: color(0.134409, 0, 0),
      chrome: color(0.134409, 0, 0),
      default: color(0.17801, 0.004347, 84.592),
      raised: color(0.223248, 0.006496, 78.189),
      overlay: color(0.274533, 0.008476, 75.236),
      border: color(0.342747, 0.011651, 78.159),
      input: color(0.386277, 0.01552, 75.153),
    },
    text: {
      default: color(0.958261, 0.011099, 89.723),
      muted: color(0.760449, 0.019151, 78.211),
      placeholder: color(0.836192, 0.017544, 76.091),
      secondaryLabel: color(0.91753, 0.012053, 79.782),
      iconMuted: color(0.62022, 0.020103, 78.169),
    },
    control: {
      focus: color(0.727669, 0.036017, 80.228),
      accent: color(0.727669, 0.036017, 80.228),
      accentForeground: color(0.134409, 0, 0),
      secondary: color(0.274533, 0.008476, 75.236),
      secondaryForeground: color(0.958261, 0.011099, 89.723),
      muted: color(0.274533, 0.008476, 75.236),
      mutedForeground: color(0.760449, 0.019151, 78.211),
      accentSurface: color(0.320524, 0.017621, 77.991),
      accentSurfaceForeground: color(0.958261, 0.011099, 89.723),
    },
    conversation: {
      message: {
        surface: color(0.196912, 0.006692, 78.159),
        foreground: color(0.958261, 0.011099, 89.723),
        action: color(0.727669, 0.036017, 80.228),
        actionForeground: color(0.134409, 0, 0),
        actionHover: color(0.778896, 0.034286, 79.214),
      },
      code: {
        background: color(0.17801, 0.004347, 84.592),
        foreground: color(0.91753, 0.012053, 79.782),
      },
    },
    sidebar: {
      background: color(0.155143, 0.002705, 67.627),
      foreground: color(0.958261, 0.011099, 89.723),
      mutedForeground: color(0.760449, 0.019151, 78.211),
      control: color(0.236931, 0.008778, 75.182),
      hover: color(0.274533, 0.008476, 75.236),
      active: color(0.308941, 0.016336, 75.02),
      selected: color(0.308941, 0.016336, 75.02),
      border: color(0.342747, 0.011651, 78.159),
    },
    toolbar: {
      background: color(0.134409, 0, 0),
      foreground: color(0.91753, 0.012053, 79.782),
      border: color(0.342747, 0.011651, 78.159),
      control: color(0.274533, 0.008476, 75.236),
      controlForeground: color(0.91753, 0.012053, 79.782),
      hover: color(0.320524, 0.017621, 77.991),
    },
    terminal: {
      background: color(0.134409, 0, 0),
      foreground: color(0.958261, 0.011099, 89.723),
      cursor: color(0.727669, 0.036017, 80.228),
      selection: color(0.348637, 0.019409, 76.763),
      scrollbar: color(0.307662, 0.010489, 73.525),
      scrollbarHover: color(0.413155, 0.017345, 74.187),
    },
    status: {
      error: {
        color: color(0.752439, 0.085745, 27.393),
        foreground: color(0.900787, 0.03517, 26.546),
        surface: color(0.27761, 0.04064, 22.385),
      },
      warning: {
        color: color(0.781061, 0.10008, 85.155),
        foreground: color(0.8908, 0.07649, 85.512),
        surface: color(0.284792, 0.031409, 76.299),
      },
      update: {
        color: color(0.727669, 0.036017, 80.228),
        foreground: color(0.958261, 0.011099, 89.723),
        surface: color(0.320524, 0.017621, 77.991),
      },
      success: {
        color: color(0.768474, 0.076741, 149.874),
        foreground: color(0.913355, 0.042743, 150.557),
        surface: color(0.287953, 0.035669, 151.953),
      },
      info: {
        color: color(0.748917, 0.04765, 229.095),
        foreground: color(0.920406, 0.020485, 224.31),
        surface: color(0.279054, 0.021932, 226.29),
      },
    },
  },
  vesper: {
    appearance: "dark",
    surface: {
      canvas: color(0.173042, 0, 0),
      chrome: color(0.173042, 0, 0),
      default: color(0.173042, 0, 0),
      raised: color(0.200193, 0, 0),
      overlay: color(0.22645, 0, 0),
      border: color(0.22645, 0, 0),
      input: color(0.22645, 0, 0),
    },
    text: {
      default: color(1, 0, 0),
      muted: color(0.705757, 0, 0),
      placeholder: color(0.616707, 0, 0),
      secondaryLabel: color(0.705757, 0, 0),
      iconMuted: color(0.431281, 0, 0),
    },
    control: {
      focus: color(0.86889, 0.087746, 60.679),
      accent: color(0.86889, 0.087746, 60.679),
      accentForeground: color(0, 0, 0),
      secondary: color(0.200193, 0, 0),
      secondaryForeground: color(1, 0, 0),
      muted: color(0.200193, 0, 0),
      mutedForeground: color(0.705757, 0, 0),
      accentSurface: color(0.200193, 0, 0),
      accentSurfaceForeground: color(1, 0, 0),
    },
    conversation: {
      message: {
        surface: color(0.200193, 0, 0),
        foreground: color(1, 0, 0),
        action: color(0.86889, 0.087746, 60.679),
        actionForeground: color(0, 0, 0),
        actionHover: color(0.886822, 0.0747, 60.715),
      },
      code: { background: color(0.173042, 0, 0), foreground: color(1, 0, 0) },
    },
    sidebar: {
      background: color(0.173042, 0, 0),
      foreground: color(1, 0, 0),
      mutedForeground: color(0.705757, 0, 0),
      control: color(0.173042, 0, 0),
      hover: color(0.276848, 0, 0),
      active: color(0.256153, 0, 0),
      selected: color(0.256153, 0, 0),
      border: color(0.173042, 0, 0),
    },
    toolbar: {
      background: color(0.173042, 0, 0),
      foreground: color(1, 0, 0),
      border: color(0.22645, 0, 0),
      control: color(0.22645, 0, 0),
      controlForeground: color(1, 0, 0),
      hover: color(0.276848, 0, 0),
    },
    terminal: {
      background: color(0.173042, 0, 0),
      foreground: color(1, 0, 0),
      cursor: color(0.86889, 0.087746, 60.679),
      selection: color(0.309186, 0, 0),
      scrollbar: color(0.22645, 0, 0),
      scrollbarHover: color(0.276848, 0, 0),
    },
    status: {
      error: {
        color: color(0.744451, 0.1549, 21.504),
        foreground: color(0.744451, 0.1549, 21.504),
        surface: color(0.225332, 0.034514, 20.132),
      },
      warning: {
        color: color(0.86889, 0.087746, 60.679),
        foreground: color(0.86889, 0.087746, 60.679),
        surface: color(0.251981, 0.024788, 68.994),
      },
      update: {
        color: color(0.86889, 0.087746, 60.679),
        foreground: color(0.86889, 0.087746, 60.679),
        surface: color(0.251981, 0.024788, 68.994),
      },
      success: {
        color: color(0.796194, 0.142352, 150.216),
        foreground: color(0.911619, 0.080694, 152.259),
        surface: color(0.249324, 0.032274, 152.862),
      },
      info: {
        color: color(0.754253, 0.1185, 244.288),
        foreground: color(0.904974, 0.048052, 249.319),
        surface: color(0.251668, 0.036179, 252.507),
      },
    },
  },
  automata: {
    appearance: "light",
    surface: {
      canvas: color(0.829796, 0.031549, 98.937),
      chrome: color(0.829796, 0.031549, 98.937),
      default: color(0.811064, 0.031713, 98.95),
      raised: color(0.845577, 0.0301, 98.542),
      overlay: color(0.864625, 0.027326, 97.658),
      border: color(0.696768, 0.030071, 98.228),
      input: color(0.644502, 0.029204, 97.809),
    },
    text: {
      default: color(0.240027, 0.008037, 84.591),
      muted: color(0.410968, 0.019508, 99.387),
      placeholder: color(0.268322, 0.012879, 93.891),
      secondaryLabel: color(0.410968, 0.019508, 99.387),
      iconMuted: color(0.410968, 0.019508, 99.387),
    },
    control: {
      focus: color(0.240027, 0.008037, 84.591),
      accent: color(0.240027, 0.008037, 84.591),
      accentForeground: color(0.879498, 0.02983, 98.522),
      secondary: color(0.795123, 0.033185, 99.319),
      secondaryForeground: color(0.240027, 0.008037, 84.591),
      muted: color(0.795123, 0.033185, 99.319),
      mutedForeground: color(0.410968, 0.019508, 99.387),
      accentSurface: color(0.795123, 0.033185, 99.319),
      accentSurfaceForeground: color(0.240027, 0.008037, 84.591),
    },
    conversation: {
      message: {
        surface: color(0.804796, 0.031768, 98.954),
        foreground: color(0.240027, 0.008037, 84.591),
        action: color(0.240027, 0.008037, 84.591),
        actionForeground: color(0.879498, 0.02983, 98.522),
        actionHover: color(0.45239, 0.024062, 94.797),
      },
      code: {
        background: color(0.811064, 0.031713, 98.95),
        foreground: color(0.240027, 0.008037, 84.591),
      },
    },
    sidebar: {
      background: color(0.789073, 0.03191, 98.966),
      foreground: color(0.240027, 0.008037, 84.591),
      mutedForeground: color(0.410968, 0.019508, 99.387),
      control: color(0.760574, 0.032173, 98.988),
      hover: color(0.76693, 0.032113, 98.983),
      active: color(0.744626, 0.032325, 99.001),
      selected: color(0.735017, 0.032418, 99.009),
      border: color(0.654428, 0.029106, 97.8),
    },
    toolbar: {
      background: color(0.829796, 0.031549, 98.937),
      foreground: color(0.240027, 0.008037, 84.591),
      border: color(0.696768, 0.030071, 98.228),
      control: color(0.795123, 0.033185, 99.319),
      controlForeground: color(0.240027, 0.008037, 84.591),
      hover: color(0.76668, 0.033455, 99.341),
    },
    terminal: {
      background: color(0.829796, 0.031549, 98.937),
      foreground: color(0.240027, 0.008037, 84.591),
      cursor: color(0.240027, 0.008037, 84.591),
      selection: color(0.735017, 0.032418, 99.009),
      scrollbar: color(0.722662, 0.029828, 98.207),
      scrollbarHover: color(0.654137, 0.049535, 102.206),
    },
    status: {
      error: {
        color: color(0.497547, 0.127408, 31.25),
        foreground: color(0.367965, 0.094192, 30.26),
        surface: color(0.794341, 0.039978, 63.404),
      },
      warning: {
        color: color(0.490874, 0.073277, 94.478),
        foreground: color(0.432712, 0.066255, 94.854),
        surface: color(0.817106, 0.051792, 97.489),
      },
      update: {
        color: color(0.240027, 0.008037, 84.591),
        foreground: color(0.376351, 0.015839, 86.892),
        surface: color(0.779353, 0.033333, 99.331),
      },
      success: {
        color: color(0.444173, 0.053322, 148.192),
        foreground: color(0.352197, 0.046469, 149.794),
        surface: color(0.798875, 0.035219, 127.334),
      },
      info: {
        color: color(0.454461, 0.028526, 227.122),
        foreground: color(0.380317, 0.030406, 226.323),
        surface: color(0.805982, 0.011127, 189.761),
      },
    },
  },
};

export const AUTOMATA_OPERATOR_THEME: OperatorThemeDefinition = {
  schemaVersion: 1,
  id: "automata",
  label: "Automata",
  variants: { light: OPERATOR_THEME_PALETTES.automata },
};

export const PHOSPHOR_OPERATOR_THEME: OperatorThemeDefinition = {
  schemaVersion: 1,
  id: "phosphor",
  label: "Phosphor",
  variants: { dark: OPERATOR_THEME_PALETTES.phosphor },
};

export const SEQUEL_OPERATOR_THEME: OperatorThemeDefinition = {
  schemaVersion: 1,
  id: "sequel",
  label: "Sequel",
  variants: { dark: OPERATOR_THEME_PALETTES.sequel },
};

export const VESPER_OPERATOR_THEME: OperatorThemeDefinition = {
  schemaVersion: 1,
  id: "vesper",
  label: "Vesper",
  variants: { dark: OPERATOR_THEME_PALETTES.vesper },
};

export const OPERATOR_THEME_DEFINITIONS: readonly [
  OperatorThemeDefinition,
  OperatorThemeDefinition,
  OperatorThemeDefinition,
  OperatorThemeDefinition,
] = [AUTOMATA_OPERATOR_THEME, PHOSPHOR_OPERATOR_THEME, SEQUEL_OPERATOR_THEME, VESPER_OPERATOR_THEME];
