# External Engagement Research

Date: 2026-06-24

This note records the public research basis for Kiln's governed external
engagement feature. Research explains rationale; active contracts live in
`docs/architecture/` and `packages/core`.

## X Platform Findings

Official X documentation describes X API v2 as programmatic access to public X
conversation through REST endpoints, including read and write surfaces. The
Search Posts documentation supports keyword, hashtag, mention, and URL queries.
Recent search retrieves posts from the last seven days, while broader access
depends on plan and endpoint availability.

X's current pricing documentation describes pay-per-use credits rather than a
simple unlimited subscription model. It also describes per-endpoint pricing,
developer-console usage tracking, and spending controls. Kiln therefore treats
every live X search or read as a budgeted external resource and computes a
request preview before resolving credentials.

X's developer policy and guidelines make developers responsible for policy
compliance, privacy, platform manipulation avoidance, and automation rules for
write actions. Kiln separates read-only evidence collection from future public
writes because posting, replying, liking, reposting, following, and DMs mutate
external state and require explicit authority.

X also publishes AI-agent resources: llms.txt material, an OpenAPI spec, Docs
MCP, and the official `xdevplatform/xmcp` repository. These are useful signals
that X expects agentic API clients, but they are not sufficient authority for
Kiln to expose unbounded or write-capable tools by default.

Primary sources:

- X Developer Guidelines: https://docs.x.com/developer-guidelines
- X Developer Policy: https://docs.x.com/developer-terms/policy
- X Search Posts: https://docs.x.com/x-api/posts/search/introduction
- X recent search endpoint: https://docs.x.com/x-api/posts/search-recent-posts
- X pricing: https://docs.x.com/x-api/getting-started/pricing
- X usage and billing: https://docs.x.com/x-api/fundamentals/post-cap
- X Agent Resources: https://docs.x.com/tools/ai
- X MCP servers: https://docs.x.com/tools/mcp
- X OpenAPI: https://api.x.com/2/openapi.json
- Official XMCP repository: https://github.com/xdevplatform/xmcp

## Community MCP Demand

Community repositories show demand for X/Twitter search and automation through
MCP. Several projects expose search and posting together, and some advertise
browser or scraper-style automation. Kiln treats these as demand evidence, not
architecture authority, because they often collapse read, draft, approval, and
write execution into one tool surface.

Examples reviewed as demand signals:

- https://github.com/EnesCinr/twitter-mcp
- https://github.com/Infatoshi/x-mcp
- https://github.com/DataWhisker/x-mcp-server
- https://github.com/rafaljanicki/x-twitter-mcp-server
- https://github.com/nirholas/XActions

## Human-AI Interaction Basis

Mixed-initiative systems research argues for coupling automated services with
direct manipulation, including careful decisions about when the system acts and
when the user remains in control. Microsoft Research's human-AI interaction
guidelines similarly emphasize making system capability clear, supporting
efficient invocation, showing context, handling uncertainty, and enabling
correction.

Kiln applies that posture by translating a natural request such as "explore X
posts about #mcp" into a bounded plan with query, scope, cache, sampling, and
budget fields. The model does not receive unbounded browser authority. It works
over explicit artifacts after the operator can inspect the plan.

Primary sources:

- Eric Horvitz, "Principles of Mixed-Initiative User Interfaces":
  https://erichorvitz.com/chi99horvitz.pdf
- Microsoft Research, "Guidelines for Human-AI Interaction":
  https://www.microsoft.com/en-us/research/project/guidelines-for-human-ai-interaction/
- CHI 2019 paper:
  https://dl.acm.org/doi/10.1145/3290605.3300233

## Social Listening Limits

Social media evidence is directional. It can reveal observed pain, language,
workarounds, and emerging demand, but it is not representative by default.
Public posts overrepresent people who post publicly, highly engaged
communities, loud or repeated voices, platform-specific demographics, and
topics that are easy to express in public. Bots, coordinated activity, deleted
content, private conversations, and API access limits can further distort the
sample.

Kiln records sampling limitations in search reports and keeps review/decision
as separate steps. A candidate promoted from X evidence should still be checked
against other evidence before high-impact roadmap or architecture decisions.

Sources:

- "Social Data: Biases, Methodological Pitfalls, and Ethical Boundaries":
  https://pmc.ncbi.nlm.nih.gov/articles/PMC7931947/
- Hargittai, "Potential Biases in Big Data: Omitted Voices on Social Media":
  https://www.mkoganresearch.com/assets/hargittai.pdf
- "The Generation, Identification, and Mitigation of AI-Fabricated UGC":
  https://arxiv.org/html/2403.14706v1
