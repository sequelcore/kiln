import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startGuiGateway, type CliSessionFactory } from "@kilnai/runtime";
import {
  InMemoryContextArtifactCache,
  SqliteMemoryRepository,
  type CreateMemoryRecordInput,
  type MemoryProvenance,
} from "@kilnai/core";
import type { GuiSessionSummary, KilnConfigSetupSnapshot } from "@kilnai/gateway-contracts";

function parseGatewayPort(): number {
  const raw = process.env.GUI_GATEWAY_PORT ?? "0";
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid GUI_GATEWAY_PORT: ${raw}`);
  }
  return parsed;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizePrompt(prompt: string): string {
  const compact = prompt.replace(/\s+/g, " ").trim();
  if (compact.length <= 60) return compact;
  return `${compact.slice(0, 57)}...`;
}

function responseChunks(prompt: string, userTurns: number): readonly string[] {
  if (prompt.toLowerCase().includes("markdown rendering check")) {
    return [
      "Checklist:\n\n",
      "- Provider discovery\n",
      "- GUI rendering\n\n",
      "| Surface | Status |\n| --- | --- |\n| Chat | fixed |\n",
    ];
  }
  if (prompt.toLowerCase().includes("hold stream for provider switch")) {
    return [
      "Reply ",
      "streaming ",
      "while ",
      "provider ",
      "selection ",
      "changes ",
      "for ",
      `echo:${summarizePrompt(prompt)}`,
    ];
  }
  return [
    "Reply ",
    `users:${userTurns} `,
    `echo:${summarizePrompt(prompt)}`,
  ];
}

const sessionSummaries: GuiSessionSummary[] = [
  {
    id: "claude-session-1",
    providersUsed: ["claude"],
    lastProvider: "claude",
    completedAt: new Date(Date.now() - 60_000).toISOString(),
    cost: 0.0123,
    taskSummary: "Summarize parity checklist",
  },
  {
    id: "claude-session-2",
    providersUsed: ["claude"],
    lastProvider: "claude",
    completedAt: new Date(Date.now() - 120_000).toISOString(),
    cost: 0.0042,
    taskSummary: "Generate test fixture output",
  },
  {
    id: "codex-session-1",
    providersUsed: ["codex"],
    lastProvider: "codex",
    completedAt: new Date(Date.now() - 180_000).toISOString(),
    cost: 0.0301,
    taskSummary: "Refactor command routing",
  },
];

const fakeSessionFactory: CliSessionFactory = () => ({
  async *run(options) {
    const userTurns = options.messages
      ?.filter((message) => message.role === "user")
      .length ?? 1;
    const prompt = options.prompt.trim();
    const chunks = responseChunks(prompt, userTurns);

    for (const chunk of chunks) {
      await delay(70);
      yield { type: "text_delta", content: chunk };
    }

    yield { type: "cost_update", usd: 0.0104, inputTokens: 21, outputTokens: 42 };
    yield { type: "completed", totalUsd: 0.0104, durationMs: 220, isError: false, isPreflightCrash: false };

    sessionSummaries.unshift({
      id: `generated-${Date.now()}`,
      providersUsed: [activeProvider],
      lastProvider: activeProvider,
      completedAt: new Date().toISOString(),
      cost: 0.0104,
      taskSummary: summarizePrompt(prompt),
    });
    if (sessionSummaries.length > 30) {
      sessionSummaries.length = 30;
    }
  },
  async dispose() {
    // no-op
  },
});

let activeProvider = "claude";
let activeModel = "claude-sonnet-4-6";
let continuationSessionId: string | null = null;

const contextArtifactCache = new InMemoryContextArtifactCache();
const memoryDbDir = mkdtempSync(join(tmpdir(), "kiln-gui-memory-"));
const memoryRepository = new SqliteMemoryRepository({ dbPath: join(memoryDbDir, "memory.db") });
const setupSnapshot: KilnConfigSetupSnapshot = {
  projectRoot: "C:/workspace/kiln",
  projectContext: {
    path: "C:/workspace/kiln/.kiln/project-context.md",
    status: "valid",
    recommendation: "none",
  },
  repoShims: [
    {
      target: "agents",
      targetId: "agents",
      path: "C:/workspace/kiln/AGENTS.md",
      status: "current",
      recommendation: "none",
    },
    {
      target: "claude",
      targetId: "claude",
      path: "C:/workspace/kiln/CLAUDE.md",
      status: "current",
      recommendation: "none",
    },
  ],
  nativeProjections: [],
  permissionIntegrity: [],
  recommendedActions: ["none"],
};

seedMemoryRepository(memoryRepository);

async function main(): Promise<void> {
  const port = parseGatewayPort();

  const gateway = await startGuiGateway({
    port,
    getSnapshot: async () => ({
      providers: [
        { id: "claude", label: "Claude", group: "harness", free: false, models: ["claude-sonnet-4-6", "claude-opus-4-6"], available: true },
        { id: "codex", label: "Codex", group: "harness", free: false, models: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark"], available: true },
        { id: "opencode", label: "OpenCode", group: "harness", free: false, models: [], available: true },
      ],
      sessions: sessionSummaries.slice(0, 20),
      telemetry: { status: "idle", dominantRegions: [], saturation: 0, entropy: 0 },
      continuationInfoByProvider: continuationSessionId
        ? { [activeProvider]: { strategy: "continue_session", feedbackLabel: continuationSessionId } }
        : {},
    }),
    getProviderAvailability: () => ({ claude: true, codex: true, opencode: true }),
    getSetupSnapshot: async () => setupSnapshot,
    listSessions: async () => sessionSummaries.slice(0, 20),
    builtinToolOptions: {
      memoryResources: { repository: memoryRepository },
    },
    operatorTransport: {
      sessionManager: {
        factory: fakeSessionFactory,
        getProvider: () => activeProvider,
        setProvider: (provider) => {
          activeProvider = provider;
        },
        getModel: () => activeModel,
        setModel: (model) => {
          activeModel = model;
        },
      },
      systemPrompt: "You are a deterministic e2e test assistant.",
      onClear: async () => {
        continuationSessionId = null;
      },
      onContinueSession: async (sessionId) => {
        continuationSessionId = sessionId;
      },
      contextArtifactCache,
      executionMode: "execute",
    },
  });

  process.stdout.write(`READY ${gateway.port}\n`);

  const shutdown = () => {
    memoryRepository.close();
    rmSync(memoryDbDir, { recursive: true, force: true });
    gateway.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Gateway runner failed: ${message}\n`);
  process.exit(1);
});

