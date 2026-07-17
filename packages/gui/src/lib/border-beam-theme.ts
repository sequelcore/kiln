import type { BorderBeamTheme } from "border-beam";
import { isDarkOperatorTheme } from "@kilnai/gateway-contracts";
import type { KilnTheme } from "./ui-store.js";

export function resolveBorderBeamTheme(theme: KilnTheme): BorderBeamTheme {
  if (theme === "system-follow") return "auto";
  return isDarkOperatorTheme(theme, false) ? "dark" : "light";
}
