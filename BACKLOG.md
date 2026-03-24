# Kiln Backlog

## Gateway Runtime

- [ ] **Env var resolution in `auth.jwksUri`** — The `jwksUri` field in `gateway.yaml` auth config does not resolve `$ENV_VAR` references like other config fields (e.g., header `$` tokens, `secretEnv`). Currently requires a hardcoded URL per environment. Should support `$ADMIT_JWKS_URI` syntax for consistency. Discovered 2026-03-14 during Admit JWT auth setup.

## Message API

- [x] **User context in message requests** — Add optional `context: Record<string, string>` to the message API so product backends can pass user metadata (role, name, locale) without coupling Kiln to any product's auth model. Kiln injects this as a `[User Context]` block in the agent's system prompt. Agent personas can reference `{{user.role}}`, `{{user.name}}`, etc. in backstory/goal templates. **BLOCKING for Admit Phase 2** — must be implemented before org-scoped tools. Discovered 2026-03-14. Implemented v0.21.0.

## Phase 2 Execution Order (Admit)

1. ~~**User context in message API** (this repo)~~ — DONE (v0.21.0)
2. **Org-scoped endpoint** (admit backend) — refactor `/cinemas/{cinemaId}/ai/chat` → `/ai/chat`, role determines data scope
3. **MCP tools** (this repo, apps/admit) — read-only queries: sales, occupancy, showtimes, inventory
4. **Knowledge RAG** (this repo) — ingest Admit user docs and FAQs
