import type {
  CommandShell,
  DangerousCommandDecision,
  DangerousCommandDetector,
  DangerousCommandRequest,
} from "../engine/domain/tool-execution.js";

const DOWNLOAD_EXEC_PATTERN =
  /\b(?:curl|wget|invoke-webrequest|iwr)\b[^\n|]*\|\s*(?:bash|sh|zsh|iex|invoke-expression)\b/i;

const UNIX_DESTRUCTIVE_PATTERN =
  /\brm\b\s+(?:(?:-[^\s]+\s+)*)\S+|\bsudo\s+(?:rm|dd|mkfs(?:\.\S+)?|shutdown|reboot)\b/i;

const WINDOWS_DESTRUCTIVE_PATTERN =
  /\b(?:cmd(?:\.exe)?\s+\/c\s+)?del(?:\.exe)?\b(?:\s+\/[a-z]+)*\s+\S+|\b(?:cmd(?:\.exe)?\s+\/c\s+)?(?:rd|rmdir)\b(?=[^\n;|]*\/s\b)[^\n;|]*|\b(?:remove-item|ri)\b(?=[^;\n|]*-(?:force|recurse))[^;\n|]*/i;

const AMBIGUOUS_EXPANSION_PATTERN = /\$\(|`[^`]*`|%\w+%|\${[^}]+}/;
const AMBIGUOUS_CHAINING_PATTERN = /&&|\|\||;|\n/;

const SAFE_READ_ONLY_PATTERNS: readonly RegExp[] = [
  /^\s*(?:ls|dir|pwd|whoami)\b[^\n|&;`$()]*$/i,
  /^\s*git\s+(?:status|diff|log)\b[^\n|&;`$()]*$/i,
  /^\s*(?:cat|type)\s+[^|&;`$()<>]+$/i,
  /^\s*(?:rg|fd|findstr)\b[^\n|&;`$()]*$/i,
];

function ask(reasonCode: DangerousCommandDecision["reasonCode"], reason: string): DangerousCommandDecision {
  return { action: "ask", reasonCode, reason };
}

function deny(reasonCode: DangerousCommandDecision["reasonCode"], reason: string): DangerousCommandDecision {
  return { action: "deny", reasonCode, reason };
}

function allow(reason: string): DangerousCommandDecision {
  return { action: "allow", reasonCode: "safe_read_only", reason };
}

function extractNestedShellCommand(command: string): string | null {
  const quotedMatch = command.match(/\b(?:bash|sh|zsh)\s+-l?c\s+(['"])([\s\S]*?)\1/i);
  if (quotedMatch?.[2]) return quotedMatch[2];
  const unquotedMatch = command.match(/\b(?:bash|sh|zsh)\s+-l?c\s+(.+)$/i);
  return unquotedMatch?.[1]?.trim() ?? null;
}

function inferShellFromCommand(command: string): CommandShell {
  const trimmed = command.trim();
  if (
    /^(?:cmd(?:\.exe)?\s+\/c|powershell(?:\.exe)?\b|pwsh(?:\.exe)?\b)/i.test(trimmed)
    || /^(?:del|rd|rmdir|remove-item|ri)\b/i.test(trimmed)
  ) {
    return "cmd";
  }
  if (/^(?:bash|sh|zsh)\b/i.test(trimmed)) {
    return "bash";
  }
  return "any";
}

function shouldCheckUnix(shell: CommandShell): boolean {
  return shell === "any" || shell === "bash" || shell === "sh" || shell === "zsh";
}

function shouldCheckWindows(shell: CommandShell): boolean {
  return shell === "any" || shell === "powershell" || shell === "cmd";
}

function normalizeShell(shell?: CommandShell): CommandShell {
  return shell ?? "any";
}

function evaluatePrimitive(command: string, shell: CommandShell): DangerousCommandDecision {
  if (DOWNLOAD_EXEC_PATTERN.test(command)) {
    return deny("download_execute", "Detected remote download-and-execute command pipeline.");
  }
  if (shouldCheckUnix(shell) && UNIX_DESTRUCTIVE_PATTERN.test(command)) {
    return deny("destructive_unix", "Detected destructive Unix command pattern.");
  }
  if (shouldCheckWindows(shell) && WINDOWS_DESTRUCTIVE_PATTERN.test(command)) {
    return deny("destructive_windows", "Detected destructive Windows command pattern.");
  }
  for (const pattern of SAFE_READ_ONLY_PATTERNS) {
    if (pattern.test(command)) {
      return allow("Command matches deterministic read-only allowlist.");
    }
  }
  if (AMBIGUOUS_EXPANSION_PATTERN.test(command)) {
    return ask("ambiguous_expansion", "Command contains shell expansion/substitution and requires approval.");
  }
  if (AMBIGUOUS_CHAINING_PATTERN.test(command)) {
    return ask("ambiguous_chaining", "Command contains chaining/control operators and requires approval.");
  }
  return ask("unknown_command", "Command is not in deterministic allowlist.");
}

export class DeterministicDangerousCommandDetector implements DangerousCommandDetector {
  evaluate(request: DangerousCommandRequest): DangerousCommandDecision {
    const command = request.command.trim();
    const shell = normalizeShell(request.shell);
    if (command.length === 0) {
      return ask("empty_command", "Command is empty.");
    }

    const nested = extractNestedShellCommand(command);
    if (nested !== null && nested.length > 0) {
      const nestedShell = inferShellFromCommand(nested);
      const nestedDecision = evaluatePrimitive(nested, nestedShell);
      if (nestedDecision.action === "deny") {
        return nestedDecision;
      }
      if (nestedDecision.action === "ask") {
        return ask(
          nestedDecision.reasonCode,
          `Nested shell command requires approval: ${nestedDecision.reason}`,
        );
      }
    }

    return evaluatePrimitive(command, shell);
  }
}
