# Remote Operator Connection (2026)

Owner: Roadmaps 08 and 08.5
Evidence cutoff: 2026-08-14
Promotion targets: operator-access architecture, connectivity architecture,
operator guide, and a later managed-relay ADR only if live evidence justifies it
Exit condition: the local-first pairing/session and transport contracts are
live validated, stable conclusions are promoted, and every remaining hosted
service question is either rejected or moved to a separately admitted ADR and
roadmap.

## Question

How should `Kiln Connect` let an operator securely control a Kiln GUI on an
internet-connected development machine from a phone, while execution and
authority remain local, the product stays provider-neutral, and Kiln does not
build a cloud control plane now?

## Method And Limits

This is decision-oriented product and architecture research, not a systematic
market survey. The scout compared official documentation and public source
from major coding-agent and remote-development products, relevant security
standards, representative community projects, transport providers, and the
current Kiln repository.

Official or source-verifiable material carries architectural weight.
Community projects establish demand and expose implementation alternatives,
but do not establish security or operating guarantees. Product behavior and
service terms can change after the cutoff and must be reverified before a live
adapter or hosted-service decision.

Pinned local source:

- T3 Code clone `9c7622dac3d1a385351e6c74354a9e6b9c2037d5`
  (observed 2026-08-14), including its T3 Connect design and relay packages;
- the current Kiln worktree at the evidence cutoff.

## Findings

### Major labs and developer platforms converge on local execution

Anthropic Claude Code Remote Control connects a browser or mobile client to a
Claude Code session while execution, filesystem access, tools, and project
state remain on the development machine. Its local process makes outbound
HTTPS connections and does not require an inbound port. Claude distinguishes
that local remote-control mode from its cloud execution product.

OpenAI Codex similarly supports controlling Codex from another device while
the working environment, credentials, permissions, and local setup stay on
the machine running Codex. The public Codex app-server protocol also models
remote-control pairing, pairing status, connected clients, and revocation as
separate lifecycle operations.

VS Code Remote Tunnels separates the local VS Code Server, an authenticated
outbound tunnel, a remote client, and an optional background service. That
separation is strong evidence for keeping reachability and process lifecycle
outside the editor/application authorization contract.

The common product pattern is therefore local execution with a replaceable
remote projection. A phone is a control surface, not a second execution host.

### T3 Connect contributes the setup shape, not Kiln's authority model

T3 Code presents remote access as a single ergonomic command and supports
one-time pairing, direct/private endpoints, and a managed Cloudflare-backed
path. Its source separates environment-server access tokens from tunnel
transport. That validates `Kiln Connect` as the product name and `pair` as one
phase beneath it.

Kiln cannot copy T3's hosted identity or relay assumptions verbatim. Kiln is
provider-neutral, its Operator Runtime owns consequential execution decisions,
and the current objective explicitly excludes a Kiln-operated cloud. T3's
fragment-carried state/challenge and one-time exchange are useful mechanism
evidence, but require an independent Kiln threat model and contract.

### Community projects confirm demand but not one winning topology

Representative open-source projects such as Tether, MobileCLI, Happy, hapi,
ccpocket, and CloudCLI offer mobile/PWA control of local coding agents through
different combinations of relays, direct connections, end-to-end encryption,
notifications, and local-first deployment. Their diversity is the finding:
mobile supervision is valuable, while the relay and identity layer remains an
active design space.

Kiln should not infer a universal transport abstraction from this scan. A
connector contract must preserve transport-specific limitations and be proven
with at least two materially different adapters before it is treated as
portable.

### Transport does not authenticate the Kiln operator

Cloudflare Tunnel creates outbound-only connectivity from `cloudflared` to
Cloudflare and can map a hostname to a loopback service without opening an
inbound firewall port. Cloudflare Access can add an external access-policy
layer. Tailscale Serve keeps a service private to a tailnet; Funnel makes it
public. A conventional self-hosted reverse proxy is another operator-owned
option.

These transports differ in public reachability, client installation, account
and policy ownership, source identity, WebSocket behavior, endpoint stability,
background lifecycle, and vendor exit. None should mint a Kiln Runtime session
or become the sole authorization check. Kiln must authenticate and authorize
every protected HTTP and WebSocket operation at its own inner boundary.

### Standards support a staged identity design

RFC 8252 requires public native OAuth clients to use an external user-agent and
PKCE. RFC 8628 defines device authorization for a device that asks the user to
complete authorization in a browser on another device. RFC 9700 is the OAuth
2.0 security best-current-practice baseline, including exact redirects,
least-privilege tokens, PKCE, and sender-constrained access tokens where
appropriate. RFC 9449 specifies DPoP proof-of-possession tokens.

Those standards matter when Kiln integrates with a real authorization server.
They do not require Kiln to create an account system for the local-first slice.
The initial design can use a short-lived, one-time local pairing grant and a
device-bound Kiln session. Federated OAuth/OIDC, device authorization, passkeys,
or DPoP remain later decisions tied to an actual deployment and threat model.

### Current Kiln code already contains useful boundaries and one urgent gap

The persistent Operator Runtime listener explicitly binds to `127.0.0.1` and
uses bounded authenticated session credentials. Its lifecycle and exact-instance
checks are useful precedent, but those internal credentials are not remote
browser tokens.

