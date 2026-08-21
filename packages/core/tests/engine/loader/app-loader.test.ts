import { describe, it, expect } from "vitest";
import { parseAppYaml, validateAppGraph, AppLoaderError } from "../../../src/engine/loader/app-loader.js";

const SAMPLE_YAML = `
name: my-app
channels: [web, cli]

memory:
  scopes: [user, "project:default"]
  backend: sqlite+fts5
  sync: git

router:
  rules:
    - match: "bug|fix"
      team: hotfix
  fallback: development

teams:
  development:
    agents:
      architect:
        name: Aria
        role: Senior Architect
        goal: Design robust, maintainable solutions with minimal complexity
        tier: reasoning
        tools: []
      worker:
        name: Marcus
        role: Implementation Specialist
        goal: Write clean, well-tested code that follows team conventions
        tier: coding
        tools: [code_edit]
        count: 2
        sandbox: true
    workflow:
      phases: [analyze, implement, verify]
      gates:
        verify:
          requires: [tests_pass]
    capabilities:
      - name: code_edit
        description: Edit code files
        tags: [coding]
    qualityGates:
      - name: test
        command: "vitest run"
        description: Run tests
        required: true
  hotfix:
    agents:
      fixer:
        name: FixBot
        role: Hotfix Specialist
        goal: Quickly fix production issues
        tier: coding
        tools: [code_edit]
    workflow:
      phases: [fix, verify]
      gates:
        verify:
          requires: [tests_pass]
    capabilities:
      - name: code_edit
        description: Edit code files
        tags: [coding]
    qualityGates:
      - name: test
        command: "vitest run"
        description: Run tests
        required: true
`;

