// Engine domain: developer tool types for Phase 9a (native runtime)

import type { ToolResultMetadata } from "./tool-result-metadata.js";

const OUTPUT_VERBOSITY_PROPERTY = {
  enum: ["raw", "structured", "summary"],
  description: "Controls ToolResult.output shape. raw preserves the compact default, structured returns JSON, summary returns a bounded rollup.",
} as const;

export type ToolInput = {
  readonly name: string;
  readonly input: Record<string, unknown>;
};

export type ToolResult = {
  readonly output: string;
  readonly isError: boolean;
  readonly metadata?: ToolResultMetadata;
  readonly content?: readonly ToolResultContentPart[];
};

export const DEV_TOOL_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    result: {
      type: "object",
      properties: {
        output: {
          type: "string",
          description: "Human-readable tool output. Shape depends on the tool and requested verbosity.",
        },
        isError: {
          type: "boolean",
          description: "True when the tool completed with a tool-level error result.",
        },
        metadata: {
          type: "object",
          description: "Audit and provenance metadata emitted by the tool.",
          additionalProperties: true,
        },
      },
      required: ["output", "isError"],
      additionalProperties: false,
    },
    attempts: {
      type: "number",
      description: "Number of execution attempts made by the bridge.",
    },
    fallbackUsed: {
      type: "boolean",
      description: "True when bridge-level fallback execution was used.",
    },
  },
  required: ["result", "attempts", "fallbackUsed"],
  additionalProperties: false,
} as const;

export type ToolResultContentPart =
  | {
    readonly type: "text";
    readonly text: string;
  }
  | {
    readonly type: "image";
    readonly data: string;
    readonly mimeType: string;
  };

