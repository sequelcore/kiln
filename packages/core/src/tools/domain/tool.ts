// Engine domain: developer tool types for Phase 9a (native runtime)

import {
  FORMAL_VERIFICATION_FINISH_TRANSPORT,
  type FormalVerificationFinishTransportEnvelope,
} from "./formal-verification-finish-transport.js";
import {
  OPERATOR_ADOPTION_DECISION_TRANSPORT,
  type OperatorAdoptionDecisionTransport,
} from "./operator-adoption-decision-transport.js";
import type { ToolResultMetadata } from "./tool-result-metadata.js";

const OUTPUT_VERBOSITY_PROPERTY = {
  type: "string",
  enum: ["raw", "structured", "summary"],
  description:
    "Controls ToolResult.output shape. raw preserves the compact default, structured returns JSON, summary returns a bounded rollup.",
} as const;

const INTERACTIVE_SESSION_ID_PROPERTY = {
  type: "string",
  description: "Optional interactive-use session id. When omitted, the provider may use the active or default session.",
} as const;

const INTERACTIVE_TARGET_PROPERTY = {
  type: "object",
  properties: {
    ref: { type: "string", description: "Provider-issued stable element reference." },
    selector: {
      type: "string",
      description:
        'CSS, UIA, or provider-supported selector. Windows UIA supports forms such as #automationId, type=button;title=OK, or JSON {"type":"button","title":"OK"}.',
    },
    x: { type: "number", description: "Viewport or screen X coordinate." },
    y: { type: "number", description: "Viewport or screen Y coordinate." },
  },
  additionalProperties: false,
  description: "Optional target reference. Prefer provider refs, then selectors, then coordinates.",
} as const;

const INTERACTIVE_TIMEOUT_PROPERTY = {
  type: "number",
  description: "Optional provider timeout in milliseconds.",
  "x-kiln-timeout-unit": "milliseconds",
} as const;

const TEMPORAL_EVENT_REQUIREMENT_PROPERTY = {
  type: "object",
  description:
    "Required for exact-date event claims. Demands semantic consensus from at least two independent sources.",
  properties: {
    exactLocalDate: { type: "string", description: "Operator-local event date in YYYY-MM-DD form." },
    requiredIdentityTerms: {
      type: "array",
      items: { type: "string" },
      minItems: 2,
      description: "At least two unambiguous event identity terms, such as both participants.",
    },
    eventStatus: { type: "string", enum: ["completed"] },
    minimumIndependentSources: { type: "number", minimum: 2 },
  },
  required: ["exactLocalDate", "requiredIdentityTerms", "eventStatus", "minimumIndependentSources"],
  additionalProperties: false,
} as const;

const COMPUTER_APPLICATION_PROPERTY = {
  type: "string",
  description:
    "Target application name from interactiveUse.allowedApplications. Prefer this over relying on the active window.",
} as const;

const COMPUTER_WINDOW_TITLE_PROPERTY = {
  type: "string",
  description: "Optional target window title filter. Used with application when multiple windows exist.",
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
  readonly resourcePayload?: ToolResultResourcePayload;
};

export interface ToolExecutionOutputDelta {
  readonly stream: "stdout" | "stderr";
  readonly delta: string;
}

export interface DevToolExecutionContext {
  readonly abortSignal?: AbortSignal;
  readonly onOutput?: (delta: ToolExecutionOutputDelta) => void;
  /** Internal Runtime authority transport; never model input or serialized context. */
  readonly [FORMAL_VERIFICATION_FINISH_TRANSPORT]?: FormalVerificationFinishTransportEnvelope;
  readonly [OPERATOR_ADOPTION_DECISION_TRANSPORT]?: OperatorAdoptionDecisionTransport;
}

