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
    description: "Run a shell command.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout: { type: "number" },
        cwd: { type: "string" },
      },
      required: ["command"],
    },
    annotations: {
      destructive: true,
    },
  },
  read: {
    name: "read",
    description: "Read file content from disk.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        offset: { type: "number", description: "Line offset to start reading from (0-based)" },
        limit: { type: "number", description: "Maximum number of lines to read" },
      },
      required: ["filePath"],
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  write: {
    name: "write",
    description: "Write full content to a file.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        content: { type: "string" },
      },
      required: ["filePath", "content"],
    },
    annotations: {
      destructive: true,
    },
  },
  edit: {
    name: "edit",
    description: "Replace text content in a file.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        oldString: { type: "string" },
        newString: { type: "string" },
        replaceAll: { type: "boolean" },
      },
      required: ["filePath", "oldString", "newString"],
    },
    annotations: {
      destructive: false,
    },
  },
  grep: {
    name: "grep",
    description: "Search file content by pattern.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        glob: { type: "string" },
        outputMode: {
          enum: ["content", "files_with_matches", "count"],
        },
      },
      required: ["pattern"],
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  glob: {
    name: "glob",
    description: "Match files by glob pattern.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
      },
      required: ["pattern"],
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  git: {
    name: "git",
    description: "Run a git subcommand.",
    inputSchema: {
      type: "object",
      properties: {
        subcommand: { type: "string" },
        args: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["subcommand"],
    },
    annotations: {
      destructive: false,
    },
  },
};
