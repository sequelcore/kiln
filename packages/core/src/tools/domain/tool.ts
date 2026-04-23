// Engine domain: developer tool types for Phase 9a (native runtime)

export type ToolInput = {
  readonly name: string;
  readonly input: Record<string, unknown>;
};

export type ToolResult = {
  readonly output: string;
  readonly isError: boolean;
  readonly metadata?: Record<string, unknown>;
};

export interface DevTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations?: DevToolAnnotations;
  execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult>;
}

export interface DevToolAnnotations {
  readonly readOnly?: boolean;
  readonly destructive?: boolean;
  readonly idempotent?: boolean;
}

export type DevToolName =
  | "bash"
  | "read"
  | "write"
  | "edit"
  | "grep"
  | "glob"
  | "git";

export const TOOL_SCHEMAS: Record<
  DevToolName,
  {
    name: DevToolName;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations: DevToolAnnotations;
  }
> = {
  bash: {
    name: "bash",
    description: "Run a shell command in the current workspace. Always pass a JSON object with a non-empty command string.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          minLength: 1,
          description: "Shell command to execute.",
        },
        timeout: {
          type: "number",
          description: "Optional timeout in milliseconds.",
        },
        cwd: {
          type: "string",
          description: "Optional working directory for the command.",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
    annotations: {
      destructive: true,
    },
  },
  read: {
    name: "read",
    description: "Read file content from disk. Always pass a JSON object with filePath and optional offset or limit.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          minLength: 1,
          description: "Path to the file to read.",
        },
        offset: { type: "number", description: "Line offset to start reading from (0-based)" },
        limit: { type: "number", description: "Maximum number of lines to read" },
      },
      required: ["filePath"],
      additionalProperties: false,
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  write: {
    name: "write",
    description: "Write full content to a file. Always pass a JSON object with filePath and content.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          minLength: 1,
          description: "Path to the file to create or replace.",
        },
        content: {
          type: "string",
          description: "Complete file contents to write.",
        },
      },
      required: ["filePath", "content"],
      additionalProperties: false,
    },
    annotations: {
      destructive: true,
    },
  },
  edit: {
    name: "edit",
    description: "Replace text content in a file. Always pass a JSON object with filePath, oldString, and newString.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          minLength: 1,
          description: "Path to the file to edit.",
        },
        oldString: {
          type: "string",
          description: "Exact text to replace.",
        },
        newString: {
          type: "string",
          description: "Replacement text.",
        },
        replaceAll: {
          type: "boolean",
          description: "When true, replace every match instead of only the first.",
        },
      },
      required: ["filePath", "oldString", "newString"],
      additionalProperties: false,
    },
    annotations: {
      destructive: false,
    },
  },
  grep: {
    name: "grep",
    description: "Search file content by pattern. Always pass a JSON object with a non-empty pattern string and optional path, glob, or outputMode.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          minLength: 1,
          description: "Regular expression pattern to search for.",
        },
        path: {
          type: "string",
          description: "Optional directory root for the search.",
        },
        glob: {
          type: "string",
          description: "Optional file glob filter such as **/*.ts.",
        },
        outputMode: {
          enum: ["content", "files_with_matches", "count"],
          description: "content returns matching lines, files_with_matches returns only file paths, count returns per-file counts.",
        },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  glob: {
    name: "glob",
    description: "Match files by glob pattern. Always pass a JSON object with a non-empty pattern string and optional path.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          minLength: 1,
          description: "Glob pattern to match, such as **/*.ts or kiln-context.md.",
        },
        path: {
          type: "string",
          description: "Optional directory root for the glob search.",
        },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  git: {
    name: "git",
    description: "Run a git subcommand. Always pass a JSON object with a non-empty subcommand string and optional args array.",
    inputSchema: {
      type: "object",
      properties: {
        subcommand: {
          type: "string",
          minLength: 1,
          description: "Git subcommand to run, such as status, diff, or show.",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Optional additional git arguments.",
        },
      },
      required: ["subcommand"],
      additionalProperties: false,
    },
    annotations: {
      destructive: false,
    },
  },
};