The GUI is already web-first and has narrow-viewport behavior, making a
responsive browser the smallest mobile client. Roadmap 08.5 Slice 0 closed the
local exposure gap identified at this evidence cutoff: GUI and TUI now bind
explicitly to `127.0.0.1`, and the GUI admits only startup-bound exact browser
origins. That local boundary is still not a remote boundary. In particular,
the GUI WebSocket still accepts a client-supplied anonymous `userId`; Roadmap
08 must replace that identity model before any tunnel is admitted.

## Decision Supported By The Evidence

`Kiln Connect` is the umbrella capability and CLI namespace. The work is split
by authority:

- Roadmap 08 owns pairing, device identity, operator sessions, scopes, expiry,
  renewal, revocation, and audit evidence.
- Roadmap 08.5 owns loopback exposure, endpoint evidence, transport adapters,
  connector health, background lifecycle, and reconnection.
- Operator Runtime remains the sole owner of execution, provider routing,
  credentials, tools, approvals, economic commitment, and dispatch.
- GUI, CLI, TUI, and a possible future native mobile application are
  replaceable projections of shared contracts.

The minimum release uses bring-your-own connectivity and a responsive web GUI.
The operator supplies and owns the private or HTTPS/WSS transport; Kiln binds
its origin to loopback, authenticates the application session independently,
and exposes only narrow supervisory scopes. No Kiln-hosted account, relay,
tunnel allocation, DNS, billing, or multi-tenant control plane is admitted.

The first transport is deliberately undecided until the endpoint contract and
comparison fixture exist. Selection must use phone usability, private-client
requirements, HTTPS/WSS behavior, Windows lifecycle, identity ownership,
reconnect semantics, diagnostics, revocation, portability, and cleanup—not
setup-command aesthetics alone.

## Rejected Or Deferred Approaches

- Expose the existing GUI listener directly to the LAN or internet: rejected;
  the current boundary is unauthenticated and overbroad.
- Treat Cloudflare Access, a tailnet identity, or a tunnel token as the Kiln
  operator session: rejected; transport and application authority differ.
- Expose Codex, Claude Code, OpenCode, a shell, terminal, or provider credential
  directly: rejected; all consequential work remains behind Operator Runtime.
- Build a Kiln relay/account/control plane for the urgent slice: rejected; it
  adds tenancy, abuse, retention, operations, billing, and incident obligations
  before local-first demand is proven.
- Build a native mobile application first: deferred; the responsive web GUI
  can validate the product and reconnection contracts with less duplicated
  surface ownership.
- Generalize several unimplemented tunnel providers behind one abstraction:
  rejected; portability requires observed evidence from a second adapter.

## Contradictions And Open Evidence

- Hosted relays give the smoothest cross-network onboarding in Anthropic,
  OpenAI, T3, and VS Code, but they rely on identities and operations those
  vendors already own. That is product evidence, not authority for Kiln to
  build equivalent infrastructure now.
- Private mesh networking reduces public exposure but may require a client and
  account on the phone. Public HTTPS tunnels improve browser reachability but
  shift more policy and availability to a third party. The first adapter needs
  an explicit operator choice after a live comparison.
- Official Google/Gemini developer-agent material did not yield a comparable,
  verifiable local-session remote-control contract in this research window; no
  negative capability claim is made.
- Browser suspension, mobile network transitions, long-lived WebSocket limits,
  notification delivery, and Windows service recovery require live evidence.
- DPoP, WebAuthn/passkeys, and federated device authorization may reduce later
  risk, but adding them before a concrete issuer and deployment exists would
  create unused machinery.

## Next Evidence

1. Close the GUI loopback/CORS exposure guardrail and inventory protected
   routes and scopes.
2. Freeze pairing/session threat-model fixtures, including replay, wrong
   audience/runtime/device, expiry, revocation, and cross-origin negatives.
3. Define the bring-your-own endpoint evidence contract without vendor secrets.
4. Compare candidate first transports with one synthetic fixture and one
   explicitly authorized phone-to-Windows live trial.
5. Validate disconnect/reconnect without duplicated dispatch or cancelled work.
6. Reassess a managed relay only from measured setup friction, reliability,
   usage, privacy, cost, and support evidence.

## Sources

- Anthropic, [Claude Code Remote Control](https://code.claude.com/docs/en/remote-control)
- OpenAI, [Work with Codex from anywhere](https://openai.com/index/work-with-codex-from-anywhere/)
- OpenAI, [Codex app-server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- Microsoft, [VS Code Remote Tunnels](https://code.visualstudio.com/docs/remote/tunnels)
- T3 Code, [Remote Access](https://github.com/pingdotgg/t3code/blob/main/docs/user/remote-access.md)
- Cloudflare, [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/)
- Cloudflare, [Protect internal services with Access](https://developers.cloudflare.com/use-cases/apis/internal-services/)
- Tailscale, [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel)
- IETF, [RFC 8252: OAuth 2.0 for Native Apps](https://www.rfc-editor.org/rfc/rfc8252.html)
- IETF, [RFC 8628: OAuth 2.0 Device Authorization Grant](https://www.rfc-editor.org/rfc/rfc8628.html)
- IETF, [RFC 9449: OAuth 2.0 Demonstrating Proof of Possession](https://www.rfc-editor.org/rfc/rfc9449.html)
- IETF, [RFC 9700: OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700.html)
- Community examples: [Tether](https://github.com/larsderidder/tether),
  [MobileCLI](https://github.com/MobileCLI/mobilecli),
  [Happy](https://github.com/slopus/happy),
  [hapi](https://github.com/tiann/hapi),
  [ccpocket](https://github.com/K9i-0/ccpocket), and
  [CloudCLI](https://github.com/siteboon/claudecodeui)