export type ToolResultResourcePayload = {
  readonly text: string;
  readonly mimeType: string;
  readonly title?: string;
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
    }
  | {
      readonly type: "resource_link";
      readonly uri: string;
      readonly name: string;
      readonly description?: string;
      readonly mimeType?: string;
      readonly size?: number;
      readonly annotations?: Record<string, unknown>;
    };

export interface DevTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly effectEnvelope?: import("../../engine/domain/action-effect.js").ActionEffectEnvelope;
  execute(input: ToolInput, sandbox?: unknown, context?: DevToolExecutionContext): Promise<ToolResult>;
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
  | "web_extract"
  | "browser_session_start"
  | "browser_navigate"
  | "browser_observe"
  | "browser_click"
  | "browser_type"
  | "browser_keypress"
  | "browser_scroll"
  | "browser_session_stop"
  | "computer_observe"
  | "computer_click"
  | "computer_type"
  | "computer_keypress"
  | "computer_open_application"
  | "computer_focus_application"
  | "computer_minimize_application"
  | "computer_close_application"
  | "grep"
  | "glob"
  | "json_query"
  | "git"
  | "code_intelligence"
  | "monitor_start"
  | "monitor_read"
  | "monitor_stop"
  | "monitor_list"
  | "task_list"
  | "task_update"
  | "operator_elicit"
  | "tool_catalog_search"
  | "memory_search"
  | "memory_save"
  | "resource_list"
  | "resource_template_list"
  | "resource_read"
  | "formal_verify"
  | "static_analyze"
  | "quality_analyze"
  | "gentle_review";

export const TOOL_SCHEMAS: Record<
  DevToolName,
  {
    name: DevToolName;
    description: string;
    inputSchema: Record<string, unknown>;
  }