describe("parseAppYaml", () => {
  it("parses valid YAML into correct App structure", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    expect(app.name).toBe("my-app");
    expect(app.channels).toEqual(["web", "cli"]);
    expect(Object.keys(app.teams)).toContain("development");
    expect(Object.keys(app.teams)).toContain("hotfix");
  });

  it("correctly maps agents with identity fields and tiers", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    const devTeam = app.teams["development"]!;
    const architect = devTeam.agents["architect"]!;
    expect(architect.name).toBe("Aria");
    expect(architect.role).toBe("Senior Architect");
    expect(architect.goal).toBe("Design robust, maintainable solutions with minimal complexity");
    expect(architect.tier).toBe("reasoning");
    expect(architect.tools).toEqual([]);

    const worker = devTeam.agents["worker"]!;
    expect(worker.name).toBe("Marcus");
    expect(worker.role).toBe("Implementation Specialist");
    expect(worker.goal).toBe("Write clean, well-tested code that follows team conventions");
    expect(worker.tier).toBe("coding");
    expect(worker.tools).toEqual(["code_edit"]);
    expect(worker.count).toBe(2);
    expect(worker.sandbox).toBe(true);
  });

  it("handles workflow phases and gates", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    const wf = app.teams["development"]!.workflow;
    expect(wf.phases).toEqual(["analyze", "implement", "verify"]);
    expect(wf.gates["verify"]).toEqual({ requires: ["tests_pass"] });
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
channels: [cli]
memory:
  scopes: [user]
  backend: sqlite+fts5
router:
  rules: []
  fallback: dev
teams:
  dev:
    agents:
      w: { name: W, role: Worker, goal: Work, tier: coding, tools: [read_status] }
    workflow: { phases: [work], gates: {} }
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
    qualityGates: []
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
channels: [cli]
memory:
  scopes: [user]
  backend: sqlite+fts5
router:
  rules: []
  fallback: dev
teams:
  dev:
    agents:
      w: { name: W, role: Worker, goal: Work, tier: coding, tools: [bad_tool] }
    workflow: { phases: [work], gates: {} }
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
    qualityGates: []
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("handles quality gates", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    const gates = app.teams["development"]!.qualityGates;
    expect(gates).toHaveLength(1);
    expect(gates[0]!.name).toBe("test");
    expect(gates[0]!.command).toBe("vitest run");
    expect(gates[0]!.required).toBe(true);
  });

  it("handles router rules and classifier", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    expect(app.router.rules).toHaveLength(1);
    expect(app.router.rules[0]!.match).toBe("bug|fix");
    expect(app.router.rules[0]!.team).toBe("hotfix");
    expect(app.router.fallback).toBe("development");
    expect(app.router.classifier).toBeUndefined();
  });

  it("handles router with classifier agent", () => {
    const yaml = `
name: app-with-classifier
channels: [web]

memory:
  scopes: [user]
  backend: sqlite+fts5

router:
  rules: []
  fallback: main
  classifier:
    name: Classifier
    role: Intent Classifier
    goal: Route requests to appropriate teams
    tier: fast
    tools: []

teams:
  main:
    agents:
      worker:
        name: Worker
        role: Implementation Specialist
        goal: Write clean code
        tier: coding
        tools: []
    workflow:
      phases: [work]
      gates: {}
    capabilities: []
    qualityGates: []
`;
    const app = parseAppYaml(yaml);
    expect(app.router.classifier).toBeDefined();
    expect(app.router.classifier!.tier).toBe("fast");
    expect(app.router.classifier!.name).toBe("Classifier");
    expect(app.router.classifier!.role).toBe("Intent Classifier");
    expect(app.router.classifier!.goal).toBe("Route requests to appropriate teams");
  });

  it("handles memory config", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    expect(app.memory.scopes).toContain("user");
    expect(app.memory.scopes).toContain("project:default");
    expect(app.memory.backend).toBe("sqlite+fts5");
    expect(app.memory.sync).toBe("git");
  });

  it("handles memory config without sync", () => {
    const yaml = `
name: minimal-app
channels: [cli]

memory:
  scopes: [user]
  backend: sqlite+fts5

router:
  rules: []
  fallback: solo

teams:
  solo:
    agents:
      worker:
        name: Solo
        role: Generalist
        goal: Handle all tasks
        tier: coding
        tools: []
    workflow:
      phases: [work]
      gates: {}
    capabilities: []
    qualityGates: []
`;
    const app = parseAppYaml(yaml);
    expect(app.memory.sync).toBeUndefined();
  });

  it("parses minimal YAML with one team and no router rules", () => {
    const yaml = `
name: minimal-app
channels: [cli]

memory:
  scopes: [user]
  backend: sqlite+fts5

router:
  rules: []
  fallback: solo

teams:
  solo:
    agents:
      worker:
        name: Solo
        role: Generalist
        goal: Handle all tasks
        tier: coding
        tools: []
    workflow:
      phases: [work]
      gates: {}
    capabilities: []
    qualityGates: []
`;
    const app = parseAppYaml(yaml);
    expect(app.name).toBe("minimal-app");
    expect(Object.keys(app.teams)).toEqual(["solo"]);
    expect(app.router.rules).toHaveLength(0);
  });

  it("maps MCP request timeout config", () => {
    const yaml = `
name: mcp-app
channels: [cli]

memory:
  scopes: [user]
  backend: sqlite+fts5

router:
  rules: []
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
        tier: coding
        tools: []
    workflow:
      phases: [work]
      gates: {}
    capabilities: []
    qualityGates: []
`;

    const app = parseAppYaml(yaml);

    expect(app.mcp?.servers).toEqual(["tools"]);
  });

  it("maps cross-surface voice policy from YAML", () => {
    const yaml = `
name: voice-app
channels: [web, whatsapp]

memory:
  scopes: [user]
  backend: sqlite+fts5

router:
  rules: []
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
        tier: coding
        tools: []
    workflow:
      phases: [work]
      gates: {}
    capabilities: []
    qualityGates: []
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
channels: [gui, tui]

memory:
  scopes: [user]
  backend: sqlite+fts5

router:
  rules: []
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
        tier: coding
        tools: []
    workflow:
      phases: [work]
      gates: {}
    capabilities: []
    qualityGates: []
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

  it("maps governed voice profiles and agent profile references from YAML", () => {
    const yaml = `
name: profiled-voice-app
channels: [gui, tui]

memory:
  scopes: [user]
  backend: sqlite+fts5

router:
  rules: []
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
        tier: coding
        tools: []
        voiceProfile: english-default
    workflow:
      phases: [work]
      gates: {}
    capabilities: []
    qualityGates: []
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
    expect(app.teams.solo?.agents.assistant?.voiceProfile).toBe("english-default");
  });

  it("throws AppLoaderError for invalid MCP request timeout config", () => {
    const yaml = `
name: mcp-app
channels: [cli]

memory:
  scopes: [user]
  backend: sqlite+fts5

router:
  rules: []
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
        tier: coding
        tools: []
    workflow:
      phases: [work]
      gates: {}
    capabilities: []
    qualityGates: []
`;

    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("supports quality key as alias for qualityGates", () => {
    const yaml = `
name: alias-app
channels: [cli]

memory:
  scopes: [user]
  backend: sqlite+fts5

router:
  rules: []
  fallback: solo

teams:
  solo:
    agents:
      worker:
        name: Solo
        role: Generalist
        goal: Handle all tasks
        tier: coding
        tools: []
    workflow:
      phases: [work]
      gates: {}
    capabilities: []
    quality:
      - name: lint
        command: "biome check"
        description: Lint check
        required: true
`;
    const app = parseAppYaml(yaml);
    expect(app.teams["solo"]!.qualityGates[0]!.name).toBe("lint");
  });

  it("loads backstory and instructions from agent YAML", () => {
    const yaml = `
name: identity-app
channels: [cli]

memory:
  scopes: [user]
  backend: sqlite+fts5

router:
  rules: []
  fallback: solo

teams:
  solo:
    agents:
      writer:
        name: Aria
        role: Senior Architect
        goal: Design robust solutions
        tier: reasoning
        tools: []
        backstory: Pragmatic architect who values simplicity.
        instructions: Always write tests before implementation.
    workflow:
      phases: [work]
      gates: {}
    capabilities: []
    qualityGates: []
`;
    const app = parseAppYaml(yaml);
    const agent = app.teams["solo"]!.agents["writer"]!;
    expect(agent.backstory).toBe("Pragmatic architect who values simplicity.");
    expect(agent.instructions).toBe("Always write tests before implementation.");
  });

  it("trims whitespace from backstory and instructions", () => {
    const yaml = `
name: trim-app
channels: [cli]

memory:
  scopes: [user]
  backend: sqlite+fts5

router:
  rules: []
  fallback: solo

teams:
  solo:
    agents:
      writer:
        name: Aria
        role: Senior Architect
        goal: Design robust solutions
        tier: reasoning
        tools: []
        backstory: "  padded backstory  "
        instructions: "  padded instructions  "
    workflow:
      phases: [work]
      gates: {}
    capabilities: []
    qualityGates: []
`;
    const app = parseAppYaml(yaml);
    const agent = app.teams["solo"]!.agents["writer"]!;
    expect(agent.backstory).toBe("padded backstory");
    expect(agent.instructions).toBe("padded instructions");
  });

  it("throws AppLoaderError when agent role is whitespace-only", () => {
    const yaml = `
name: bad-role
channels: [cli]
memory:
  scopes: [user]
  backend: sqlite+fts5
router:
  rules: []
  fallback: t
teams:
  t:
    agents:
      w: { name: W, role: "   ", goal: Work, tier: coding, tools: [] }
    workflow: { phases: [work], gates: {} }
    capabilities: []
    qualityGates: []
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError for invalid YAML structure", () => {
    expect(() => parseAppYaml("not: valid: yaml:::::")).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError when name is missing", () => {
    const yaml = `
channels: [web]
memory:
  scopes: [user]
  backend: sqlite+fts5
router:
  rules: []
  fallback: main
teams:
  main:
    agents:
      w: { name: W, role: Worker, goal: Work, tier: coding, tools: [] }
    workflow: { phases: [work], gates: {} }
    capabilities: []
    qualityGates: []
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError when agent tier is invalid", () => {
    const yaml = `
name: bad-tier
channels: [cli]
memory:
  scopes: [user]
  backend: sqlite+fts5
router:
  rules: []
  fallback: t
teams:
  t:
    agents:
      w: { name: W, role: Worker, goal: Work, tier: superfast, tools: [] }
    workflow: { phases: [work], gates: {} }
    capabilities: []
    qualityGates: []
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError when agent role is missing", () => {
    const yaml = `
name: bad-agent
channels: [cli]
memory:
  scopes: [user]
  backend: sqlite+fts5
router:
  rules: []
  fallback: t
teams:
  t:
    agents:
      w: { name: W, goal: Work, tier: coding, tools: [] }
    workflow: { phases: [work], gates: {} }
    capabilities: []
    qualityGates: []
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError when agent goal is missing", () => {
    const yaml = `
name: bad-agent
channels: [cli]
memory:
  scopes: [user]
  backend: sqlite+fts5
router:
  rules: []
  fallback: t
teams:
  t:
    agents:
      w: { name: W, role: Worker, tier: coding, tools: [] }
    workflow: { phases: [work], gates: {} }
    capabilities: []
    qualityGates: []
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError when agent name is missing", () => {
    const yaml = `
name: bad-agent
channels: [cli]
memory:
  scopes: [user]
  backend: sqlite+fts5
router:
  rules: []
  fallback: t
teams:
  t:
    agents:
      w: { role: Worker, goal: Work, tier: coding, tools: [] }
    workflow: { phases: [work], gates: {} }
    capabilities: []
    qualityGates: []
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError when YAML root is not an object", () => {
    expect(() => parseAppYaml("- just a list")).toThrow(AppLoaderError);
  });

  it("parses supervisor team mode with manager", () => {
    const yaml = `
name: supervisor-app
channels: [cli]
memory:
  scopes: [user]
  backend: sqlite+fts5
router:
  rules: []
  fallback: dev
teams:
  dev:
    mode: supervisor
    manager: architect
    agents:
      architect:
        name: Aria
        role: Senior Architect
        goal: Design solutions
        tier: reasoning
        tools: []
      worker:
        name: Marcus
        role: Coder
        goal: Write code
        tier: coding
        tools: []
    workflow:
      phases: [plan, implement]
      gates: {}
    capabilities: []
    qualityGates: []
`;
    const app = parseAppYaml(yaml);
    expect(app.teams["dev"]!.mode).toBe("supervisor");
    expect(app.teams["dev"]!.manager).toBe("architect");
  });

  it("throws AppLoaderError for removed swarm team mode", () => {
    const yaml = `
name: swarm-app
channels: [cli]
memory:
  scopes: [user]
  backend: sqlite+fts5
router:
  rules: []
  fallback: dev
teams:
  dev:
    mode: swarm
    agents:
      alpha:
        name: Alpha
        role: Worker A
        goal: Work on tasks
        tier: coding
        tools: [handoff_tool]
      beta:
        name: Beta
        role: Worker B
        goal: Work on tasks
        tier: coding
        tools: [handoff_tool]
    workflow:
      phases: [execute]
      gates: {}
    capabilities:
      - name: handoff_tool
        description: Hand off to another agent
        type: handoff
        tags: [swarm]
    qualityGates: []
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("parses capability with guardrail fields", () => {
    const yaml = `
name: guardrail-app
channels: [cli]
memory:
  scopes: [user]
  backend: sqlite+fts5
router:
  rules: []
  fallback: dev
teams:
  dev:
    agents:
      worker:
        name: Worker
        role: Coder
        goal: Write code
        tier: coding
        tools: [guarded_tool]
    workflow:
      phases: [work]
      gates: {}
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
    qualityGates: []
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
channels: [cli]
memory:
  scopes: [user]
  backend: sqlite+fts5
router:
  rules: []
  fallback: dev
teams:
  dev:
    mode: invalid_mode
    agents:
      w: { name: W, role: Worker, goal: Work, tier: coding, tools: [] }
    workflow: { phases: [work], gates: {} }
    capabilities: []
    qualityGates: []
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError for invalid guardrailRetries", () => {
    const yaml = `
name: bad-retries
channels: [cli]
memory:
  scopes: [user]
  backend: sqlite+fts5
router:
  rules: []
  fallback: dev
teams:
  dev:
    agents:
      w: { name: W, role: Worker, goal: Work, tier: coding, tools: [] }
    workflow: { phases: [work], gates: {} }
    capabilities:
      - name: tool
        description: desc
        tags: []
        guardrailRetries: -1
    qualityGates: []
`;
    expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
  });

  it("throws AppLoaderError for invalid outputSchema (non-object)", () => {
    const yaml = `
name: bad-schema
channels: [cli]
memory:
  scopes: [user]
  backend: sqlite+fts5
router:
  rules: []
  fallback: dev
teams:
  dev:
    agents:
      w: { name: W, role: Worker, goal: Work, tier: coding, tools: [] }
    workflow: { phases: [work], gates: {} }
    capabilities:
      - name: tool
        description: desc
        tags: []
        outputSchema: "not-an-object"
    qualityGates: []
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

  it("returns AppLoaderError for dangling team ref in router rules", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    const brokenApp = {
      ...app,
      router: {
        ...app.router,
        rules: [{ match: "bug", team: "ghost-team" }],
      },
    };
    const result = validateAppGraph(brokenApp);
    expect(result).toBeInstanceOf(AppLoaderError);
    expect(result!.errors.some((e) => e.message.includes("ghost-team"))).toBe(true);
  });

  it("returns AppLoaderError when teams is empty", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    const brokenApp = { ...app, teams: {} };
    const result = validateAppGraph(brokenApp);
    expect(result).toBeInstanceOf(AppLoaderError);
  });

  it("returns AppLoaderError when channels is empty", () => {
    const app = parseAppYaml(SAMPLE_YAML);
    const brokenApp = { ...app, channels: [] };
    const result = validateAppGraph(brokenApp);
    expect(result).toBeInstanceOf(AppLoaderError);
  });
});

describe("trigger YAML parsing", () => {
  const BASE_YAML = `
name: trigger-app
channels: [cli]

memory:
  scopes: [user]
  backend: sqlite+fts5

router:
  rules: []
  fallback: ops

teams:
  ops:
    agents:
      worker:
        name: Worker
        role: Ops Worker
        goal: Handle ops tasks
        tier: coding
        tools: []
    workflow:
      phases: [work]
      gates: {}
    capabilities: []
    qualityGates: []
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

  describe("eval parsing", () => {
    it("parses eval block with datasets, scorers, and experiments", () => {
      const yaml = BASE_YAML + `
eval:
  datasets:
    - name: test-ds
      path: ./data.jsonl
  scorers:
    - name: accuracy
      type: exact-match
    - name: speed
      type: latency
      maxLatencyMs: 5000
  experiments:
    - name: exp1
      dataset: test-ds
      team: ops
      scorers: [accuracy, speed]
`;
      const app = parseAppYaml(yaml);
      expect(app.eval).toBeDefined();
      expect(app.eval?.datasets).toHaveLength(1);
      expect(app.eval?.datasets[0]?.name).toBe("test-ds");
      expect(app.eval?.scorers).toHaveLength(2);
      expect(app.eval?.experiments).toHaveLength(1);
      expect(app.eval?.experiments[0]?.team).toBe("ops");
    });

    it("parses composite scorer with sub-scorers", () => {
      const yaml = BASE_YAML + `
eval:
  datasets:
    - name: ds1
      path: ./data.jsonl
  scorers:
    - name: composite-scorer
      type: composite
      scorers:
        - name: exact
          type: exact-match
        - name: contains-check
          type: contains
          substrings: ["hello", "world"]
  experiments:
    - name: exp1
      dataset: ds1
      team: ops
      scorers: [composite-scorer]
`;
      const app = parseAppYaml(yaml);
      expect(app.eval?.scorers[0]?.type).toBe("composite");
      expect(app.eval?.scorers[0]?.scorers).toHaveLength(2);
    });

    it("throws AppLoaderError for missing eval.datasets", () => {
      const yaml = BASE_YAML + `
eval:
  scorers:
    - name: s1
      type: exact-match
  experiments:
    - name: e1
      dataset: ds1
      team: ops
      scorers: [s1]
`;
      expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
    });

    it("throws AppLoaderError for missing eval.scorers", () => {
      const yaml = BASE_YAML + `
eval:
  datasets:
    - name: ds1
      path: ./data.jsonl
  experiments:
    - name: e1
      dataset: ds1
      team: ops
      scorers: []
`;
      expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
    });

    it("throws AppLoaderError for experiment referencing unknown dataset", () => {
      const yaml = BASE_YAML + `
eval:
  datasets:
    - name: ds1
      path: ./data.jsonl
  scorers:
    - name: s1
      type: exact-match
  experiments:
    - name: e1
      dataset: nonexistent
      team: ops
      scorers: [s1]
`;
      expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
    });

    it("throws AppLoaderError for invalid scorer type", () => {
      const yaml = BASE_YAML + `
eval:
  datasets:
    - name: ds1
      path: ./data.jsonl
  scorers:
    - name: s1
      type: my-typo
  experiments:
    - name: e1
      dataset: ds1
      team: ops
      scorers: [s1]
`;
      expect(() => parseAppYaml(yaml)).toThrow(AppLoaderError);
    });

    it("returns undefined eval when not present", () => {
      const app = parseAppYaml(BASE_YAML);
      expect(app.eval).toBeUndefined();
    });
  });
});
