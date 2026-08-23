import { describe, it, expect } from "vitest";
import { parseAppYaml, validateAppGraph, AppLoaderError } from "../../../src/engine/loader/app-loader.js";

const SAMPLE_YAML = `
name: my-app


router:
  fallback: development

teams:
  development:
    agents:
      architect:
        name: Aria
        role: Senior Architect
        goal: Design robust, maintainable solutions with minimal complexity
        tools: []
      worker:
        name: Marcus
        role: Implementation Specialist
        goal: Write clean, well-tested code that follows team conventions
        tools: [code_edit]
    capabilities:
      - name: code_edit
        description: Edit code files
        tags: [coding]
  hotfix:
    agents:
      fixer:
        name: FixBot
        role: Hotfix Specialist
        goal: Quickly fix production issues
        tools: [code_edit]
    capabilities:
      - name: code_edit
        description: Edit code files
        tags: [coding]
`;

describe("parseAppYaml", () => {
  it("parses valid YAML into correct App structure", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    expect(app.name).toBe("my-app");
    expect(Object.keys(app.teams)).toContain("development");
    expect(Object.keys(app.teams)).toContain("hotfix");
  });

  it("correctly maps agent identity fields", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    const devTeam = app.teams["development"]!;
    const architect = devTeam.agents["architect"]!;
    expect(architect.name).toBe("Aria");
    expect(architect.role).toBe("Senior Architect");
    expect(architect.goal).toBe("Design robust, maintainable solutions with minimal complexity");
    expect(architect.tools).toEqual([]);

    const worker = devTeam.agents["worker"]!;
    expect(worker.name).toBe("Marcus");
    expect(worker.role).toBe("Implementation Specialist");
    expect(worker.goal).toBe("Write clean, well-tested code that follows team conventions");
    expect(worker.tools).toEqual(["code_edit"]);
  });

  it("handles capabilities", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    const caps = app.teams["development"]!.capabilities;
    expect(caps).toHaveLength(1);
    expect(caps[0]!.name).toBe("code_edit");
    expect(caps[0]!.description).toBe("Edit code files");
    expect(caps[0]!.tags).toEqual(["coding"]);
    expect(caps[0]!.schema).toEqual({});
  });

  it("maps capability action effect envelopes", () => {
    const yaml = `
name: effect-app
router:
  fallback: dev
teams:
  dev:
    agents:
      w: { name: W, role: Worker, goal: Work, tools: [read_status] }
    capabilities:
      - name: read_status
        description: Read status
        tags: [status]
        effectEnvelope:
          operation: observe
          boundaries: [process]
          reversibility: reversible
          dataEgress: metadata
          identityUse: none
          consequences: []
          idempotency: idempotent
`;
    const app = parseAppYaml(yaml);
    expect(app.teams.dev?.capabilities[0]?.effectEnvelope).toMatchObject({
      operation: "observe",
      boundaries: ["process"],
      consequences: [],
      idempotency: "idempotent",
    });
  });

  it("throws AppLoaderError for malformed capability action effect envelopes", () => {
    const yaml = `
name: bad-effect-app
router:
  fallback: dev
teams:
  dev:
    agents:
      w: { name: W, role: Worker, goal: Work, tools: [bad_tool] }
    capabilities:
      - name: bad_tool
        description: Bad effect
        tags: []
        effectEnvelope:
          operation: observe
          boundaries: [process]
          reversibility: reversible
          dataEgress: metadata
          identityUse: none
          consequences: [none]
          idempotency: idempotent
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("handles router fallback", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    expect(app.router.fallback).toBe("development");
  });

  it("parses minimal YAML with one team", () => {
    const yaml = `
name: minimal-app


router:
  fallback: solo

teams:
  solo:
    agents:
      worker:
        name: Solo
        role: Generalist
        goal: Handle all tasks
        tools: []
    capabilities: []
`;
    const app = parseAppYaml(yaml);
    expect(app.name).toBe("minimal-app");
    expect(Object.keys(app.teams)).toEqual(["solo"]);
  });

  it("maps MCP request timeout config", () => {
    const yaml = `
name: mcp-app


router:
  fallback: solo

mcp:
  servers:
    - tools

teams:
  solo:
    agents:
      worker:
        name: Solo
        role: Generalist
        goal: Handle all tasks
        tools: []
    capabilities: []
`;

    const app = parseAppYaml(yaml);

    expect(app.mcp?.servers).toEqual(["tools"]);
  });

  it("maps cross-surface voice policy from YAML", () => {
    const yaml = `
name: voice-app


router:
  fallback: solo

voice:
  stt:
    provider: openai
    model: gpt-4o-transcribe
    apiKeyEnv: OPENAI_API_KEY
    language: es
  tts:
    provider: openai
    model: gpt-4o-mini-tts
    apiKeyEnv: OPENAI_API_KEY
    voice: alloy
  policy:
    defaultInputFailureMode: fail-open
    defaultOutputFailureMode: fail-closed
    artifacts:
      storeSourceAudio: true
      storeTranscripts: true
      storeSynthesizedAudio: true
      retentionMaxArtifacts: 50
    surfaces:
      whatsapp:
        enabled: true
        input:
          modes: [audio-part]
          failureMode: fail-open
      gui:
        enabled: true
        input:
          modes: [microphone, file]
        output:
          modes: [audio-response, transcript-only]
          failureMode: fail-closed
teams:
  solo:
    agents:
      worker:
        name: Solo
        role: Generalist
        goal: Handle all tasks
        tools: []
    capabilities: []
`;

    const app = parseAppYaml(yaml);

    expect(app.voice?.stt.language).toBe("es");
    expect(app.voice?.policy?.defaultInputFailureMode).toBe("fail-open");
    expect(app.voice?.policy?.artifacts?.retentionMaxArtifacts).toBe(50);
    expect(app.voice?.policy?.surfaces?.whatsapp?.input?.modes).toEqual(["audio-part"]);
    expect(app.voice?.policy?.surfaces?.gui?.input?.modes).toEqual(["microphone", "file"]);
    expect(app.voice?.policy?.surfaces?.gui?.output?.modes).toEqual(["audio-response", "transcript-only"]);
  });

  it("maps local voice provider configuration from YAML", () => {
    const yaml = `
name: voice-local


router:
  fallback: solo

voice:
  stt:
    provider: whisper-local
    model: small
    commandEnv: KILN_WHISPER_COMMAND
    args: ["--serve-once"]
    modelPathEnv: KILN_WHISPER_MODEL_PATH
    device: auto
    timeoutMs: 120000
  tts:
    provider: kokoro-local
    model: kokoro-v1
    voice: es
    commandEnv: KILN_KOKORO_COMMAND
    modelPathEnv: KILN_KOKORO_MODEL_PATH
    device: auto
    timeoutMs: 120000
    format: wav

teams:
  solo:
    agents:
      worker:
        name: Solo
        role: Generalist
        goal: Handle all tasks
        tools: []
    capabilities: []
`;

    const app = parseAppYaml(yaml);

    expect(app.voice?.stt).toEqual({
      provider: "whisper-local",
      model: "small",
      commandEnv: "KILN_WHISPER_COMMAND",
      args: ["--serve-once"],
      modelPathEnv: "KILN_WHISPER_MODEL_PATH",
      device: "auto",
      timeoutMs: 120000,
    });
    expect(app.voice?.tts).toEqual({
      provider: "kokoro-local",
      model: "kokoro-v1",
      voice: "es",
      commandEnv: "KILN_KOKORO_COMMAND",
      modelPathEnv: "KILN_KOKORO_MODEL_PATH",
      device: "auto",
      timeoutMs: 120000,
      format: "wav",
    });
  });

  it("maps governed voice profiles from YAML", () => {
    const yaml = `
name: profiled-voice-app


router:
  fallback: solo

voice:
  stt:
    provider: whisper-local
    model: base
    commandEnv: KILN_WHISPER_COMMAND
  tts:
    provider: kokoro-local
    model: kokoro-v1
    commandEnv: KILN_KOKORO_COMMAND
    format: wav
  defaults:
    ttsProfile: english-default
  ttsProfiles:
    english-default:
      style: calm, concise technical assistant
      voice: af_bella
      language: en-us
      speed: 1
      speedRange: [0.95, 1.05]
      format: wav
      intents:
        neutral:
          delivery: Use the profile's normal delivery.
          appliesWhen:
            - Default spoken response when no more specific intent applies.
          speed: 1
        calm:
          delivery: Slightly slower and steadier delivery.
          appliesWhen:
            - Errors, support friction, or sensitive user messages.
          speed: 0.97

teams:
  solo:
    agents:
      assistant:
        name: Assistant
        role: Generalist
        goal: Answer with a stable governed voice
        tools: []
    capabilities: []
`;

    const app = parseAppYaml(yaml);

    expect(app.voice?.defaults?.ttsProfile).toBe("english-default");
    expect(app.voice?.ttsProfiles?.["english-default"]).toEqual({
      style: "calm, concise technical assistant",
      voice: "af_bella",
      language: "en-us",
      speed: 1,
      speedRange: [0.95, 1.05],
      format: "wav",
      intents: {
        neutral: {
          delivery: "Use the profile's normal delivery.",
          appliesWhen: ["Default spoken response when no more specific intent applies."],
          speed: 1,
        },
        calm: {
          delivery: "Slightly slower and steadier delivery.",
          appliesWhen: ["Errors, support friction, or sensitive user messages."],
          speed: 0.97,
        },
      },
    });
  });

  it("throws AppLoaderError for invalid MCP request timeout config", () => {
    const yaml = `
name: mcp-app


router:
  fallback: solo

mcp:
  servers:
    - bad server

teams:
  solo:
    agents:
      worker:
        name: Solo
        role: Generalist
        goal: Handle all tasks
        tools: []
    capabilities: []
`;

    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("rejects the obsolete quality alias", () => {
    const yaml = `
name: alias-app


router:
  fallback: solo

teams:
  solo:
    agents:
      worker:
        name: Solo
        role: Generalist
        goal: Handle all tasks
        tools: []
    capabilities: []
    quality:
      - name: lint
        command: "biome check"
        description: Lint check
        required: true
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("loads backstory and instructions from agent YAML", () => {
    const yaml = `
name: identity-app


router:
  fallback: solo

teams:
  solo:
    agents:
      writer:
        name: Aria
        role: Senior Architect
        goal: Design robust solutions
        tools: []
        backstory: Pragmatic architect who values simplicity.
        instructions: Always write tests before implementation.
    capabilities: []
`;
    const app = parseAppYaml(yaml);
    const agent = app.teams["solo"]!.agents["writer"]!;
    expect(agent.backstory).toBe("Pragmatic architect who values simplicity.");
    expect(agent.instructions).toBe("Always write tests before implementation.");
  });

  it("trims whitespace from backstory and instructions", () => {
    const yaml = `
name: trim-app


router:
  fallback: solo

teams:
  solo:
    agents:
      writer:
        name: Aria
        role: Senior Architect
        goal: Design robust solutions
        tools: []
        backstory: "  padded backstory  "
        instructions: "  padded instructions  "
    capabilities: []
`;
    const app = parseAppYaml(yaml);
    const agent = app.teams["solo"]!.agents["writer"]!;
    expect(agent.backstory).toBe("padded backstory");
    expect(agent.instructions).toBe("padded instructions");
  });

  it("throws AppLoaderError when agent role is whitespace-only", () => {
    const yaml = `
name: bad-role
router:
  fallback: t
teams:
  t:
    agents:
      w: { name: W, role: "   ", goal: Work, tools: [] }
    capabilities: []
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError for invalid YAML structure", () => {
    expect(() => parseAppYaml("not: valid: yaml:::::")).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError when name is missing", () => {
    const yaml = `
router:
  fallback: main
teams:
  main:
    agents:
      w: { name: W, role: Worker, goal: Work, tools: [] }
    capabilities: []
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError for the retired agent tier field", () => {
    const yaml = `
name: bad-tier
router:
  fallback: t
teams:
  t:
    agents:
      w: { name: W, role: Worker, goal: Work, tier: superfast, tools: [] }
    capabilities: []
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError when agent role is missing", () => {
    const yaml = `
name: bad-agent
router:
  fallback: t
teams:
  t:
    agents:
      w: { name: W, goal: Work, tools: [] }
    capabilities: []
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError when agent goal is missing", () => {
    const yaml = `
name: bad-agent
router:
  fallback: t
teams:
  t:
    agents:
      w: { name: W, role: Worker, tools: [] }
    capabilities: []
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError when agent name is missing", () => {
    const yaml = `
name: bad-agent
router:
  fallback: t
teams:
  t:
    agents:
      w: { role: Worker, goal: Work, tools: [] }
    capabilities: []
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError when YAML root is not an object", () => {
    expect(() => parseAppYaml("- just a list")).toThrow(AppLoaderError);
  });

  it("parses the manager used to select the primary team persona", () => {
    const yaml = `
name: supervisor-app
router:
  fallback: dev
teams:
  dev:
    manager: architect
    agents:
      architect:
        name: Aria
        role: Senior Architect
        goal: Design solutions
        tools: []
      worker:
        name: Marcus
        role: Coder
        goal: Write code
        tools: []
    capabilities: []
`;
    const app = parseAppYaml(yaml);
    expect(app.teams["dev"]!.manager).toBe("architect");
  });

  it("throws AppLoaderError for removed swarm team mode", () => {
    const yaml = `
name: swarm-app
router:
  fallback: dev
teams:
  dev:
    mode: swarm
    agents:
      alpha:
        name: Alpha
        role: Worker A
        goal: Work on tasks
        tools: [handoff_tool]
      beta:
        name: Beta
        role: Worker B
        goal: Work on tasks
        tools: [handoff_tool]
    capabilities:
      - name: handoff_tool
        description: Hand off to another agent
        type: handoff
        tags: [swarm]
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("parses capability with guardrail fields", () => {
    const yaml = `
name: guardrail-app
router:
  fallback: dev
teams:
  dev:
    agents:
      worker:
        name: Worker
        role: Coder
        goal: Write code
        tools: [guarded_tool]
    capabilities:
      - name: guarded_tool
        description: Tool with guardrail
        tags: [coding]
        guardrail: validate_output
        guardrailRetries: 5
        outputSchema:
          type: object
          properties:
            result:
              type: string
`;
    const app = parseAppYaml(yaml);
    const cap = app.teams["dev"]!.capabilities[0]!;
    expect(cap.guardrail).toBe("validate_output");
    expect(cap.guardrailRetries).toBe(5);
    expect(cap.outputSchema).toEqual({
      type: "object",
      properties: { result: { type: "string" } },
    });
  });

  it("throws AppLoaderError for invalid team mode", () => {
    const yaml = `
name: bad-mode
router:
  fallback: dev
teams:
  dev:
    mode: invalid_mode
    agents:
      w: { name: W, role: Worker, goal: Work, tools: [] }
    capabilities: []
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError for invalid guardrailRetries", () => {
    const yaml = `
name: bad-retries
router:
  fallback: dev
teams:
  dev:
    agents:
      w: { name: W, role: Worker, goal: Work, tools: [] }
    capabilities:
      - name: tool
        description: desc
        tags: []
        guardrailRetries: -1
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError for invalid outputSchema (non-object)", () => {
    const yaml = `
name: bad-schema
router:
  fallback: dev
teams:
  dev:
    agents:
      w: { name: W, role: Worker, goal: Work, tools: [] }
    capabilities:
      - name: tool
        description: desc
        tags: []
        outputSchema: "not-an-object"
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("parses team without mode (defaults to undefined/sequential)", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    expect(app.teams["development"]!.mode).toBeUndefined();
  });
});

describe("validateAppGraph", () => {
  it("returns null for a valid app", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    expect(validateAppGraph(app)).toBeNull();
  });

  it("returns AppLoaderError for dangling team ref in router fallback", () => {
    // Build a valid app then mutate the router to reference a non-existent team
    const app = parseAppYaml(SAMPLE_YAML);
    const brokenApp = {
      ...app,
      router: { ...app.router, fallback: "nonexistent-team" },
    };
    const result = validateAppGraph(brokenApp);
    expect(result).toBeInstanceOf(AppLoaderError);
    expect(result!.errors.some((e) => e.field.includes("router.fallback"))).toBe(true);
  });

  it("returns AppLoaderError when teams is empty", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    const brokenApp = { ...app, teams: {} };
    const result = validateAppGraph(brokenApp);
    expect(result).toBeInstanceOf(AppLoaderError);
  });

});