> = {
  bash: {
    name: "bash",
    description:
      "Run a Bash shell command in the current workspace when no purpose-built tool exists. Always pass a JSON object with a non-empty command string. Use the git tool for Git subcommands instead of bash.",
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
  },
  read_many: {
    name: "read_many",
    description:
      "Read a bounded deterministic packet of text files. Always pass a JSON object with paths and optional include, exclude, recursive, respectGitIgnore, useDefaultExcludes, maxFiles, maxBytes, or verbosity.",
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
          description:
            "When true, skips default nuisance directories such as .git, dist, build, coverage, and node_modules. Defaults to true.",
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
  },
  patch: {
    name: "patch",
    description:
      "Apply a structured patch document to files. Always pass a JSON object with patch and optional dryRun.",
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
          type: "string",
          enum: ["none", "sha256"],
          description: "Optional checksum mode. sha256 is only produced for files.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  tree: {
    name: "tree",
    description:
      "Return a compact directory tree. Always pass a JSON object with optional path, depth, and includeFiles.",
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
  },
  view_image: {
    name: "view_image",
    description:
      "Read an image file and return model-consumable image content. Always pass a JSON object with path and optional detail.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          minLength: 1,
          description: "Path to the image file.",
        },
        detail: {
          type: "string",
          enum: ["default", "original"],
          description: "default uses the normal image size cap; original allows larger original-resolution files.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  ocr_image: {
    name: "ocr_image",
    description:
      "Extract text from an image file using the configured OCR backend. Always pass a JSON object with path and optional language.",
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
  },
  web_search: {
    name: "web_search",
    description:
      "Search the web through the configured provider. For exact-date events, begin with broad discovery, pass temporalRequirement, broaden once if evidence is insufficient, then extract strong candidates. The tool fails closed unless independent sources agree on date, identities, and completed status. Publication freshness is not event-date evidence.",
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
          description:
            "Optional hard domain allowlist that narrows the active network policy. Use only when the operator or source-authority policy requires these domains; do not invent a discovery shortlist.",
        },
        recencyDays: {
          type: "number",
          description: "Optional publication-recency filter in days. This does not verify when an event occurred.",
        },
        freshnessRequired: {
          type: "boolean",
          description:
            "When true, reject unless the provider enforces publication recency. Do not enable solely because an event date is recent; temporalRequirement verifies the event date.",
        },
        topic: {
          type: "string",
          enum: ["general", "news", "finance", "research"],
          description:
            "Provider-neutral search topic. Exact-date event discovery defaults to general so fixture, result, and official pages are not excluded.",
        },
        quality: {
          type: "string",
          enum: ["balanced", "high"],
          description: "Provider-neutral retrieval quality. High requires a provider with high-precision search.",
        },
        startDate: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description:
            "Optional inclusive publication start date in YYYY-MM-DD format. Never copy an event date here unless publication on that date is itself required.",
        },
        endDate: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description:
            "Optional inclusive publication end date in YYYY-MM-DD format. Never copy an event date here unless publication on that date is itself required.",
        },
        country: {
          type: "string",
          pattern: "^[A-Za-z]{2}$",
          description: "Optional provider-neutral country targeting code.",
        },
        language: {
          type: "string",
          description: "Optional provider-neutral language targeting code.",
        },
        targetingRequired: {
          type: "boolean",
          description:
            "When true, country and language targeting are hard requirements. Otherwise unsupported targeting is omitted and audited as a preference.",
        },
        exactPhrases: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 10,
          description:
            "Optional literal phrases that the selected provider must enforce. Do not use for ordinary entity names already present in the query.",
        },
        temporalRequirement: TEMPORAL_EVENT_REQUIREMENT_PROPERTY,
        maxResults: {
          type: "number",
          description: "Maximum number of ranked results to return.",
        },
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  web_fetch: {
    name: "web_fetch",
    description:
      "Fetch and sanitize text content from an allowed HTTP(S) URL. Always pass a JSON object with url and optional maxBytes, timeout, or verbosity.",
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
  },
  web_extract: {
    name: "web_extract",
    description:
      "Extract readable text or markdown from one or more allowed HTTP(S) URLs. For exact-date event claims, pass temporalRequirement to verify full page contents from independent sources.",
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string", minLength: 1 },
          minItems: 1,
          maxItems: 10,
          description: "HTTP or HTTPS URLs to extract.",
        },
        format: {
          type: "string",
          enum: ["text", "markdown"],
          description: "Requested extracted content format. Defaults to markdown.",
        },
        maxBytes: {
          type: "number",
          description: "Maximum bytes to keep per extracted page.",
        },
        timeout: INTERACTIVE_TIMEOUT_PROPERTY,
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: ["urls"],
      additionalProperties: false,
    },
  },
  browser_session_start: {
    name: "browser_session_start",
    description:
      "Start or attach to a governed browser automation session. Always pass a JSON object with optional sessionId, url, viewport, allowedDomains, recordArtifacts, timeout, or verbosity. Set recordArtifacts=true when the user asks for a QA/showcase video, recording, captions, or editor-ready artifacts. Providers attach to an existing sessionId or active session instead of opening duplicate browser sessions.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: INTERACTIVE_SESSION_ID_PROPERTY,
        url: { type: "string", description: "Optional initial HTTP(S) URL." },
        viewport: {
          type: "object",
          properties: {
            width: { type: "number" },
            height: { type: "number" },
          },
          required: ["width", "height"],
          additionalProperties: false,
          description: "Optional browser viewport size.",
        },
        allowedDomains: {
          type: "array",
          items: { type: "string" },
          description: "Optional per-session domain allowlist narrowed by runtime policy.",
        },
        recordArtifacts: {
          type: "boolean",
          description:
            "When true, request recorder capture, rendered video, captions, and editor-ready artifacts from the provider.",
        },
        headless: {
          type: "boolean",
          description:
            "When false, request a visible browser window from providers that support it. Defaults to provider policy.",
        },
        timeout: INTERACTIVE_TIMEOUT_PROPERTY,
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: [],
      additionalProperties: false,
    },
  },
  browser_navigate: {
    name: "browser_navigate",
    description: "Navigate a governed browser session to an allowed HTTP(S) URL.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: INTERACTIVE_SESSION_ID_PROPERTY,
        url: { type: "string", minLength: 1, description: "HTTP(S) URL to open." },
        timeout: {
          type: "number",
          description: "Optional provider timeout in milliseconds.",
          "x-kiln-timeout-unit": "milliseconds",
        },
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  browser_observe: {
    name: "browser_observe",
    description:
      "Capture the current governed browser observation with optional screenshot, DOM, accessibility, console, and network artifact links.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: INTERACTIVE_SESSION_ID_PROPERTY,
        includeScreenshot: { type: "boolean" },
        includeDom: { type: "boolean" },
        includeAccessibility: { type: "boolean" },
        includeConsole: { type: "boolean" },
        includeNetwork: { type: "boolean" },
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: [],
      additionalProperties: false,
    },
  },
  browser_click: {
    name: "browser_click",
    description: "Click in a governed browser session by provider ref, selector, or coordinates.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: INTERACTIVE_SESSION_ID_PROPERTY,
        target: INTERACTIVE_TARGET_PROPERTY,
        button: { type: "string", enum: ["left", "middle", "right"], description: "Mouse button. Defaults to left." },
        clickCount: { type: "number", description: "Number of clicks. Defaults to 1." },
        requiresApproval: { type: "boolean", description: "True when the click may be consequential." },
        timeout: INTERACTIVE_TIMEOUT_PROPERTY,
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: [],
      additionalProperties: false,
    },
  },
  browser_type: {
    name: "browser_type",
    description: "Type text in a governed browser session. Sensitive text is never echoed in metadata.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: INTERACTIVE_SESSION_ID_PROPERTY,
        target: INTERACTIVE_TARGET_PROPERTY,
        text: { type: "string", description: "Text to type." },
        sensitive: { type: "boolean", description: "True for credentials, tokens, or private values." },
        requiresApproval: { type: "boolean", description: "True when typing may be consequential." },
        timeout: INTERACTIVE_TIMEOUT_PROPERTY,
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  browser_keypress: {
    name: "browser_keypress",
    description: "Send keyboard keys to a governed browser session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: INTERACTIVE_SESSION_ID_PROPERTY,
        keys: { type: "array", items: { type: "string" }, minItems: 1 },
        requiresApproval: { type: "boolean" },
        timeout: INTERACTIVE_TIMEOUT_PROPERTY,
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: ["keys"],
      additionalProperties: false,
    },
  },
  browser_scroll: {
    name: "browser_scroll",
    description: "Scroll a governed browser session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: INTERACTIVE_SESSION_ID_PROPERTY,
        direction: { type: "string", enum: ["up", "down", "left", "right"], description: "Scroll direction." },
        deltaX: { type: "number" },
        deltaY: { type: "number" },
        timeout: INTERACTIVE_TIMEOUT_PROPERTY,
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: [],
      additionalProperties: false,
    },
  },
  browser_session_stop: {
    name: "browser_session_stop",
    description:
      "Stop a governed browser automation session and finalize artifacts. When the session was started with recordArtifacts=true, this returns recorder proof, rendered video, captions, and editor-ready artifact links. Prefer explicit cleanup before the final answer for one-off browser tasks.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: INTERACTIVE_SESSION_ID_PROPERTY,
        reason: { type: "string" },
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: [],
      additionalProperties: false,
    },
  },
  computer_observe: {
    name: "computer_observe",
    description: "Capture a governed computer observation for an allowed application or window.",
    inputSchema: {
      type: "object",
      properties: {
        windowTitle: COMPUTER_WINDOW_TITLE_PROPERTY,
        application: COMPUTER_APPLICATION_PROPERTY,
        includeScreenshot: { type: "boolean" },
        includeAccessibility: { type: "boolean" },
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: [],
      additionalProperties: false,
    },
  },
  computer_click: {
    name: "computer_click",
    description: "Click an allowed computer target by accessibility ref, semantic selector, or screen coordinates.",
    inputSchema: {
      type: "object",
      properties: {
        windowTitle: COMPUTER_WINDOW_TITLE_PROPERTY,
        application: COMPUTER_APPLICATION_PROPERTY,
        target: INTERACTIVE_TARGET_PROPERTY,
        button: { type: "string", enum: ["left", "middle", "right"] },
        clickCount: { type: "number" },
        requiresApproval: { type: "boolean" },
        timeout: INTERACTIVE_TIMEOUT_PROPERTY,
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: [],
      additionalProperties: false,
    },
  },
  computer_type: {
    name: "computer_type",
    description: "Type text into an allowed computer target. Sensitive text is never echoed in metadata.",
    inputSchema: {
      type: "object",
      properties: {
        windowTitle: COMPUTER_WINDOW_TITLE_PROPERTY,
        application: COMPUTER_APPLICATION_PROPERTY,
        target: INTERACTIVE_TARGET_PROPERTY,
        text: { type: "string", description: "Text to type." },
        sensitive: { type: "boolean" },
        requiresApproval: { type: "boolean" },
        timeout: INTERACTIVE_TIMEOUT_PROPERTY,
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  computer_keypress: {
    name: "computer_keypress",
    description: "Send keyboard keys to an allowed computer target.",
    inputSchema: {
      type: "object",
      properties: {
        windowTitle: COMPUTER_WINDOW_TITLE_PROPERTY,
        application: COMPUTER_APPLICATION_PROPERTY,
        keys: { type: "array", items: { type: "string" }, minItems: 1 },
        requiresApproval: { type: "boolean" },
        timeout: INTERACTIVE_TIMEOUT_PROPERTY,
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: ["keys"],
      additionalProperties: false,
    },
  },
  computer_open_application: {
    name: "computer_open_application",
    description: "Open or launch an allowed desktop application, then return an observation of the resulting window.",
    inputSchema: {
      type: "object",
      properties: {
        application: COMPUTER_APPLICATION_PROPERTY,
        windowTitle: COMPUTER_WINDOW_TITLE_PROPERTY,
        timeout: INTERACTIVE_TIMEOUT_PROPERTY,
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: ["application"],
      additionalProperties: false,
    },
  },
  computer_focus_application: {
    name: "computer_focus_application",
    description: "Bring an allowed desktop application or window to the foreground before computer use.",
    inputSchema: {
      type: "object",
      properties: {
        application: COMPUTER_APPLICATION_PROPERTY,
        windowTitle: COMPUTER_WINDOW_TITLE_PROPERTY,
        timeout: INTERACTIVE_TIMEOUT_PROPERTY,
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: ["application"],
      additionalProperties: false,
    },
  },
  computer_minimize_application: {
    name: "computer_minimize_application",
    description: "Minimize an allowed desktop application or window after computer use.",
    inputSchema: {
      type: "object",
      properties: {
        application: COMPUTER_APPLICATION_PROPERTY,
        windowTitle: COMPUTER_WINDOW_TITLE_PROPERTY,
        timeout: INTERACTIVE_TIMEOUT_PROPERTY,
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: ["application"],
      additionalProperties: false,
    },
  },
  computer_close_application: {
    name: "computer_close_application",
    description:
      "Gracefully close an allowed desktop application or window. Providers should avoid force-kill behavior unless a separate explicit policy allows it.",
    inputSchema: {
      type: "object",
      properties: {
        application: COMPUTER_APPLICATION_PROPERTY,
        windowTitle: COMPUTER_WINDOW_TITLE_PROPERTY,
        timeout: INTERACTIVE_TIMEOUT_PROPERTY,
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: ["application"],
      additionalProperties: false,
    },
  },
  grep: {
    name: "grep",
    description:
      "Search file content by pattern. Always pass a JSON object with a non-empty pattern string and optional path, glob, outputMode, or maxResults.",
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
          type: "string",
          enum: ["content", "files_with_matches", "count"],
          description:
            "content returns matching lines, files_with_matches returns only file paths, count returns per-file counts.",
        },
        temporalRequirement: TEMPORAL_EVENT_REQUIREMENT_PROPERTY,
        matchMode: {
          type: "string",
          enum: ["auto", "regex", "literal"],
          description:
            "auto treats valid patterns as regular expressions and falls back to literal matching for invalid regex syntax; regex is strict; literal searches fixed strings.",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of returned result lines. Defaults to 200 and is capped at 1000.",
        },
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  glob: {
    name: "glob",
    description:
      "Match files by glob pattern. Always pass a JSON object with a non-empty pattern string and optional path. Brace alternates such as **/*.{ts,tsx,css} are supported.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          minLength: 1,
          description: "Glob pattern to match, such as **/*.ts, **/*.{ts,tsx,css}, or docs/changelog.md.",
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
  },
  json_query: {
    name: "json_query",
    description:
      "Query JSON data with jq. Always pass a JSON object with a non-empty filter and exactly one source: inline json or a file path.",
    inputSchema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          minLength: 1,
          description: "jq filter expression to apply.",
        },
        json: {
          type: "string",
          description: "Inline JSON input. Mutually exclusive with path.",
        },
        path: {
          type: "string",
          description: "Path to a JSON file. Mutually exclusive with json.",
        },
        maxBytes: {
          type: "number",
          description: "Maximum output bytes to return. Defaults to 262144 and caps at 1048576.",
        },
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: ["filter"],
      additionalProperties: false,
    },
  },
  git: {
    name: "git",
    description:
      "Run a read-only git inspection subcommand. Always pass a JSON object with a non-empty subcommand string and optional args array. Mutating subcommands such as add, checkout, commit, reset, push, and pull are denied.",
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
  },
  code_intelligence: {
    name: "code_intelligence",
    description:
      "Query configured language-server adapters for definitions, references, hover, symbols, diagnostics, implementations, and call hierarchy.",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
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
  },
  monitor_start: {
    name: "monitor_start",
    description:
      "Start a monitored long-running shell command. Always pass a JSON object with command and optional cwd, name, timeout, or verbosity.",
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
  },
  monitor_read: {
    name: "monitor_read",
    description:
      "Read bounded output events from a monitored command. Always pass a JSON object with id and optional sinceSequence, limit, or verbosity.",
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
  },
  monitor_list: {
    name: "monitor_list",
    description: "List monitored command lifecycles. Always pass a JSON object with optional status or verbosity.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["running", "exited", "stopped", "failed"],
          description: "Optional status filter.",
        },
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: [],
      additionalProperties: false,
    },
  },
  task_list: {
    name: "task_list",
    description: "List shared session-local task state. Always pass a JSON object with optional status or verbosity.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "in_progress", "blocked", "completed", "cancelled"],
          description: "Optional task status filter.",
        },
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: [],
      additionalProperties: false,
    },
  },
  task_update: {
    name: "task_update",
    description:
      "Create or update shared session-local task state. Always pass a JSON object with title, status, and optional id, details, dependsOn, or verbosity.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Optional stable task id. When omitted, Kiln assigns one.",
        },
        title: {
          type: "string",
          minLength: 1,
          description: "Task title shown to shared operator surfaces.",
        },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "blocked", "completed", "cancelled"],
          description: "Task lifecycle status.",
        },
        details: {
          type: "string",
          description: "Optional short task details.",
        },
        dependsOn: {
          type: "array",
          items: { type: "string" },
          description: "Optional dependency task ids.",
        },
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: ["title", "status"],
      additionalProperties: false,
    },
  },
  operator_elicit: {
    name: "operator_elicit",
    description:
      "Ask the operator for bounded input through a consumer-provided elicitation surface. Use URL mode for sensitive handoffs.",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["form", "url"],
          description:
            "Elicitation mode. form collects bounded non-sensitive values; url hands the operator to an HTTPS surface.",
        },
        message: {
          type: "string",
          minLength: 1,
          description: "Prompt shown to the operator.",
        },
        schema: {
          type: "object",
          description: "Optional JSON Schema object describing non-sensitive form values.",
        },
        url: {
          type: "string",
          description: "HTTPS URL for URL-mode operator handoff.",
        },
        sensitive: {
          type: "boolean",
          description: "True when the request may involve credentials, tokens, or other sensitive values.",
        },
        verbosity: OUTPUT_VERBOSITY_PROPERTY,
      },
      required: ["mode", "message"],
      additionalProperties: false,
    },
  },
  tool_catalog_search: {
    name: "tool_catalog_search",
    description:
      "Search the shared Kiln tool catalog by exact name, prefix, tags, or lexical query. Use this before requesting hidden deferred tools.",
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
  },
  memory_search: {
    name: "memory_search",
    description:
      "Search governed Memory Lattice records through the native memory read surface. Returns bounded graph evidence and resource URIs.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Optional text query for memory graph records.",
        },
        scopeKind: {
          type: "string",
          enum: ["user", "agent", "team", "project", "org", "app", "tenant", "session"],
          description: "Optional memory scope kind. Provide with scopeId.",
        },
        scopeId: {
          type: "string",
          minLength: 1,
          description: "Optional memory scope identifier. Provide with scopeKind.",
        },
        layer: {
          type: "string",
          enum: ["working", "episodic", "semantic", "procedural", "coordination", "audit"],
          description: "Optional memory layer filter.",
        },
        depth: {
          type: "number",
          description: "Optional graph depth. Defaults to 0.",
        },
        limit: {
          type: "number",
          description: "Maximum memory records to return. Defaults to the memory graph resource limit.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  memory_save: {
    name: "memory_save",
    description:
      "Save one governed memory record through the core MemoryMutationService. Requires explicit scope, layer, content, and provenance.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          minLength: 1,
          description:
            "Optional stable record ID. Supplying an existing ID updates that record through the mutation service.",
        },
        layer: {
          type: "string",
          enum: ["working", "episodic", "semantic", "procedural", "coordination", "audit"],
          description: "Memory layer for this record.",
        },
        scopeKind: {
          type: "string",
          enum: ["user", "agent", "team", "project", "org", "app", "tenant", "session"],
          description: "Memory scope kind.",
        },
        scopeId: {
          type: "string",
          minLength: 1,
          description: "Memory scope identifier.",
        },
        content: {
          type: "string",
          minLength: 1,
          description: "Memory record content.",
        },
        topicKey: {
          type: "string",
          minLength: 1,
          description: "Optional stable topic key used for reconsolidation and graph grouping.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags for filtering and discovery.",
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Optional confidence score between 0 and 1.",
        },
        durability: {
          type: "string",
          enum: ["short_lived", "durable"],
          description: "Declared persistence intent. Semantic and procedural writes are durable.",
        },
        futureTaskValue: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Bounded estimate of future task value used by the candidate write-admission policy.",
        },
        contradictionState: {
          type: "string",
          enum: ["none", "resolved", "unresolved"],
          description: "Known contradiction state for this proposed record.",
        },
        derivativeTrust: {
          type: "string",
          enum: ["original", "verified", "untrusted"],
          description: "Trust classification for derived content. Untrusted derivatives are rejected.",
        },
        canonicalEvidenceUris: {
          type: "array",
          items: { type: "string", minLength: 1 },
          description: "Canonical evidence URIs supporting durable memory.",
        },
        provenance: {
          type: "object",
          properties: {
            sourceType: {
              type: "string",
              enum: ["session", "turn", "tool_call", "resource", "file", "gateway_app", "agent", "operator"],
              description: "Origin category for the memory.",
            },
            sourceId: {
              type: "string",
              minLength: 1,
              description: "Stable identifier for the source.",
            },
            sessionId: { type: "string", minLength: 1 },
            turnId: { type: "string", minLength: 1 },
            toolCallId: { type: "string", minLength: 1 },
            actor: { type: "string", minLength: 1 },
            capturedAt: {
              type: "string",
              description: "ISO timestamp. Defaults to the current time when omitted.",
            },
          },
          required: ["sourceType", "sourceId"],
          additionalProperties: false,
        },
      },
      required: ["layer", "scopeKind", "scopeId", "content", "provenance"],
      additionalProperties: false,
    },
  },
  resource_list: {
    name: "resource_list",
    description:
      "List shared Kiln resources available to the current session. Use cursor unchanged to continue pagination.",
    inputSchema: {
      type: "object",
      properties: {
        cursor: {
          type: "string",
          description: "Opaque cursor returned by a previous resource_list call.",
        },
        limit: {
          type: "number",
          description:
            "Maximum resources to return. Defaults to the registry page size and caps at the registry maximum.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  resource_template_list: {
    name: "resource_template_list",
    description:
      "List shared Kiln resource templates available to the current session. Use cursor unchanged to continue pagination.",
    inputSchema: {
      type: "object",
      properties: {
        cursor: {
          type: "string",
          description: "Opaque cursor returned by a previous resource_template_list call.",
        },
        limit: {
          type: "number",
          description:
            "Maximum resource templates to return. Defaults to the registry page size and caps at the registry maximum.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  resource_read: {
    name: "resource_read",
    description:
      "Read one bounded page from a kiln:// resource URI in the shared resource registry. Use nextCursor unchanged to continue pagination.",
    inputSchema: {
      type: "object",
      properties: {
        uri: {
          type: "string",
          minLength: 1,
          description: "Exact kiln:// resource URI to read.",
        },
        cursor: {
          type: "string",
          description: "Opaque cursor returned by a previous resource_read call.",
        },
        limit: {
          type: "number",
          description:
            "Maximum resource units to return. Text resources page by line; binary resources page by decoded byte.",
        },
      },
      required: ["uri"],
      additionalProperties: false,
    },
  },
  formal_verify: {
    name: "formal_verify",
    description:
      "Run a deterministic verifier over a file that declares formal specifications, and report which proof obligations were discharged. Returns unproven obligations with the verifier's diagnostic so they can be repaired. This reports verifier output only: it does not accept work, and it does not decide which acceptance criterion an obligation satisfies.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          minLength: 1,
          description: "Path to the file to verify, relative to the workspace root.",
        },
      },
      required: ["file"],
      additionalProperties: false,
    },
  },
  static_analyze: {
    name: "static_analyze",
    description:
      "Run Kiln's fixed, versioned Oxlint profile over one immutable JavaScript or TypeScript source copy and report correctness, safety, and structural-budget diagnostics. This reports analyzer output only: it does not accept work, load repository lint policy, or decide which acceptance criterion the observation satisfies.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          minLength: 1,
          description: "Path to one JavaScript or TypeScript source file, relative to the workspace root.",
        },
      },
      required: ["file"],
      additionalProperties: false,
    },
  },
  quality_analyze: {
    name: "quality_analyze",
    description:
      "Analyze one TypeScript artifact with every configured deterministic quality profile. Reports profile revisions, rules evaluated, and diagnostics only; it does not identify AI authorship, establish overall quality, fix code, or accept work.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          minLength: 1,
          description: "Path to one TypeScript source file, relative to the workspace root.",
        },
      },
      required: ["file"],
      additionalProperties: false,
    },
  },
  gentle_review: {
    name: "gentle_review",
    description:
      "Observe the current Gentle AI review transaction for this workspace. Call with an empty object. This facts-only tool never starts, advances, captures, corrects, approves, or delivers a review.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
};
