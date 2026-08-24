import type { BorderBeamTheme } from "border-beam";
import type { KilnTheme } from "./ui-store.js";

export function resolveBorderBeamTheme(theme: KilnTheme): BorderBeamTheme {
  return theme === "automata" ? "light" : "dark";
}
