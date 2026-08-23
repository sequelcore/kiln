import type {
  KilnConfigMutationScope,
  KilnSettingsProposalRequest,
  KilnSettingsSnapshot,
} from "@kilnai/gateway-contracts";

export type TuiSettingsMutationCommand =
  | {
      readonly kind: "set";
      readonly scope: KilnConfigMutationScope;
      readonly approve: boolean;
      readonly key: string;
      readonly value: string;
    }
  | {
      readonly kind: "reset";
      readonly scope: KilnConfigMutationScope;
      readonly approve: boolean;
      readonly key: string;
    };

export type TuiSettingsCommand =
  | { readonly kind: "search"; readonly query: string }
  | TuiSettingsMutationCommand
  | { readonly kind: "invalid"; readonly message: string };

export function parseSettingsCommand(raw: string): TuiSettingsCommand {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "search", query: "" };
  const tokens = trimmed.split(/\s+/u);
  const action = tokens[0];
  if (action !== "set" && action !== "reset") {
    return { kind: "search", query: trimmed };
  }
  let scope: KilnConfigMutationScope = "project";
  let approve = false;
  let operandStart = 1;
  while (operandStart < tokens.length && tokens[operandStart]?.startsWith("--")) {
    if (tokens[operandStart] === "--global") scope = "global";
    else if (tokens[operandStart] === "--approve") approve = true;
    else return { kind: "invalid", message: `Unknown settings flag: ${tokens[operandStart]}` };
    operandStart += 1;
  }
  const operands = tokens.slice(operandStart);
  const key = operands[0]?.trim();
  if (!key) {
    return { kind: "invalid", message: `Usage: /settings ${action} [--global] [--approve] <key>${action === "set" ? " <value>" : ""}` };
  }
  if (action === "reset") return { kind: "reset", scope, approve, key };
  const value = operands.slice(1).join(" ");
  if (!value) {
    return { kind: "invalid", message: "Usage: /settings set [--global] [--approve] <key> <value>" };
  }
  return { kind: "set", scope, approve, key, value };
}

export function buildSettingsProposalRequest(
  command: TuiSettingsMutationCommand,
  revisions: Pick<KilnSettingsSnapshot["revisions"], "global" | "project">,
): KilnSettingsProposalRequest {
  const expectedRevision = revisions[command.scope] ?? "absent";
  return command.kind === "set"
    ? {
        operation: "setting.set",
        scope: command.scope,
        key: command.key,
        expectedRevision,
        value: command.value,
      }
    : {
        operation: "setting.reset",
        scope: command.scope,
        key: command.key,
        expectedRevision,
      };
}
