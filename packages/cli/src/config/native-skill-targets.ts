import { join } from "node:path";

export const NATIVE_SKILL_TARGETS = [
  {
    target: "claude" as const,
    displayName: "Claude Code",
    dir: (userHome: string) => join(userHome, ".claude", "skills"),
  },
  {
    target: "codex" as const,
    displayName: "Codex",
    dir: (userHome: string) => join(userHome, ".codex", "skills"),
  },
  {
    target: "opencode" as const,
    displayName: "OpenCode",
    dir: (userHome: string) => join(userHome, ".config", "opencode", "skills"),
  },
] as const;

export type NativeSkillTarget = typeof NATIVE_SKILL_TARGETS[number];
