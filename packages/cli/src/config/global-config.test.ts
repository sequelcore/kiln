import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/home/test-user"),
}));

import { KilnYamlError } from "../kiln-yaml.js";
import {
  defaultGlobalConfig,
  readGlobalConfig,
  resolveGlobalDefaultModel,
  resolveGlobalDefaultProvider,
  resolveGlobalUiTheme,
  resolveGlobalConfigPath,
  writeGlobalConfig,
} from "./global-config.js";

const existsSyncMock = existsSync as unknown as ReturnType<typeof vi.fn>;
const readFileSyncMock = readFileSync as unknown as ReturnType<typeof vi.fn>;
const writeFileSyncMock = writeFileSync as unknown as ReturnType<typeof vi.fn>;
const mkdirSyncMock = mkdirSync as unknown as ReturnType<typeof vi.fn>;
const homedirMock = homedir as unknown as ReturnType<typeof vi.fn>;

describe("global-config", () => {
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

  beforeEach(() => {
    vi.clearAllMocks();
    existsSyncMock.mockReset();
    readFileSyncMock.mockReset();
    writeFileSyncMock.mockReset();
    mkdirSyncMock.mockReset();
    homedirMock.mockReset();
    homedirMock.mockReturnValue("/home/test-user");
    delete process.env.XDG_CONFIG_HOME;
  });

  afterEach(() => {
    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    }
    vi.restoreAllMocks();
  });

  it("resolveGlobalConfigPath() returns ~/.kiln/config.yaml when XDG_CONFIG_HOME is not set", () => {
    const path = resolveGlobalConfigPath();

    expect(path).toBe(join("/home/test-user", ".kiln", "config.yaml"));
  });

  it("resolveGlobalConfigPath() returns XDG_CONFIG_HOME/kiln/config.yaml when set", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdg";

    const path = resolveGlobalConfigPath();

    expect(path).toBe(join("/tmp/xdg", "kiln", "config.yaml"));
  });

  it("readGlobalConfig() returns null when file does not exist", () => {
    existsSyncMock.mockReturnValue(false);

    const config = readGlobalConfig();

    expect(config).toBeNull();
  });

  it("readGlobalConfig() parses and returns valid config", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "engines:",
        "  codex:",
        "    enabled: true",
        "    billing: plus-quota",
        "routing:",
        "  defaultWorker: codex",
        "  budgetAware: false",
        "models:",
        "  default: claude-opus-4-7",
        "  codex: gpt-5.4",
      ].join("\n"),
    );

    const config = readGlobalConfig();

    expect(config).toEqual({
      version: "1",
      engines: {
        codex: {
          enabled: true,
          billing: "plus-quota",
        },
      },
      routing: {
        defaultWorker: "codex",
        budgetAware: false,
      },
      models: {
        default: "claude-opus-4-7",
        codex: "gpt-5.4",
      },
    });
  });

  it("readGlobalConfig() accepts GUI provider selection preference", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "ui:",
        "  theme: kiln-dark",
        "  providerSelection:",
        "    provider: codex-oauth",
        "    model: gpt-5.5",
      ].join("\n"),
    );

    expect(readGlobalConfig()?.ui).toEqual({
      theme: "kiln-dark",
      providerSelection: {
        provider: "codex-oauth",
        model: "gpt-5.5",
      },
    });
  });

  it("readGlobalConfig() rejects non-canonical configs", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(["version: \"2\"", "provider: codex"].join("\n"));

    expect(() => readGlobalConfig()).toThrow(
      'Global config version must be "1". Recreate the canonical config through an explicit adoption flow.',
    );
  });

  it("readGlobalConfig() rejects unknown top-level fields and invalid billing modes", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(["version: \"1\"", "provider: codex"].join("\n"));
    expect(() => readGlobalConfig()).toThrow("Unknown global config field: provider");

    readFileSyncMock.mockReturnValue(
      ["version: \"1\"", "engines:", "  codex:", "    billing: credits"].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow("engines.codex.billing has an unknown billing mode");
  });

  it("readGlobalConfig() validates global identity fields", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "identity:",
        "  name: Alex",
        "  timezone: America/Tijuana",
      ].join("\n"),
    );
    expect(readGlobalConfig()?.identity).toEqual({
      name: "Alex",
      timezone: "America/Tijuana",
    });

    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "identity:",
        "  personality: helpful",
      ].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow("Unknown identity field: personality");

    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "identity:",
        "  timezone: \"\"",
      ].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow("identity.timezone must be a non-empty string");
  });

  it("readGlobalConfig() validates active instruction profiles", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "activeInstructionProfiles:",
        "  - sequel-engineering",
      ].join("\n"),
    );
    expect(readGlobalConfig()?.activeInstructionProfiles).toEqual(["sequel-engineering"]);

    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "activeInstructionProfiles:",
        "  - \"\"",
      ].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow("activeInstructionProfiles must be an array of non-empty strings");
  });

  it("readGlobalConfig() validates builtin skill policy", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "skills:",
        "  builtin:",
        "    enabled: true",
        "    include:",
        "      - tdd-workflow",
        "    exclude:",
        "      - frontend-ux-review",
        "  selection:",
        "    mode: auto",
      ].join("\n"),
    );
    expect(readGlobalConfig()?.skills).toEqual({
      builtin: {
        enabled: true,
        include: ["tdd-workflow"],
        exclude: ["frontend-ux-review"],
      },
      selection: {
        mode: "auto",
      },
    });

    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "skills:",
        "  builtin:",
        "    enabled: yes",
      ].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow("skills.builtin.enabled must be a boolean");

    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "skills:",
        "  selection:",
        "    mode: eager",
      ].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow("skills.selection.mode must be advisory or auto");
  });

  it("readGlobalConfig() validates work governance policy", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "workGovernance:",
        "  defaultPosture: orchestrate",
        "  directExecution:",
        "    maxFiles: 1",
        "    maxRisk: low",
        "  requireDelegationFor:",
        "    - architecture",
        "    - managed-agents",
        "  requiredEvidence:",
        "    - surface-map",
        "    - residual-risk",
      ].join("\n"),
    );

    expect(readGlobalConfig()?.workGovernance).toEqual({
      defaultPosture: "orchestrate",
      directExecution: {
        maxFiles: 1,
        maxRisk: "low",
      },
      requireDelegationFor: ["architecture", "managed-agents"],
      requiredEvidence: ["surface-map", "residual-risk"],
    });

    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "workGovernance:",
        "  requireDelegationFor:",
        "    - vibes",
      ].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow(
      "workGovernance.requireDelegationFor contains unsupported trigger: vibes",
    );

    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "workGovernance:",
        "  directExecution:",
        "    maxFiles: 0",
      ].join("\n"),
    );
    expect(() => readGlobalConfig()).toThrow(
      "workGovernance.directExecution.maxFiles must be a positive integer",
    );
  });

  it("readGlobalConfig() accepts web provider defaults", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "web:",
        "  searchProvider:",
        "    type: tavily",
        "    apiKeyEnv: TAVILY_API_KEY",
        "  extractProvider:",
        "    type: firecrawl",
        "    apiKeyEnv: FIRECRAWL_API_KEY",
      ].join("\n"),
    );

    expect(readGlobalConfig()?.web).toEqual({
      searchProvider: {
        type: "tavily",
        apiKeyEnv: "TAVILY_API_KEY",
      },
      extractProvider: {
        type: "firecrawl",
        apiKeyEnv: "FIRECRAWL_API_KEY",
      },
    });
  });

  it("readGlobalConfig() accepts governed operator voice defaults", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "operatorVoice:",
        "  stt:",
        "    provider: whisper-local",
        "    commandEnv: KILN_WHISPER_COMMAND",
        "    model: base",
        "    language: English",
        "  tts:",
        "    provider: kokoro-local",
        "    commandEnv: KILN_KOKORO_COMMAND",
        "    model: kokoro-v1",
        "    voice: af_bella",
        "    format: wav",
        "  policy:",
        "    surfaces:",
        "      gui:",
        "        enabled: true",
        "        input:",
        "          modes: [microphone, file]",
        "        output:",
        "          modes: [audio-response, transcript-only]",
        "      tui:",
        "        enabled: true",
        "        output:",
        "          modes: [artifact-only, transcript-only]",
      ].join("\n"),
    );

    expect(readGlobalConfig()?.operatorVoice).toMatchObject({
      stt: {
        provider: "whisper-local",
        commandEnv: "KILN_WHISPER_COMMAND",
      },
      tts: {
        provider: "kokoro-local",
        commandEnv: "KILN_KOKORO_COMMAND",
        voice: "af_bella",
      },
      policy: {
        surfaces: {
          gui: {
            enabled: true,
          },
          tui: {
            enabled: true,
          },
        },
      },
    });
  });

  it("readGlobalConfig() accepts managed-agent voice profile references from operator voice catalog", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "operatorVoice:",
        "  stt:",
        "    provider: whisper-local",
        "  tts:",
        "    provider: kokoro-local",
        "  ttsProfiles:",
        "    reviewer-voice:",
        "      style: calm reviewer",
        "      voice: af_bella",
        "      speed: 1",
        "managedAgents:",
        "  enabled: true",
        "  defaultVoiceProfile: reviewer-voice",
        "  routes:",
        "    - id: codex-reviewer",
        "      kind: direct",
        "      provider: codex-oauth",
        "      model: gpt-5.4-mini",
        "      voiceProfile: reviewer-voice",
      ].join("\n"),
    );

    expect(readGlobalConfig()?.managedAgents).toMatchObject({
      defaultVoiceProfile: "reviewer-voice",
      routes: [
        expect.objectContaining({
          id: "codex-reviewer",
          voiceProfile: "reviewer-voice",
        }),
      ],
    });
  });

  it("readGlobalConfig() rejects managed-agent voice profile references outside operator voice catalog", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "operatorVoice:",
        "  stt:",
        "    provider: whisper-local",
        "  tts:",
        "    provider: kokoro-local",
        "  ttsProfiles:",
        "    reviewer-voice:",
        "      style: calm reviewer",
        "      voice: af_bella",
        "      speed: 1",
        "managedAgents:",
        "  enabled: true",
        "  routes:",
        "    - id: codex-reviewer",
        "      kind: direct",
        "      provider: codex-oauth",
        "      voiceProfile: missing-voice",
      ].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow(
      "managedAgents.routes[0].voiceProfile references unknown operatorVoice.ttsProfiles entry \"missing-voice\"",
    );
  });

  it("readGlobalConfig() rejects invalid operator voice config", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "operatorVoice:",
        "  stt:",
        "    provider: imaginary-stt",
        "  tts:",
        "    provider: kokoro-local",
        "    commandEnv: KILN_KOKORO_COMMAND",
      ].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow(
      "operatorVoice.voice.stt.provider must be one of: openai, deepgram, whisper-local",
    );
  });

  it("readGlobalConfig() rejects global web authority fields", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "web:",
        "  enabled: true",
      ].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow(
      "Unknown global web field: enabled. Put web authority in project .kiln/kiln.yaml.",
    );
  });

  it("readGlobalConfig() accepts null budget ceilings", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "routing:",
        "  budgetAware: true",
        "  budget:",
        "    opencode:",
        "      dailyTokenCeiling: null",
      ].join("\n"),
    );

    expect(readGlobalConfig()?.routing?.budget?.opencode?.dailyTokenCeiling).toBeNull();
  });

  it("readGlobalConfig() accepts ordered provider/model routes", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "routing:",
        "  routes:",
        "    - provider: codex-oauth",
        "      model: gpt-5.4-mini",
        "    - provider: openrouter",
        "      model: openrouter/free",
      ].join("\n"),
    );

    const config = readGlobalConfig();

    expect(config?.routing?.routes).toEqual([
      { provider: "codex-oauth", model: "gpt-5.4-mini" },
      { provider: "openrouter", model: "openrouter/free" },
    ]);
    expect(resolveGlobalDefaultProvider(config)).toBe("codex-oauth");
    expect(resolveGlobalDefaultModel(config)).toBe("gpt-5.4-mini");
  });

  it("readGlobalConfig() rejects malformed ordered routes", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      ["version: \"1\"", "routing:", "  routes:", "    - model: gpt-5.4-mini"].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow("routing.routes[0].provider must be a non-empty string");
  });

  it("readGlobalConfig() validates model task suitability overrides", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "modelTaskSuitability:",
        "  - provider: codex-oauth",
        "    model: gpt-5.4-mini",
        "    task: frontend-design",
        "    level: limited",
        "    reason: Prefer a visual-design route when available.",
      ].join("\n"),
    );

    expect(readGlobalConfig()?.modelTaskSuitability).toEqual([{
      provider: "codex-oauth",
      model: "gpt-5.4-mini",
      task: "frontend-design",
      level: "limited",
      reason: "Prefer a visual-design route when available.",
    }]);

    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "modelTaskSuitability:",
        "  - provider: codex-oauth",
        "    model: gpt-5.4-mini",
        "    task: frontend-design",
        "    level: best",
        "    reason: Invalid level.",
      ].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow(
      "modelTaskSuitability[0].level must be \"preferred\", \"capable\", or \"limited\"",
    );
  });

  it("readGlobalConfig() validates reasoning policy separately from model suitability", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "reasoningPolicy:",
        "  default: medium",
        "  unsupported: omit",
        "  byTask:",
        "    architecture-review: xhigh",
        "    mechanical-edit: low",
      ].join("\n"),
    );

    expect(readGlobalConfig()?.reasoningPolicy).toEqual({
      default: "medium",
      unsupported: "omit",
      byTask: {
        "architecture-review": "xhigh",
        "mechanical-edit": "low",
      },
    });

    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "reasoningPolicy:",
        "  byTask:",
        "    frontend-design: intense",
      ].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow("reasoningPolicy.byTask.frontend-design must be a supported reasoning effort");
  });

  it("readGlobalConfig() validates managed route write authority shape", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "managedAgents:",
        "  enabled: true",
        "  routes:",
        "    - id: codex-approved-write",
        "      kind: harness",
        "      provider: codex",
        "      profiles:",
        "        - foundation-apply-approved-writes",
        "      writeAuthority:",
        "        workspace:",
        "          mode: apply-approved",
        "          allowedPaths:",
        "            - packages/cli/src/config",
        "        approval:",
        "          mode: required-before-apply",
      ].join("\n"),
    );

    expect(readGlobalConfig()?.managedAgents?.routes?.[0]?.writeAuthority).toMatchObject({
      workspace: {
        mode: "apply-approved",
        allowedPaths: ["packages/cli/src/config"],
      },
      approval: {
        mode: "required-before-apply",
      },
    });

    readFileSyncMock.mockReturnValue(
      [
        "version: \"1\"",
        "managedAgents:",
        "  routes:",
        "    - id: codex-approved-write",
        "      kind: harness",
        "      provider: codex",
        "      writeAuthority:",
        "        approval:",
        "          mode: auto",
      ].join("\n"),
    );

    expect(() => readGlobalConfig()).toThrow(
      "managedAgents.routes[0].writeAuthority.approval.mode must be \"required-before-apply\" or \"policy-approved\"",
    );
  });

  it("readGlobalConfig() throws KilnYamlError when file is not a YAML object", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue("- not\n- an\n- object\n");

    expect(() => readGlobalConfig()).toThrow(KilnYamlError);
    expect(() => readGlobalConfig()).toThrow("Global config must be an object");
  });

  it("writeGlobalConfig() creates parent directories and writes stringified YAML", () => {
    writeGlobalConfig({
      version: "1",
      routing: { defaultWorker: "codex", budgetAware: false },
      models: { codex: "gpt-5.4" },
    });

    expect(mkdirSyncMock).toHaveBeenCalledWith(join("/home/test-user", ".kiln"), {
      recursive: true,
    });
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      join("/home/test-user", ".kiln", "config.yaml"),
      expect.any(String),
      "utf-8",
    );
    expect(String(writeFileSyncMock.mock.calls[0]?.[1])).toContain("defaultWorker: codex");
  });

  it("defaultGlobalConfig() returns expected shape", () => {
    expect(defaultGlobalConfig()).toEqual({
      version: "1",
      engines: {
        claude: { enabled: true, billing: "subscription" },
        codex: { enabled: false, billing: "plus-quota" },
        opencode: { enabled: false, billing: "free" },
      },
      routing: {
        defaultWorker: "claude",
        budgetAware: false,
      },
      permissions: {
        approval: "on-request",
        sandbox: "read-only",
      },
      skills: {
        builtin: {
          enabled: true,
        },
      },
      workGovernance: {
        defaultPosture: "orchestrate",
        directExecution: {
          maxFiles: 1,
          maxRisk: "low",
        },
        requireDelegationFor: [
          "architecture",
          "security",
          "ui",
          "runtime",
          "provider-routing",
          "managed-agents",
          "config",
          "multi-file",
          "cross-surface",
          "long-running",
          "verification-heavy",
          "formal-proof-candidate",
        ],
        requiredEvidence: [
          "surface-map",
          "risk-hypothesis",
          "plan",
          "tests",
          "typecheck",
          "residual-risk",
        ],
      },
      components: {
        include: ["baseline:core"],
      },
    });
  });

  it("resolves provider, model, and UI theme through projection helpers", () => {
    const config = {
      version: "1" as const,
      engines: { codex: { enabled: true as const } },
      routing: { defaultWorker: "codex" },
      models: { default: "fallback-model", codex: "gpt-5.4" },
      ui: { theme: "kiln-graphite" },
    };

    expect(resolveGlobalDefaultProvider(config)).toBe("codex");
    expect(resolveGlobalDefaultModel(config)).toBe("gpt-5.4");
    expect(resolveGlobalUiTheme(config)).toBe("kiln-graphite");
  });
});
