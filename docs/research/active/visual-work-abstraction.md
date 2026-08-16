# Visual Work Abstraction Research

Status: active issue-backed research

Owner: issue #9

Evidence cutoff: 2026-08-04

Promotion target: an admitted visual-work architecture or roadmap contract.

Exit condition: record an explicit adoption or rejection decision, preserve
reusable evaluation evidence, and delete this research note.

## Purpose

This note records primary-source research on governed GUI/visual agents to inform
the redesign of `visual-reference-research` into conditional visual-work
contracts (GitHub issue #9). It maps the current state of practice across major
labs, benchmarks, community signal, and cloned harnesses. It does not propose a
vendor-specific architecture. The evidence should inform the contract shape,
not dictate tool choices.

## Scope

Sources reviewed between 2026-08-03 and 2026-08-04:

- Anthropic Computer Use tool documentation:
  https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool
- OpenAI Computer Use (CUA) documentation:
  https://developers.openai.com/api/docs/guides/tools-computer-use
- Anthropic, "Effective harnesses for long-running agents" (2025-11-26):
  https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- OSWorld (Xie et al., 2024): https://arxiv.org/abs/2404.07972
- WebArena (Zhou et al., 2023): https://arxiv.org/abs/2307.13854
- UGround — Universal Visual Grounding for GUI Agents (Gou et al., 2024):
  https://arxiv.org/abs/2410.05243
- WebPilot — Strategic Exploration for Web Agents (Zhang et al., 2024):
  https://arxiv.org/abs/2408.15978
- Figma MCP blog series (2026):
  https://www.figma.com/blog/figma-mcp/
- screenshot-to-code (Abi Noda, 73.8k stars):
  https://github.com/abi/screenshot-to-code
- Cloned Codex source: `C:\Proyectos\Sequel\cloned\codex\codex-rs\`
- Cloned OpenCode source: `C:\Proyectos\Sequel\cloned\opencode\packages\opencode\src\`
- Cloned Gemini CLI source: `C:\Proyectos\Sequel\cloned\gemini-cli\packages\core\src\agents\browser\`
- Existing Kiln research notes: #14 (live browser operator surface),
  #11 (agent tooling surface), #12 (agent tooling next surface)

---

## 1. Major Labs: Computer-Use Perception/Reasoning/Action Loops

### Anthropic Computer Use

Anthropic's computer use tool provides screenshot capture, mouse control, and
keyboard input for autonomous desktop interaction. The model does not own the
browser or desktop; the **harness owns action execution, screenshot capture,
policy, and escalation**. The API returns `tool_use` with structured actions;
the application executes them and returns screenshots as `tool_result`.

Key mechanics:

- **Agent loop**: model requests actions → harness executes → harness returns
  screenshot → model analyzes → repeat until task complete or model stops.
- **Screenshot-as-sensor**: the model sees the UI only through screenshots the
  harness provides. The harness is the ground truth for what actually rendered.
- **Prompting for verification**: Anthropic explicitly recommends prompting
  "After each step, take a screenshot and carefully evaluate if you have
  achieved the right outcome." This acknowledges that the model can skip
  verification without explicit instruction.
- **Prompt injection defense**: classifiers run on screenshots to flag
  potential prompt injections from page content and steer the model to ask for
  user confirmation.
- **Zoom capability** (2025-11-24 version): model can zoom into specific
  screen regions at full resolution for small text or specific UI elements.
- **Security posture**: dedicated VM/container, avoid sensitive data, limit
  internet to domain allowlists, human confirmation for consequential actions.

Source: Anthropic Computer Use docs, URL above.

### OpenAI Computer Use (CUA)

OpenAI's computer use follows the same screenshot-action-result loop. The
documentation explicitly describes three integration paths:

1. **Built-in Computer use loop**: model returns structured UI actions
   (clicks, typing, scrolling) via `computer_call`; harness executes; harness
   returns screenshot as `computer_call_output`.
2. **Custom tool or harness**: model drives existing Playwright, Selenium,
   VNC, or MCP-based harness through normal tool calling.
3. **Code-execution harness**: model writes and runs short scripts, moving
   flexibly between visual and programmatic UI interaction.

Key mechanics:

- **Screenshot-first turns**: the model often requests a screenshot before
  committing to actions. This is normal and expected.
- **Batched actions**: a single `computer_call` can contain multiple actions
  that must be executed in order before the next screenshot.
- **`detail: "original"`**: OpenAI recommends original-resolution screenshots
  for computer use, noting that downscaled images reduce click accuracy.
- **Safety**: "Run Computer use in an isolated browser or VM, keep a human in
  the loop for high-impact actions, and treat page content as untrusted input."

Source: OpenAI CUA docs, URL above.

### Google Project Mariner / Gemini CLI Browser Agent

Google's Project Mariner (announced December 2024) is a Chrome extension that
uses Gemini to navigate websites. The cloned Gemini CLI source reveals a
sophisticated browser agent architecture (see Section 4 below).

Source: Google DeepMind, https://deepmind.google/technologies/ (Project Mariner
page no longer available at original URL; confirmed through Gemini CLI source
analysis).

---

## 2. Benchmarks: GUI Grounding and End-to-End Verification

### OSWorld (arXiv:2404.07972)

OSWorld is the first scalable, real computer environment for multimodal
agents. 369 tasks across web/desktop apps, OS file I/O, and multi-app
workflows.

**Critical finding**: best model achieves only **12.24% success** vs. humans at
**72.36%**. Primary failure modes are **GUI grounding** (mapping language to
pixel coordinates) and **operational knowledge** (knowing how applications
work).

**Verification approach**: each task has a custom **execution-based evaluation
script** — not screenshot comparison, but actual state verification (file
contents, application state, DOM properties). This is the key insight:
**screenshot pixels alone are insufficient proof of task completion**.

Source: Xie et al., 2024, https://arxiv.org/abs/2404.07972

### WebArena (arXiv:2307.13854)

WebArena provides realistic web environments with fully functional websites
(e-commerce, social forums, collaborative development, CMS).

**Critical finding**: best GPT-4-based agent achieves **14.41% success** vs.
humans at **78.24%**. Tasks are long-horizon and require functional correctness.

**Verification approach**: execution-based evaluation checking actual database
state, page content, and functional outcomes — not visual similarity.

Source: Zhou et al., 2023, https://arxiv.org/abs/2307.13854

### UGround — Universal Visual Grounding (arXiv:2410.05243)

UGround advocates for GUI agents that perceive entirely visually and perform
pixel-level operations, without relying on HTML or accessibility trees.

**Critical finding**: visual grounding models can substantially outperform
text-based approaches (up to 20% absolute improvement). Agents with UGround
outperform state-of-the-art agents that use additional text-based input.

**Dataset**: 10M GUI elements and their referring expressions over 1.3M
screenshots — the largest GUI visual grounding dataset.

**Implication**: visual grounding is a distinct capability from task
completion. An agent can ground elements visually but still fail at multi-step
task execution. The contract must separate "can I find this element?" from
"did the task succeed?"

Source: Gou et al., 2024, ICLR 2025 Oral, https://arxiv.org/abs/2410.05243

### WebPilot (arXiv:2408.15978)

WebPilot uses a dual optimization strategy (global planning + local MCTS
execution) for complex web tasks.

**Critical finding**: achieves 93% relative improvement over concurrent tree
search methods on WebArena. The key insight is that **strategic exploration**
— knowing when to explore, when to commit, and when to backtrack — is
essential for reliable web agent behavior.

**Implication**: exploration is a distinct phase from execution. The contract
must represent exploration decisions separately from implementation and
verification.

Source: Zhang et al., 2024, https://arxiv.org/abs/2408.15978

---

## 3. Screenshot/Rendered-State Evidence as Completion Signal

### Anthropic Long-Running Agent Harness (2025-11)

Anthropic's engineering blog on effective harnesses for long-running agents
provides the most direct evidence on what makes rendered-state verification
work:

1. **Feature list as verification contract**: a structured JSON file with
   end-to-end feature descriptions, each with explicit verification steps and
   a `passes` boolean. Features start as `failing` and are only marked
   `passing` after careful testing.

2. **Browser automation as verification tool**: Claude uses Puppeteer MCP to
   test features end-to-end as a human user would. "Providing Claude with
   these kinds of testing tools dramatically improved performance, as the
   agent was able to identify and fix bugs that weren't obvious from the code
   alone."

3. **Known verification gaps**: "Claude can't see browser-native alert modals
   through the Puppeteer MCP, and features relying on these modals tended to
   be buggier as a result." This proves that **browser tool invocation is a
   capability, not completion evidence** — the tool has blind spots that must
   be named.

4. **Run verification at session start, not only after implementation**:
   "run end-to-end verification at the start of each session, not only after
   implementation. Browser-based checks catch regressions from prior sessions
   that code-level review alone misses."

5. **Self-assessment is not completion**: the most common failure mode was
   "Claude marks features as done prematurely." The fix was explicit
   verification steps, not better prompting about quality.

Source: Anthropic Engineering, "Effective harnesses for long-running agents,"
2025-11-26, URL above.

### What Makes a Screenshot Sufficient Proof?

Evidence across sources converges on these requirements for rendered-state
proof:

- **Target/build identity**: which application, which build, which URL was
  verified. A screenshot without target identity is unverifiable.
  (OSWorld/WebArena: evaluation scripts check actual application state, not
  just pixels.)
- **Exercised states**: which UI states were visited (pages, modals, error
  states, responsive breakpoints). A single screenshot proves one state, not
  the application. (Anthropic harness: feature lists enumerate specific
  verification steps.)
- **Expected vs. observed verdict**: an explicit judgment against a known
  expected outcome. A screenshot without a verdict is just an image.
  (Anthropic harness: `passes: true/false` with explicit steps.)
- **Tool limitations named**: what the verification tool cannot see (alert
  modals, animations, accessibility tree gaps). (Anthropic harness: Puppeteer
  MCP blind spots explicitly documented.)

---

## 4. Design-Context Integrations

### Figma MCP

Figma's MCP server (announced 2025, expanded through 2026) provides AI agents
with structured access to design files, components, tokens, and layout
information. The Figma blog ecosystem documents multiple integration patterns:

- **Authoritative design context**: Figma MCP provides the design source of
  truth — components, spacing, colors, typography — that coding agents can
  consume directly. This is authoritative when present.
- **Bidirectional flow**: "From Claude Code to Figma" (Feb 2026) and "Codex
  to Figma" (Feb 2026) demonstrate that production code can be imported back
  into Figma for design review, creating a closed loop.
- **Canvas-level agent access** (March 2026): agents can now design directly
  on the Figma canvas, not just read from it.
- **Skills system** (July 2026): teams can guide agents with context about
  their specific design decisions and intent.

**Implication**: when Figma MCP or equivalent design-context access is
available, it is the authoritative visual direction. External exploration is
unnecessary and potentially contradictory. The contract must represent
design-context availability and authority explicitly.

Source: Figma blog, https://www.figma.com/blog/figma-mcp/ (multiple articles,
2026).

### Screenshot-to-Code

The `screenshot-to-code` project (73.8k GitHub stars) converts screenshots,
mockups, Figma designs, and screen recordings into clean functional code.

Key patterns:

- **Multi-model pipeline**: uses different models for code generation
  (Gemini, GPT, Claude), asset extraction (Gemini), and image generation
  (Replicate). No single model does everything.
- **Screenshot preview as self-verification**: the app can render its own
  generated page in a headless browser and visually check its work. This is
  the same pattern as Anthropic's long-running agent harness.
- **Stack-specific output**: HTML+Tailwind, React+Tailwind, Vue+Tailwind,
  Bootstrap, Ionic — the output target matters for verification.

**Implication**: screenshot-to-code pipelines demonstrate that visual input →
code output → visual verification is a real workflow pattern, not a
theoretical one. The contract must support this loop.

Source: https://github.com/abi/screenshot-to-code

---

## 5. Safety and Independent Evaluation

### Computer-Use Safety (Cross-Lab Convergence)

All three major labs converge on the same safety requirements:

1. **Sandboxing**: dedicated VM/container with minimal privileges.
2. **Domain allowlisting**: limit internet access to approved domains.
3. **Human-in-the-loop**: confirm consequential actions (financial
   transactions, data submission, terms acceptance).
4. **Prompt injection defense**: treat page content as untrusted input;
   classifiers detect injection attempts in screenshots.
5. **Sensitive data isolation**: avoid giving the model access to credentials
   or personal data.

Anthropic adds a specific defense: classifiers automatically run on prompts to
flag potential prompt injections from screenshots, steering the model to ask
for user confirmation.

OpenAI states: "treat screenshots, page text, tool outputs, PDFs, emails,
chats, and other third-party content as untrusted input. Only direct
instructions from the user count as permission."

**Implication**: visual work contracts must encode safety boundaries (domain
policy, action approval, data isolation) as first-class properties, not
afterthoughts. The contract must be able to express "this action was blocked
by policy" as a verification outcome.

Sources: Anthropic Computer Use docs; OpenAI CUA docs; both URLs above.

### Verification Gaps and Independent Review

The evidence identifies recurring verification gaps:

- **Browser-native modals**: alert(), confirm(), prompt() dialogs are
  invisible to Puppeteer MCP (Anthropic harness).
- **CSS animations and transitions**: screenshot timing can miss or capture
  intermediate states.
- **Accessibility tree vs. visual rendering**: elements can be visually
  present but accessibility-invisible, or vice versa (UGround paper).
- **Responsive states**: a single viewport proves one breakpoint, not all.
- **Model self-assessment**: the most common failure mode across all
  benchmarks is the model declaring success without adequate verification.

**Implication**: independent design review must be structurally distinct from
implementation self-assessment and from rendered verification. The same agent
that implemented the change should not be the sole verifier.

---

## 6. Cloned Harness Evidence

### Codex (`codex-rs/`)

**Visual/UI capabilities found**:

- **Image input**: full image attachment pipeline with base64 data URI
  enforcement. Remote image URLs are explicitly rejected ("remote image URLs
  are not supported in tool outputs. Pass a base64 data URI instead").
- **Image detail levels**: supports `auto`, `low`, `high`, `original` detail
  for image processing. The `original` detail preserves resolution for click
  accuracy — matching OpenAI's CUA recommendation.
- **Image generation**: tracks `image_generation` as a distinct tool category
  with its own analytics.
- **MCP image handling**: accepts raw MCP image blocks with
  `codex/imageDetail` metadata.
- **No browser tool**: the cloned source does not contain a dedicated browser
  automation tool. Visual work would go through MCP or external harness.

**Does it verify rendered state?**: No built-in rendered-state verification.
Image input is for model consumption, not for automated visual regression.

**Does it ingest design context?**: Not natively. Would depend on MCP server
configuration.

**Does it sandbox visual tools?**: Image inputs are sandboxed (base64 only,
no remote URLs). No browser sandbox because no browser tool.

Source: `codex-rs/code-mode/src/service_tests.rs`, `codex-rs/analytics/src/reducer.rs`

### OpenCode (`packages/opencode/src/`)

**Visual/UI capabilities found**:

- **Image attachment pipeline**: `image/image.ts` provides auto-resize with
  configurable `maxWidth`, `maxHeight`, `maxBase64Bytes`. Images are resized
  and converted to PNG or JPEG before model submission.
- **Provider image capability tracking**: `provider/provider.ts` tracks
  `image: true/false` per model for both input and output modalities. Models
  are queried for `modalities?.input?.includes("image")`.
- **MCP browser module**: `mcp/browser.ts` exists as `McpBrowser.Service` —
  used for OAuth flow browser opening (`browser.open(result.authorizationUrl)`),
  not for general browser automation.
- **ACP content handling**: `acp/content.ts` processes image content blocks
  from tool results, converting URIs to model-consumable format.
- **GitHub integration**: `cli/cmd/github.handler.ts` downloads images from
  GitHub issue/PR comments and attaches them to conversations.

**Does it verify rendered state?**: No built-in rendered-state verification.
The MCP browser module is for OAuth authorization flows only.

**Does it ingest design context?**: Not natively. Would depend on MCP server
configuration.

**Does it sandbox visual tools?**: Image resize limits act as a resource
sandbox. The `SECURITY.md` file was not found at the expected path; the
project's security posture for visual tools could not be verified from the
clone.

Source: `packages/opencode/src/image/image.ts`, `packages/opencode/src/mcp/browser.ts`,
`packages/opencode/src/provider/provider.ts`

### Gemini CLI (`packages/core/src/agents/browser/`)

**Visual/UI capabilities found — the most sophisticated of the three clones**:

- **Full browser agent**: a dedicated `browserAgentDefinition.ts` with
  `browserAgentFactory.ts` and `browserAgentInvocation.ts`. The browser agent
  is a first-class sub-agent, not a tool bolt-on.
- **Screenshot analysis**: `analyzeScreenshot.ts` delegates to a computer-use
  model for visual analysis when the accessibility tree is insufficient. The
  system prompt explicitly states: "You are NOT performing actions — you are
  only providing visual analysis." This separates visual perception from
  action execution.
- **Snapshot superseder**: `snapshotSuperseder.ts` manages screenshot
  lifecycle and supersession — newer screenshots replace older ones in context.
- **Input blocker**: `inputBlocker.ts` prevents user input during browser
  agent execution.
- **MCP tool wrapper**: `mcpToolWrapper.ts` wraps Chrome DevTools Protocol
  tools through MCP for browser automation.
- **Browser manager**: `browserManager.ts` manages browser lifecycle,
  process cleanup, and session state.
- **Automation overlay**: `automationOverlay.ts` provides visual indication
  of browser automation status.
- **Model availability**: `modelAvailability.ts` checks for computer-use
  model availability (`isComputerUseModel()`, `getVisualAgentModel()`).
- **Policy enforcement**: integration tests (`browser-policy.test.ts`) verify
  that browser agent requires explicit confirmation and shows visible warnings.

**Does it verify rendered state?**: The browser agent can take screenshots and
analyze them, but the analysis is for navigation/interaction guidance, not
for formal rendered-state verification against an expected outcome.

**Does it ingest design context?**: Not natively. The browser agent works
with live web pages, not design files.

**Does it sandbox visual tools?**: Yes — browser agent requires explicit
confirmation, has input blocking during execution, and has policy enforcement
for allowed domains.

Source: `packages/core/src/agents/browser/*.ts` (17 files)

### Claude Code (native, no clone)

**Known capabilities** (from official docs and Anthropic engineering blog):

- **WebSearch and WebFetch tools**: for external research and URL retrieval.
- **Screenshot input**: supports image input for visual context.
- **Puppeteer MCP integration**: used in the long-running agent harness for
  end-to-end browser verification.
- **Computer use tool**: available as a beta feature with screenshot, mouse,
  and keyboard control.
- **Hooks system**: allows project-level shell commands at harness lifecycle
  points, enabling custom verification.

**Does it verify rendered state?**: When configured with Puppeteer MCP, yes —
the long-running agent harness demonstrates end-to-end browser verification
with feature lists and pass/fail tracking.

**Does it ingest design context?**: Through Figma MCP integration (confirmed
by Figma blog: "From Claude Code to Figma," Feb 2026).

**Does it sandbox visual tools?**: Computer use requires sandboxed
environment. Hooks can enforce additional policy.

Source: Anthropic engineering blog, Figma blog, official Claude Code docs.

---

## 7. Big Creators / Community Signal

### Design-Engineering Patterns

The field converges on several patterns for how coding agents handle visual
work:

1. **Visual work is not a single activity**. It decomposes into: understanding
   the design intent, implementing the code, verifying the rendered output,
   and reviewing the design quality. Each has different tools, evidence, and
   failure modes.

2. **Authoritative context beats exploration**. When a Figma file, design
   system, or screenshot reference exists, using it directly produces better
   results than searching the web for inspiration. Exploration is for when
   direction is absent or explicitly requested.

3. **Rendered verification catches what code review misses**. The Anthropic
   long-running agent harness proves this empirically: browser-based
   verification found bugs that unit tests and curl commands did not.

4. **Self-assessment is unreliable**. Across all benchmarks (OSWorld 12.24%,
   WebArena 14.41%), the dominant failure mode is the model declaring success
   without adequate verification. External verification is not optional.

5. **Browser tools have blind spots**. Alert modals, CSS animations,
   responsive breakpoints, and accessibility tree gaps are recurring
   verification failures that must be named in the evidence contract.

### Common Failure Modes When Agents Touch UI Without Governance

From benchmark and community evidence:

- **One-shotting**: agent tries to implement everything at once, runs out of
  context, leaves broken state. (Anthropic harness.)
- **Premature completion**: agent sees progress and declares done. (All
  benchmarks.)
- **No visual verification**: agent writes code, runs unit tests, but never
  checks the rendered output. (Anthropic harness.)
- **Exploration when direction exists**: agent searches the web for design
  ideas when a Figma file already specifies the design. (Inferred from Figma
  MCP adoption patterns.)
- **Pixel-matching without state identity**: agent compares screenshots
  without knowing which build, URL, or state produced them. (OSWorld/WebArena
  evaluation approach.)

---

## 8. Recurring Patterns for the Abstraction

The evidence converges on these patterns that any Kiln visual-work abstraction
must respect:

### Pattern 1: Visual Intent Is Distinct from Evidence, Phase, Route, and Identity

Every source separates "what visual work is needed" from "how it is done" and
"who does it." OSWorld tasks specify the goal; the agent chooses the approach.
Anthropic's harness separates feature requirements from implementation steps.
Figma MCP separates design context from code generation.

**Citation**: OSWorld task structure (arXiv:2404.07972); Anthropic harness
feature list vs. implementation; Figma MCP design-to-code flow.

### Pattern 2: Screenshot-as-Proof Requires Target/Build/State Identity

A screenshot without provenance is not evidence. OSWorld and WebArena both use
execution-based evaluation scripts that check actual application state, not
pixel similarity. The Anthropic harness tracks which feature, which steps, and
which pass/fail verdict.

**Citation**: OSWorld evaluation scripts (arXiv:2404.07972); WebArena
functional correctness checks (arXiv:2307.13854); Anthropic harness feature
list JSON structure.

### Pattern 3: Browser Tool Invocation Is a Capability, Not Completion Evidence

The Anthropic harness explicitly documents Puppeteer MCP blind spots (alert
modals). UGround proves that visual grounding and task completion are distinct
capabilities. The Gemini CLI browser agent separates visual analysis
(`analyzeScreenshot`) from action execution.

**Citation**: Anthropic long-running agent harness (Puppeteer blind spots);
UGround (arXiv:2410.05243); Gemini CLI `analyzeScreenshot.ts` system prompt.

### Pattern 4: Design-Context Integrations Are Authoritative When Present, Exploratory When Absent

Figma MCP provides the design source of truth. When it is available, external
visual exploration is unnecessary and potentially contradictory. When it is
absent, exploration may be required for exploratory work but is not required
for bug fixes or preserving refactors.

**Citation**: Figma MCP blog series (2026); screenshot-to-code pipeline
(design input → code output → visual verification).

### Pattern 5: Exploration Is a Distinct Phase from Implementation and Verification

WebPilot's dual optimization (global planning + local execution) proves that
exploration decisions must be tracked separately from implementation. The
Anthropic harness separates the initializer agent (planning) from the coding
agent (implementation + verification).

**Citation**: WebPilot (arXiv:2408.15978); Anthropic harness two-agent
architecture.

### Pattern 6: Verification Must Name Its Limitations

Every verification approach has blind spots. The contract must encode what the
verification tool cannot see. Puppeteer MCP cannot see alert modals.
Screenshots capture one viewport at one moment. Accessibility trees miss
visual-only elements.

**Citation**: Anthropic harness (Puppeteer MCP blind spots); UGround
(accessibility tree vs. visual rendering gaps).

### Pattern 7: Safety Boundaries Are First-Class Contract Properties

All three major labs require sandboxing, domain allowlisting, human-in-the-loop
for consequential actions, and prompt injection defense. These are not
implementation details; they are contract-level obligations.

**Citation**: Anthropic Computer Use security considerations; OpenAI CUA
safety guidance; Gemini CLI browser policy enforcement.

### Pattern 8: Independent Review Is Structurally Distinct from Self-Assessment

The dominant failure mode across all benchmarks is premature self-declared
completion. The fix is structural: separate the verifier from the implementer,
or at minimum require explicit verification steps with pass/fail outcomes.

**Citation**: OSWorld (12.24% vs. 72.36%); WebArena (14.41% vs. 78.24%);
Anthropic harness (premature completion as primary failure mode).

---

## 9. Abstraction Direction

Based on the evidence, conditional visual-work contracts should encode:

1. **Visual intent classification** (none / preserve / specified / exploratory)
   as a first-class property, distinct from evidence, phase, route, and agent
   identity. *Evidence: all benchmarks separate task goal from approach;
   Figma MCP separates design intent from implementation.*

2. **Design-context evidence** with provenance, authority, scope, and
   freshness. When authoritative design context exists (Figma, design system,
   operator screenshot), it supersedes external exploration. *Evidence: Figma
   MCP as authoritative source; screenshot-to-code design input patterns.*

3. **Conditional exploration** — required only when visual intent is
   exploratory or design context is insufficient. Exploration evidence must
   include research question, references examined, rationale, and alternatives
   considered. *Evidence: WebPilot strategic exploration; Figma MCP
   eliminating exploration need when design context is present.*

4. **Rendered-visual-verification** with (target identity, exercised states,
   expected-vs-observed verdict, tool limitations named, residual risk).
   Browser execution is one capability; the evidence type is the structured
   verification record. *Evidence: OSWorld/WebArena execution-based
   evaluation; Anthropic harness feature list with pass/fail.*

5. **Independent design review** structurally distinct from implementation
   self-assessment and from rendered verification. *Evidence: all benchmarks
   show self-assessment failure; Anthropic harness premature completion as
   primary failure mode.*

6. **Capability-based routing** — route by declared capabilities (browser
   interaction, screenshot capture, visual/multimodal input, design-context
   access, rendered-state interaction), not by implied agent identity or tool
   name. *Evidence: Gemini CLI browser agent as sub-agent with specific
   capabilities; OpenAI CUA three integration paths.*

7. **Safety boundaries as contract properties** — domain policy, action
   approval requirements, data isolation, prompt injection defense. *Evidence:
   cross-lab safety convergence; Gemini CLI browser policy enforcement.*

8. **Verification limitation disclosure** — every verification record must
   name what the verification tool cannot see. *Evidence: Anthropic harness
   Puppeteer MCP blind spots; UGround accessibility vs. visual gaps.*

9. **Semantic phases** that describe work lifecycle (context acquisition,
   exploration, implementation, rendered verification, review) without
   encoding technique or agent profile. *Evidence: Anthropic harness
   initializer vs. coding agent; WebPilot global vs. local optimization.*

10. **Replayable evidence identity** — each evidence artifact must carry
    enough provenance to answer: what governed the work, which context was
    authoritative, what was verified, which states were exercised, who
    reviewed. *Evidence: OSWorld reproducible evaluation; Anthropic harness
    git commits and progress files.*

11. **Provider-neutral abstraction** — the contract must work across
    Codex/OpenCode/Claude/Gemini without depending on any one provider's
    computer-use tool. *Evidence: all three cloned harnesses handle visual
    work differently; OpenAI CUA offers three integration paths.*

12. **Conditional obligations** — a UI bug fix needs implementation + rendered
    verification, not exploration. A Figma implementation needs context
    acquisition + implementation + rendered verification, not external
    research. A preserving refactor needs implementation + regression
    verification, not exploration. *Evidence: the issue's own canonical
    policy; Anthropic harness feature-specific verification.*

---

## 10. What Could NOT Be Verified

- **Google Project Mariner detailed architecture**: the original blog post URL
  (blog.google/technology/google-deepmind/project-mariner/) returned 404. The
  Gemini CLI browser agent source provides indirect evidence of Google's
  approach, but the Mariner product architecture could not be directly
  verified.

- **ScreenSpot benchmark** (the specific GUI grounding benchmark): the arXiv
  ID 2404.06929 resolved to an unrelated physics paper. The UGround paper
  (arXiv:2410.05243) covers the same GUI grounding territory and was used
  instead. The specific ScreenSpot paper could not be located at the expected
  arXiv ID.

- **WindowsAgentArena**: the arXiv ID 2412.05293 resolved to an unrelated
  computer vision paper. The specific WindowsAgentArena paper could not be
  located at the expected arXiv ID. The OSWorld paper covers the same
  cross-OS evaluation territory.

- **OpenCode SECURITY.md**: the file was not found at
  `packages/opencode/SECURITY.md`. The security posture for OpenCode's visual
  tools could not be verified from the clone.

- **Emil Kowalski / specific design-engineering creator posts**: specific blog
  posts or talks on how design engineers handle visual work in coding agents
  could not be fetched during this research session. The patterns in Section 7
  are inferred from benchmark evidence and lab documentation rather than
  specific creator commentary.

- **v0/Bolt/Lovable/Anima internal architectures**: these products' internal
  visual-work handling could not be verified from public sources during this
  session. The screenshot-to-code project provides an open-source proxy for
  this category.

---

## 11. Open Questions for Architecture Review

1. **Granularity of visual intent**: should `preserve` and `specified` be
   separate intents, or should `specified` with a "preserve existing" flag
   suffice? The benchmarks do not distinguish these.

2. **Exploration evidence structure**: when exploration is required, should
   the evidence be a single structured record or a collection of
   reference-and-rationale pairs? WebPilot suggests tree-structured
   exploration; the issue suggests a flat record.

3. **Verification tool declaration**: should the contract name the specific
   verification tool used (e.g., "Puppeteer MCP") or only the capability
   class (e.g., "browser-based rendered verification")? Naming the tool
   enables limitation disclosure but risks vendor coupling.

4. **Independent review threshold**: at what point does policy require
   independent design review? All material visual changes? Only exploratory
   work? Only changes without authoritative design context? The benchmarks
   suggest all material changes; the issue suggests conditional application.

5. **Cross-session evidence continuity**: when work spans multiple agent
   sessions (as in the Anthropic harness), how does the contract represent
   evidence supersession? The Anthropic harness uses git commits and progress
   files; Kiln needs a canonical evidence-supersession model.

6. **Design-context freshness**: when a Figma file is the authoritative
   source, how does the contract represent that the design may have changed
   since the implementation began? Figma MCP provides real-time access, but
   the evidence record must capture which version was used.

7. **Capability degradation**: when a harness lacks browser automation (like
   Codex), should the contract require degraded verification (e.g., static
   analysis + operator visual check) or block the work entirely? The
   Gemini CLI approach (browser agent as optional sub-agent) suggests
   graceful degradation; the issue's doctrine suggests failing closed.