function seedMemoryRepository(repository: SqliteMemoryRepository): void {
  const contract = repository.saveRecord(memoryRecord({
    id: "memory-lattice-contract",
    content: "Memory Lattice contract is exposed through runtime resources for GUI, TUI, CLI, and YAML consumers.",
    topicKey: "Memory Lattice contract",
  }));
  const admission = repository.saveRecord(memoryRecord({
    id: "context-admission-evidence",
    content: "Context admission evidence explains why a memory record entered an agent context window.",
    topicKey: "Context admission evidence",
  }));

  repository.saveRelation({
    id: "memory-lattice-supports-admission",
    sourceRecordId: contract.id,
    target: { kind: "memory_record", id: admission.id },
    type: "supports",
    confidence: 0.9,
    createdAt: "2026-04-30T12:00:00.000Z",
  });
}

function memoryRecord(overrides: {
  readonly id: string;
  readonly content: string;
  readonly topicKey: string;
}): CreateMemoryRecordInput {
  return {
    id: overrides.id,
    layer: "semantic",
    scope: { kind: "project", id: "kiln" },
    content: overrides.content,
    topicKey: overrides.topicKey,
    tags: ["memory-lattice"],
    provenance: memoryProvenance("gui-e2e-fixture"),
    confidence: 0.95,
    createdAt: "2026-04-30T12:00:00.000Z",
  };
}

function memoryProvenance(sourceId: string): MemoryProvenance {
  return {
    sourceType: "operator",
    sourceId,
    actor: "Kiln GUI parity fixture",
    capturedAt: "2026-04-30T12:00:00.000Z",
  };
}