export interface DevTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
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
  | "read_many"
  | "write"
  | "edit"
  | "patch"
  | "stat"
  | "tree"
  | "view_image"
  | "ocr_image"
  | "web_search"
  | "web_fetch"
  | "grep"
  | "glob"
  | "git"
  | "code_intelligence"
  | "monitor_start"
  | "monitor_read"
  | "monitor_stop"
  | "monitor_list"
  | "tool_catalog_search";

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
          "x-kiln-timeout-unit": "milliseconds",
        },
        cwd: {
          type: "string",
          description: "Optional working directory for the command.",
        },
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
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
  read_many: {
    name: "read_many",
    description: "Read a bounded deterministic packet of text files. Always pass a JSON object with paths and optional include, exclude, recursive, respectGitIgnore, useDefaultExcludes, maxFiles, maxBytes, or verbosity.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "Files or directories to include in the context packet.",
        },
        include: {
          type: "array",
          items: { type: "string" },
          description: "Optional glob patterns to include.",
        },
        exclude: {
          type: "array",
          items: { type: "string" },
          description: "Optional glob patterns to exclude.",
        },
        recursive: {
          type: "boolean",
          description: "When true, recursively expands directories. Defaults to false.",
        },
        respectGitIgnore: {
          type: "boolean",
          description: "When true, applies simple .gitignore path patterns from the workspace root.",
        },
        useDefaultExcludes: {
          type: "boolean",
          description: "When true, skips default nuisance directories such as .git, dist, build, coverage, and node_modules. Defaults to true.",
        },
        maxFiles: {
          type: "number",
          description: "Maximum files to include. Defaults to 50 and caps at 200.",
        },
        maxBytes: {
          type: "number",
          description: "Maximum bytes of text content to return across all files. Defaults to 262144.",
        },
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: ["paths"],
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
  patch: {
    name: "patch",
    description: "Apply a structured patch document to files. Always pass a JSON object with patch and optional dryRun.",
    inputSchema: {
      type: "object",
      properties: {
        patch: {
          type: "string",
          minLength: 1,
          description: "Structured patch document to apply.",
        },
        dryRun: {
          type: "boolean",
          description: "When true, validate and preview the patch without changing files.",
        },
      },
      required: ["patch"],
      additionalProperties: false,
    },
    annotations: {
      destructive: true,
    },
  },
  stat: {
    name: "stat",
    description: "Return file or directory metadata. Always pass a JSON object with path and optional hash.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          minLength: 1,
          description: "Path to inspect.",
        },
        hash: {
          enum: ["none", "sha256"],
          description: "Optional checksum mode. sha256 is only produced for files.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  tree: {
    name: "tree",
    description: "Return a compact directory tree. Always pass a JSON object with optional path, depth, and includeFiles.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Optional directory root. Defaults to the current workspace.",
        },
        depth: {
          type: "number",
          description: "Maximum directory depth to include. Defaults to 2.",
        },
        includeFiles: {
          type: "boolean",
          description: "When false, only directories are shown. Defaults to true.",
        },
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: [],
      additionalProperties: false,
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  view_image: {
    name: "view_image",
    description: "Read an image file and return model-consumable image content. Always pass a JSON object with path and optional detail.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          minLength: 1,
          description: "Path to the image file.",
        },
        detail: {
          enum: ["default", "original"],
          description: "default uses the normal image size cap; original allows larger original-resolution files.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  ocr_image: {
    name: "ocr_image",
    description: "Extract text from an image file using the configured OCR backend. Always pass a JSON object with path and optional language.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          minLength: 1,
          description: "Path to the image file.",
        },
        language: {
          type: "string",
          description: "OCR language code. Defaults to eng.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  web_search: {
    name: "web_search",
    description: "Search the web through the configured provider. Always pass a JSON object with query and optional domains, recencyDays, maxResults, or verbosity.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          description: "Search query.",
        },
        domains: {
          type: "array",
          items: { type: "string" },
          description: "Optional domain allowlist that narrows the active network policy.",
        },
        recencyDays: {
          type: "number",
          description: "Optional recency filter in days.",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of ranked results to return.",
        },
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  web_fetch: {
    name: "web_fetch",
    description: "Fetch and sanitize text content from an allowed HTTP(S) URL. Always pass a JSON object with url and optional maxBytes, timeout, or verbosity.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          minLength: 1,
          description: "HTTP or HTTPS URL to fetch.",
        },
        maxBytes: {
          type: "number",
          description: "Maximum response bytes to read before truncating.",
        },
        timeout: {
          type: "number",
          description: "Optional timeout in milliseconds.",
          "x-kiln-timeout-unit": "milliseconds",
        },
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: ["url"],
      additionalProperties: false,
    },
    annotations: {
      readOnly: true,
      idempotent: true,
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
          description: "Optional file or directory root for the search.",
        },
        glob: {
          type: "string",
          description: "Optional file glob filter such as **/*.ts.",
        },
        outputMode: {
          enum: ["content", "files_with_matches", "count"],
          description: "content returns matching lines, files_with_matches returns only file paths, count returns per-file counts.",
        },
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
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
          description: "Glob pattern to match, such as **/*.ts or docs/changelog.md.",
        },
        path: {
          type: "string",
          description: "Optional directory root for the glob search.",
        },
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
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
  code_intelligence: {
    name: "code_intelligence",
    description: "Query configured language-server adapters for definitions, references, hover, symbols, diagnostics, implementations, and call hierarchy.",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          enum: [
            "definition",
            "references",
            "hover",
            "document_symbols",
            "workspace_symbols",
            "diagnostics",
            "implementation",
            "call_hierarchy",
          ],
          description: "Semantic code operation to run.",
        },
        path: {
          type: "string",
          description: "Workspace file path for file-scoped and position-scoped operations.",
        },
        position: {
          type: "object",
          properties: {
            line: {
              type: "number",
              description: "Zero-based line number.",
            },
            character: {
              type: "number",
              description: "Zero-based UTF-16 character offset.",
            },
          },
          required: ["line", "character"],
          additionalProperties: false,
          description: "Zero-based source position for position-scoped operations.",
        },
        query: {
          type: "string",
          description: "Workspace symbol search query.",
        },
        symbol: {
          type: "string",
          description: "Optional symbol name used by symbol-scoped adapters.",
        },
        limit: {
          type: "number",
          description: "Maximum entries to return. Defaults to 50 and caps at 200.",
        },
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: ["operation"],
      additionalProperties: false,
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  monitor_start: {
    name: "monitor_start",
    description: "Start a monitored long-running shell command. Always pass a JSON object with command and optional cwd, name, timeout, or verbosity.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          minLength: 1,
          description: "Shell command to execute under monitor lifecycle ownership.",
        },
        cwd: {
          type: "string",
          description: "Optional working directory for the monitored command.",
        },
        name: {
          type: "string",
          description: "Optional human-readable monitor name.",
        },
        timeout: {
          type: "number",
          description: "Optional monitor timeout in milliseconds. The monitor is stopped when the timeout expires.",
          "x-kiln-timeout-unit": "milliseconds",
        },
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: ["command"],
      additionalProperties: false,
    },
    annotations: {
      destructive: true,
    },
  },
  monitor_read: {
    name: "monitor_read",
    description: "Read bounded output events from a monitored command. Always pass a JSON object with id and optional sinceSequence, limit, or verbosity.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          minLength: 1,
          description: "Monitor id returned by monitor_start.",
        },
        sinceSequence: {
          type: "number",
          description: "Return events with sequence numbers greater than this value.",
        },
        limit: {
          type: "number",
          description: "Maximum output events to return. Defaults to 100 and caps at 1000.",
        },
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  monitor_stop: {
    name: "monitor_stop",
    description: "Stop a monitored command by id. Always pass a JSON object with id and optional reason or verbosity.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          minLength: 1,
          description: "Monitor id returned by monitor_start.",
        },
        reason: {
          type: "string",
          description: "Optional stop reason recorded in lifecycle output.",
        },
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: {
      destructive: true,
    },
  },
  monitor_list: {
    name: "monitor_list",
    description: "List monitored command lifecycles. Always pass a JSON object with optional status or verbosity.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          enum: ["running", "exited", "stopped", "failed"],
          description: "Optional status filter.",
        },
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: [],
      additionalProperties: false,
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  tool_catalog_search: {
    name: "tool_catalog_search",
    description: "Search the shared Kiln tool catalog by exact name, prefix, tags, or lexical query. Use this before requesting hidden deferred tools.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Lexical search over tool names, descriptions, input fields, output fields, and tags.",
        },
        exact: {
          type: "string",
          description: "Exact tool name to resolve.",
        },
        prefix: {
          type: "string",
          description: "Tool name prefix to list, such as web_.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags that every returned tool must include.",
        },
        limit: {
          type: "number",
          description: "Maximum catalog entries to return. Defaults to 20 and caps at 50.",
        },
        includeSchemas: {
          type: "boolean",
          description: "When true, include cloned input and output schemas for matched tools.",
        },
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: [],
      additionalProperties: false,
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
};
