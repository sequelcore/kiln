# Tools MCP Optional Web Provider Plan

## Objective

Allow `kiln tools --mcp` to start when optional web providers reference API-key
environment variables that the MCP stdio client did not inherit. Missing
optional credentials should disable only the affected provider and show a
diagnostic issue; invalid config should still fail fast.

## Non-Goals

- Do not change global config format.
- Do not embed secrets in generated native config.
- Do not weaken network policy or memory authority behavior.
- Do not make provider calls before a tool is invoked.

## Slices

1. Configuration coverage
   - Add tests proving missing web provider env vars do not throw during surface
     construction.
   - Add diagnostics coverage for missing provider env vars.

2. Provider resolution
   - Keep fail-fast validation for invalid URL/type/header/config shape.
   - Treat missing API-key env as provider unavailable and omit that provider
     from the runtime tool options.

3. Verification
   - Run focused CLI config tests and typecheck.
   - Build CLI and verify MCP stdio handshake without `TAVILY_API_KEY` inherited.

## Residual Risk

If both search and extract providers are unavailable, `web_search` and
`web_extract` should return provider-not-configured errors at call time while
the MCP server remains available for non-web tools and diagnostics.
