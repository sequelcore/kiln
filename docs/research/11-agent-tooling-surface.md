# Agent Tooling Surface Research

## Purpose

This note summarizes external tooling patterns and user pain points relevant to
Kiln's shared developer-tool program. It informed
`docs/architecture/developer-tools.md`; it does not override the architecture
contract in `docs/architecture/tool-execution.md`.

## Sources Reviewed

- Anthropic Claude Code tools reference:
  https://code.claude.com/docs/en/tools-reference
- Google Gemini CLI tools overview:
  https://google-gemini.github.io/gemini-cli/docs/tools/
- Google Gemini CLI file-system tools:
  https://google-gemini.github.io/gemini-cli/docs/tools/file-system.html
- Google Gemini CLI shell tool:
  https://google-gemini.github.io/gemini-cli/docs/tools/shell.html
- Google Gemini CLI web fetch:
  https://google-gemini.github.io/gemini-cli/docs/tools/web-fetch.html
- OpenAI Apply Patch guide:
  https://platform.openai.com/docs/guides/tools-apply-patch
- MCP Tools specification:
  https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- MCP Progress specification:
  https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/progress
- "Bridging Protocol and Production: Design Patterns for Deploying AI Agents
  with Model Context Protocol":
  https://arxiv.org/abs/2603.13417
- "Model Context Protocol Tool Descriptions Are Smelly!":
  https://arxiv.org/abs/2602.14878
- User reports on tool-surface drift and shell overuse:
  https://www.reddit.com/r/ClaudeCode/comments/1suk0ek/claude_code_removed_glob_and_grep_on_native/
  and
  https://www.reddit.com/r/ClaudeAI/comments/1skd722/i_had_to_take_away_claudes_bash_tool_it_kept/
- User reports on image workflow friction:
  https://www.reddit.com/r/ClaudeCode/comments/1rbhfhh/passing_multiple_images_to_claude_code_is_quite_a/
  and
  https://www.reddit.com/r/ClaudeCode/comments/1sg1m5m/can_claude_code_take_images_from_mcp_tool_calls/
- Anthropic Claude API web search:
  https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
- Anthropic Claude API web fetch:
  https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool
- OpenAI Responses API web search:
  https://developers.openai.com/api/docs/guides/tools-web-search
- OpenCode tools reference:
  https://opencode.ai/docs/tools/
- MCP security best practices:
  https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices
- User reports on web-search friction in coding agents:
  https://github.com/openai/codex/issues/2563
  and
  https://github.com/openai/codex/issues/6025

## Findings

### Dedicated Tools Beat Shell Overloading

Claude Code and Gemini CLI both expose dedicated file, search, web, and shell
tools. Claude Code lists separate `Read`, `Write`, `Edit`, `Glob`, `Grep`,
`WebFetch`, and `WebSearch` tools. Gemini CLI similarly separates file-system
tools, shell execution, web fetch, web search, and memory.

User complaints reinforce the same pattern: when agents use shell commands for
file reads, grep, or edits, external harnesses lose visibility and policy hooks.
Kiln should keep adding first-class tools where a repeated operation needs
metadata, policy, or audit.

### Patch Needs A Structured Harness

OpenAI's apply-patch guidance treats patching as structured file operations
with explicit operation results. The guide calls out path validation, backups or
scratch copies, error handling, and atomicity choices.

For Kiln, patch must be a core tool with its own parser, path validation,
dry-run mode, and structured file-change metadata. Shelling out to a patch
binary would repeat the same visibility and portability problems that the
existing tool foundation is designed to avoid.

### Images Are A Real Developer-Tool Requirement

MCP tool results can include image content, embedded resources, and resource
links. Gemini CLI's file tools explicitly handle images and PDFs as
model-consumable data. User reports show recurring friction around passing
multiple images, file-size failures, and unreliable image handoff through MCP.

Kiln should add `view_image` before OCR. The first slice should solve
path-safe, model-consumable image access and stable metadata. OCR should build
on that contract instead of becoming a separate ad hoc image path.

### Orientation Tools Reduce Token And Policy Waste

Gemini CLI exposes `list_directory`, `glob`, `search_file_content`, and
multi-file read. Claude Code exposes `Glob`, `Grep`, and `Read`. Users notice
when these disappear or drift from model instructions.

Kiln already has `glob` and `grep`; `tree` and `stat` are the missing cheap
orientation tools. They should be bounded by depth, output mode, ignored
directories, and sandbox validation.

### Output Control Is A Production Concern

MCP provides structured content and output schemas, but production research
shows that reliable MCP deployments still need infrastructure-level mechanisms
around timeouts, errors, observability, and server contracts. Tool descriptions
also affect tool choice quality.

Kiln should treat output verbosity as a contract, not formatting sugar. The
same tool should be able to provide raw lists, structured metadata-rich results,
and summaries without changing execution authority or audit metadata.

### Web Tools Need Source Policy

Claude Code and Gemini CLI both expose web fetch/search tools. The key Kiln
requirement is not just network access; it is controlled source access. Domain
allowlists, recency windows, retrieval metadata, truncation metadata, and
sanitization must be part of the first slice.

Current tool surfaces separate discovery from retrieval. Gemini CLI documents
`google_web_search` as a search-summary tool with citations and sources.
OpenCode exposes `websearch` for discovery and `webfetch` for retrieving a
specific URL. Anthropic's web tools follow the same split and add limits,
domain filters, source metadata, retrieval timestamps, truncation/content
limits, and explicit error codes.

User reports around Codex web search show two recurring needs: automatic use
when recency intent is present, and dependable documentation lookup when network
access is enabled. Kiln should not solve the automatic model-choice layer inside
the tool executor, but the tool contract must make dependable lookup possible:
clear input schemas, provider-independent metadata, source URLs, result ranking,
and audit-visible policy decisions.

MCP security guidance makes external network tools higher risk than local
read-only filesystem inspection. Web tools must defend against SSRF and
over-broad scopes with allowlisted HTTP(S) URLs, domain normalization, private
address blocking, redirect validation, bounded response sizes, and auditable
network policy. A search provider should be injected through core options; core
must not silently scrape a public search page or tunnel through shell commands.

## Design Principles For Kiln

- Keep the builtin registry in core.
- Prefer dedicated tools when the operation needs policy, metadata, or audit.
- Keep shell as an escape hatch, not the default for inspect/edit/search.
- Treat image, web, and patch tools as shared runtime capabilities, not UI
  features.
- Make output modes explicit and testable.
- Include progress, timeout, error, and truncation metadata in every
  long-running or high-volume tool.
- Validate paths and network domains at boundaries before work starts.
