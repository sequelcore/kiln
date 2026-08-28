import type {
  CommandShell,
  DangerousCommandDecision,
  DangerousCommandDetector,
  DangerousCommandRequest,
} from "../engine/domain/tool-execution.js";

const DOWNLOAD_COMMANDS = ["curl", "wget", "invoke-webrequest", "iwr"] as const;
const EXECUTION_COMMANDS = ["bash", "sh", "zsh", "iex", "invoke-expression"] as const;

function isAsciiWordCharacter(character: string | undefined): boolean {
  if (character === undefined) return false;
  const code = character.charCodeAt(0);
  return (
    (code >= 48 && code <= 57)
    || (code >= 65 && code <= 90)
    || code === 95
    || (code >= 97 && code <= 122)
  );
}

function containsDelimitedWord(value: string, word: string): boolean {
  const normalized = value.toLowerCase();
  let index = normalized.indexOf(word);
  while (index >= 0) {
    const before = normalized[index - 1];
    const after = normalized[index + word.length];
    if (!isAsciiWordCharacter(before) && !isAsciiWordCharacter(after)) {
      return true;
    }
    index = normalized.indexOf(word, index + 1);
  }
  return false;
}

function containsDownloadCommand(segment: string): boolean {
  return DOWNLOAD_COMMANDS.some((command) => containsDelimitedWord(segment, command));
}

function startsWithDelimitedWord(value: string, word: string): boolean {
  const normalized = value.trimStart().toLowerCase();
  return normalized.startsWith(word) && !isAsciiWordCharacter(normalized[word.length]);
}

function startsWithExecutionCommand(segment: string): boolean {
  return EXECUTION_COMMANDS.some((command) => startsWithDelimitedWord(segment, command));
}

function isDownloadExecutePipeline(command: string): boolean {
  for (const line of command.split("\n")) {
    const segments = line.split("|");
    for (let index = 0; index < segments.length - 1; index += 1) {
      const left = segments[index] ?? "";
      const right = segments[index + 1] ?? "";
      if (!containsDownloadCommand(left)) {
        continue;
      }
      if (startsWithExecutionCommand(right)) {
        return true;
      }
    }
  }
  return false;
}

const UNIX_DESTRUCTIVE_PATTERN =
  /\brm\b\s+(?:(?:-[^\s]+\s+)*)\S+|\bsudo\s+(?:rm|dd|mkfs(?:\.\S+)?|shutdown|reboot)\b/i;

const WINDOWS_DESTRUCTIVE_PATTERN =
  /\b(?:cmd(?:\.exe)?\s+\/c\s+)?del(?:\.exe)?\b(?:\s+\/[a-z]+)*\s+\S+|\b(?:cmd(?:\.exe)?\s+\/c\s+)?(?:rd|rmdir)\b(?=[^\n;|]*\/s\b)[^\n;|]*|\b(?:remove-item|ri)\b(?=[^;\n|]*-(?:force|recurse))[^;\n|]*/i;

const AMBIGUOUS_EXPANSION_PATTERN = /\$\(|`[^`]*`|%\w+%|\${[^}]+}/;
const AMBIGUOUS_CHAINING_PATTERN = /&&|\|\||\||;|\n/;

const SAFE_READ_ONLY_PATTERNS: readonly RegExp[] = [
  /^\s*(?:ls|dir|pwd|whoami)\b[^\n|&;`$()]*$/i,
  /^\s*git\s+(?:status|diff|log|show|rev-parse|ls-files)\b[^\n|&;`$()]*$/i,
  /^\s*(?:cat|type)\s+[^|&;`$()<>]+$/i,
  /^\s*(?:rg|grep|fd|findstr)\b[^\n|&;`$()<>]*$/i,
  /^\s*(?:head|tail|wc)\b[^\n|&;`$()<>]*$/i,
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
  if (isDownloadExecutePipeline(command)) {
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
