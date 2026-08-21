import {
  DEFAULT_OPERATOR_THEME_NAME,
  isOperatorThemeName,
  type OperatorThemeName,
  type OperatorThemeScope,
} from "@kilnai/gateway-contracts";
import { resolveGlobalUiTheme, type KilnGlobalConfig } from "../config/global-config.js";
import type { OperatorSurfaceThemeController } from "@kilnai/runtime";
import { applyConfigMutation, proposeConfigMutation } from "./config-mutation-authority.js";
import { ConfigMutationStore } from "./config-mutation-store.js";

export type OperatorThemePreference = OperatorThemeName;

export interface PersistOperatorThemeOptions {
  /** Project root that owns the governance records for this mutation. */
  readonly projectPath?: string;
}

export function parseOperatorThemePreference(theme: string | undefined): OperatorThemePreference | undefined {
  return isOperatorThemeName(theme) ? theme : undefined;
}

export function resolveGuiThemePreference(
  requestedTheme: string | undefined,
  globalConfig: KilnGlobalConfig | null,
): OperatorThemePreference {
  return (
    parseOperatorThemePreference(requestedTheme)
    ?? parseOperatorThemePreference(resolveGlobalUiTheme(globalConfig))
    ?? DEFAULT_OPERATOR_THEME_NAME
  );
}

export async function persistGuiThemePreference(
  theme: string,
  options?: PersistOperatorThemeOptions,
): Promise<void> {
  await persistOperatorThemePreference(theme, options);
}

export async function persistTuiThemePreference(
  theme: string,
  options?: PersistOperatorThemeOptions,
): Promise<void> {
  await persistOperatorThemePreference(theme, options);
}

/**
 * Persists the operator theme through the configuration mutation authority.
 *
 * The surface supplies intent only. Revision fencing, atomic replacement,
 * validation, and settlement belong to the authority, so no operator surface
 * writes the global configuration file itself.
 */
export async function persistOperatorThemePreference(
  theme: string,
  options?: PersistOperatorThemeOptions,
): Promise<void> {
  const resolvedTheme = parseOperatorThemePreference(theme);
  if (!resolvedTheme) {
    return;
  }
  const projectPath = options?.projectPath ?? process.cwd();
  const record = proposeConfigMutation({
    projectPath,
    operation: "setting.set",
    payload: { scope: "global", key: "ui.theme", value: resolvedTheme },
  });
  if (record.proposal.status !== "valid") {
    throw new Error(
      `Theme preference rejected: ${record.proposal.diagnostics.map((entry) => entry.message).join("; ")}`,
    );
  }
  new ConfigMutationStore(projectPath).saveProposal(record);
  const result = await applyConfigMutation({
    projectPath,
    proposalId: record.proposal.proposalId,
    requester: "operator",
  });
  if (result.settlement.outcome === "rejected") {
    throw new Error(
      `Theme preference rejected: ${result.settlement.diagnostics.map((entry) => entry.message).join("; ")}`,
    );
  }
}

export function createCliOperatorThemeController(): OperatorSurfaceThemeController {
  return {
    async setTheme(input: {
      readonly theme: string;
      readonly scope: OperatorThemeScope;
      readonly reason?: string;
    }): Promise<{ readonly ok: boolean; readonly appliedTheme?: string; readonly error?: string }> {
      const resolvedTheme = parseOperatorThemePreference(input.theme);
      if (!resolvedTheme) {
        return { ok: false, error: `Unknown operator theme '${input.theme}'.` };
      }
      if (input.scope !== "persisted") {
        return {
          ok: false,
          error: "The CLI has no live visual theme surface. Use scope='persisted' to update GUI and TUI defaults.",
        };
      }
      try {
        await persistOperatorThemePreference(resolvedTheme);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      return { ok: true, appliedTheme: resolvedTheme };
    },
  };
}
