import { startGuiGateway, type CliSessionFactory } from "@kilnai/runtime";
import { InMemoryContextArtifactCache } from "@kilnai/core";
import type { GuiSessionSummary } from "@kilnai/gateway-contracts";

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

const sessionSummaries: GuiSessionSummary[] = [
  {
    id: "claude-session-1",
    provider: "claude",
    completedAt: new Date(Date.now() - 60_000).toISOString(),
    cost: 0.0123,
    taskSummary: "Summarize parity checklist",
  },
  {
    id: "claude-session-2",
    provider: "claude",
    completedAt: new Date(Date.now() - 120_000).toISOString(),
    cost: 0.0042,
    taskSummary: "Generate test fixture output",
  },
  {
    id: "codex-session-1",
    provider: "codex",
    completedAt: new Date(Date.now() - 180_000).toISOString(),
    cost: 0.0301,
    taskSummary: "Refactor command routing",
  },
];

const fakeSessionFactory: CliSessionFactory = (_systemPrompt, _cwd) => ({
  async *run(options) {
    const userTurns = options.messages
      ?.filter((message) => message.role === "user")
      .length ?? 1;
    const prompt = options.prompt.trim();
    const chunks = [
      "Reply ",
      `users:${userTurns} `,
      `echo:${summarizePrompt(prompt)}`,
    ];

    for (const chunk of chunks) {
      await delay(70);
      yield { type: "text_delta", content: chunk };
    }

    yield { type: "cost_update", usd: 0.0104, inputTokens: 21, outputTokens: 42 };
    yield { type: "completed", totalUsd: 0.0104, durationMs: 220, isError: false, isPreflightCrash: false };

    sessionSummaries.unshift({
      id: `generated-${Date.now()}`,
      provider: activeProvider,
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
let resumeByProvider = new Map<string, string>();

const contextArtifactCache = new InMemoryContextArtifactCache();

async function main(): Promise<void> {
  const port = parseGatewayPort();

  const gateway = await startGuiGateway({
    port,
    getSnapshot: async () => ({
      providers: [
        { id: "claude", label: "Claude", group: "harness", free: false, models: ["claude-sonnet-4-6", "claude-opus-4-6"], available: true },
        { id: "codex", label: "Codex", group: "harness", free: false, models: ["o3", "o4-mini"], available: true },
        { id: "opencode", label: "OpenCode", group: "harness", free: false, models: [], available: true },
      ],
      sessions: sessionSummaries.slice(0, 20),
      telemetry: { status: "idle", dominantRegions: [], saturation: 0, entropy: 0 },
    }),
    listSessions: async (provider) => {
      const filtered = provider
        ? sessionSummaries.filter((session) => session.provider === provider)
        : sessionSummaries;
      return filtered.slice(0, 20);
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
        resumeByProvider.delete(activeProvider);
      },
      onResumeSession: async (sessionId, provider) => {
        resumeByProvider.set(provider, sessionId);
        activeProvider = provider;
      },
      contextArtifactCache,
      planMode: false,
    },
  });

  process.stdout.write(`READY ${gateway.port}\n`);

  const shutdown = () => {
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