describe("trigger YAML parsing", () => {
  const BASE_YAML = `
name: trigger-app


router:
  fallback: ops

teams:
  ops:
    agents:
      worker:
        name: Worker
        role: Ops Worker
        goal: Handle ops tasks
        tools: []
    capabilities: []
`;

  it("parses app without triggers", () => {
    const app = parseAppYaml(BASE_YAML);
    expect(app.triggers).toBeUndefined();
  });

  it("parses webhook trigger", () => {
    const yaml = BASE_YAML + `
triggers:
  - name: on-deploy
    type: webhook
    team: ops
    path: /hooks/deploy
    method: PUT
    secretEnv: DEPLOY_SECRET
    task: "Deploy {{payload.url}}"
`;
    const app = parseAppYaml(yaml);
    expect(app.triggers).toHaveLength(1);
    const t = app.triggers![0]!;
    expect(t.type).toBe("webhook");
    expect(t.name).toBe("on-deploy");
    expect(t.team).toBe("ops");
    if (t.type === "webhook") {
      expect(t.path).toBe("/hooks/deploy");
      expect(t.method).toBe("PUT");
      expect(t.secretEnv).toBe("DEPLOY_SECRET");
    }
    expect(t.task).toBe("Deploy {{payload.url}}");
  });

  it("parses event trigger", () => {
    const yaml = BASE_YAML + `
triggers:
  - name: on-error
    type: event
    team: ops
    event: error
    filter:
      code: PROVIDER_UNAVAILABLE
`;
    const app = parseAppYaml(yaml);
    expect(app.triggers).toHaveLength(1);
    const t = app.triggers![0]!;
    expect(t.type).toBe("event");
    if (t.type === "event") {
      expect(t.event).toBe("error");
      expect(t.filter).toEqual({ code: "PROVIDER_UNAVAILABLE" });
    }
  });

  it("parses schedule trigger", () => {
    const yaml = BASE_YAML + `
triggers:
  - name: nightly-audit
    type: schedule
    team: ops
    cron: "0 2 * * *"
    timezone: America/Tijuana
`;
    const app = parseAppYaml(yaml);
    expect(app.triggers).toHaveLength(1);
    const t = app.triggers![0]!;
    expect(t.type).toBe("schedule");
    if (t.type === "schedule") {
      expect(t.cron).toBe("0 2 * * *");
      expect(t.timezone).toBe("America/Tijuana");
    }
  });

  it("parses multiple triggers", () => {
    const yaml = BASE_YAML + `
triggers:
  - name: hook-a
    type: webhook
    team: ops
    path: /hooks/a
  - name: on-error
    type: event
    team: ops
    event: error
  - name: nightly
    type: schedule
    team: ops
    cron: "0 0 * * *"
`;
    const app = parseAppYaml(yaml);
    expect(app.triggers).toHaveLength(3);
    expect(app.triggers![0]!.type).toBe("webhook");
    expect(app.triggers![1]!.type).toBe("event");
    expect(app.triggers![2]!.type).toBe("schedule");
  });

  it("parses trigger with enabled flag", () => {
    const yaml = BASE_YAML + `
triggers:
  - name: disabled-hook
    type: webhook
    team: ops
    path: /hooks/disabled
    enabled: false
`;
    const app = parseAppYaml(yaml);
    expect(app.triggers![0]!.enabled).toBe(false);
  });

  it("throws AppLoaderError for trigger with invalid type", () => {
    const yaml = BASE_YAML + `
triggers:
  - name: bad
    type: invalid
    team: ops
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError for trigger missing name", () => {
    const yaml = BASE_YAML + `
triggers:
  - type: webhook
    team: ops
    path: /hooks/test
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError for trigger missing team", () => {
    const yaml = BASE_YAML + `
triggers:
  - name: bad
    type: webhook
    path: /hooks/test
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError for webhook trigger missing path", () => {
    const yaml = BASE_YAML + `
triggers:
  - name: bad
    type: webhook
    team: ops
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError for event trigger missing event", () => {
    const yaml = BASE_YAML + `
triggers:
  - name: bad
    type: event
    team: ops
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError for schedule trigger missing cron", () => {
    const yaml = BASE_YAML + `
triggers:
  - name: bad
    type: schedule
    team: ops
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError for non-array triggers", () => {
    const yaml = BASE_YAML + `
triggers:
  not: an-array
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

});
