import { describe, expect, it, vi } from "vitest";
import {
  type ManagedAgentRuntimeInvocationInput,
  ManagedRuntimeCredentialRouteLeaseManager,
} from "../../src/agents/managed-invocation/index.js";
import { MANAGED_AGENT_INVOKE_TOOL } from "../../src/agents/managed-invocation/runtime-tool/index.js";
import {
  createAttachedRuntimeBuiltinToolSurface,
  makeAdapter,
  makeManagedRoute,
  makeObservedRuntimeInvocationService,
  makeRouteCapability,
  makeSession,
  makeSurface,
  makeSurfaceOptions,
  TEST_REQUESTED_DESTRUCTIVE_READ_ONLY_PARENT_AUTHORITY,
} from "./managed-invocation-tool-test-fixture.js";

describe("managed invocation runtime tool — external runtime and materialization", () => {
  // Roadmap 01 (External Runtime Governance), Slice 0 - Failing Trace Fixture.
  // This encodes the first of that slice's regression proofs: work-governance-tool.ts's
  // requiredToolNamesForPhaseEvidence() always adds "bash" whenever a phase's expected
  // evidence includes "tests" or "typecheck" (see work-governance-tool.test.ts:2865,
  // which locks that in as today's behavior), with no awareness of the target route's
  // actual admitted capabilities. An MCP-only external-runtime route can never satisfy
  // "bash" and is rejected outright, even when its own admitted tools (start_stop_test,
  // observe_runtime, read_console) could realize equivalent verification evidence. This
  // is expected to fail until Roadmap 01 Slice 1 (Evidence Realization Contract) defines
  // a capability-aware mapping; it must start passing (and this .fails must flip to a
  // plain `it`) once that lands.
  describe("external-runtime MCP-only route capability (Roadmap 01 Slice 0)", () => {
    const externalRuntimeToolNames = [
      "mcp:external-runtime:tool:inspect_tree",
      "mcp:external-runtime:tool:apply_scene_edit",
      "mcp:external-runtime:tool:edit_script",
      "mcp:external-runtime:tool:start_stop_test",
      "mcp:external-runtime:tool:observe_runtime",
      "mcp:external-runtime:tool:read_console",
      "mcp:external-runtime:tool:navigate_actor",
    ] as const;

    function makeExternalRuntimeSurface(
      adapter = makeAdapter({
        adapterDescriptorId: "adapter:mcp-external-runtime:harness",
        providerId: "mcp-external-runtime",
        supportedAccess: ["read-only"],
      }),
    ) {
      return createAttachedRuntimeBuiltinToolSurface({
        managedInvocation: {
          invocationService: makeObservedRuntimeInvocationService({
            credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
              allowedRouteIds: ["credential-route:external-runtime:primary"],
            }),
          }),
          routes: [
            {
              routeId: "external-runtime-mcp-only",
              routeSource: "explicit-managed-route",
              providerId: "mcp-external-runtime",
              model: "external-runtime-fixture",
              capability: makeRouteCapability({
                routeId: "external-runtime-mcp-only",
                providerId: "mcp-external-runtime",
                model: "external-runtime-fixture",
                profiles: ["read-only"],
                toolNames: externalRuntimeToolNames,
              }),
              createAdapter: async () => adapter,
              profiles: [
                {
                  authorityProfileId: "authority:external-runtime-mcp-only:read-only",
                  access: "read-only",
                  allowedToolNames: [...externalRuntimeToolNames],
                  // Roadmap 01 Slice 1 - this route's own capability-aware
                  // realization: its qualified MCP tools satisfy tests/typecheck
                  // evidence without needing bash at all.
                  evidenceRealizations: {
                    tests: ["mcp:external-runtime:tool:start_stop_test", "mcp:external-runtime:tool:observe_runtime"],
                    typecheck: ["mcp:external-runtime:tool:observe_runtime", "mcp:external-runtime:tool:read_console"],
                  },
                  networkAllowed: false,
                  workingDirectory: {
                    path: "C:/workspace/kiln",
                    mode: "read-only",
                  },
                  timeoutMs: 120000,
                  timeoutSource: "explicit-route",
                  credentialRoute: {
                    mode: "runtime-selected",
                    routeId: "credential-route:external-runtime:primary",
                  },
                  memoryScope: {
                    scope: { kind: "project", id: "kiln" },
                    access: "read-only",
                  },
                },
              ],
            },
          ],
        },
      });
    }

    it("admits an MCP-only route for tests/typecheck evidence instead of hard-requiring bash", async () => {
      const surface = makeExternalRuntimeSurface();
      const session = makeSession();

      const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
        {
          routeId: "external-runtime-mcp-only",
          access: "read-only",
          providerRoute: { providerId: "mcp-external-runtime", model: "external-runtime-fixture" },
          task: "Run the Studio playtest and verify the console is clean before promotion.",
          summary: "Verify the Studio prototype.",
          contextMode: "isolated",
          // A legacy/pre-Slice-1 caller value - work-governance-tool.ts's old
          // context-free derivation would have sent exactly this. Because this
          // route declares its own evidenceRealizations, the runtime resolves
          // required tools from the route's own capability instead - "bash" is
          // superseded, not blindly required, closing the hard bash bug.
          requiredToolNames: ["bash"],
          expectedEvidence: ["tests", "typecheck"],
          requestedAuthority: "read_only",
        },
        {
          session,
          toolCall: { id: "tool-call-external-runtime-verification", name: "managed_agent.invoke", input: {} },
        },
      )) as { readonly isError: boolean };

      expect(result?.isError).toBe(false);
    });

    // Fifth Roadmap 01 Slice 0 regression proof: attachment drift. Production
    // external-runtime MCP integrations already solve multi-instance routing
    // with an explicit per-call instance identifier - e.g. the official Roblox
    // Studio MCP server's list_roblox_studios/set_active_studio tools, and
    // community servers that accept an instance_id alongside every tool call
    // (reviewed 2026-07-24 via web research, not present in cloned/ references).
    // Roadmap 01 Slice 3.1 closes this: managed_agent.invoke/.start now expose
    // externalRuntimeAttachment, and the core admission gate
    // (evaluateManagedAgentAdmission) enforces it. This structural check is
    // kept as a cheap guard; the behavioral suite below is the real proof.
    it("lets managed_agent.invoke express which external-runtime instance a dispatch must target", () => {
      const properties =
        (MANAGED_AGENT_INVOKE_TOOL.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
      const attachmentFieldNames = Object.keys(properties).filter((name) => /attachment|instance|target/i.test(name));

      expect(attachmentFieldNames.length).toBeGreaterThan(0);
    });
  });

  // Roadmap 01 Slice 3.1 - External Runtime Attachment Identity (issue #6,
  // tracker #5). Behavioral proof that managed_agent.invoke/.start propagate
  // an explicit externalRuntimeAttachment through parseInput, the
  // ManagedAgentInvocationRequest, and the core admission gate
  // (evaluateManagedAgentAdmission), and that a route's declared attachment
  // is enforced - matched, mismatched, missing, or unsupported-route.
  describe("external runtime attachment identity (Roadmap 01 Slice 3.1)", () => {
    const ATTACHED_ROUTE_ATTACHMENT = {
      kind: "external-runtime" as const,
      runtimeId: "mcp-external-runtime",
      attachmentId: "instance-a",
    };

    function makeAttachedRuntimeSurface(
      adapter = makeAdapter({
        adapterDescriptorId: "adapter:mcp-external-runtime:harness",
        providerId: "mcp-external-runtime",
        supportedAccess: ["read-only"],
      }),
      routeAttachment:
        | { readonly kind: "external-runtime"; readonly runtimeId: string; readonly attachmentId: string }
        | undefined,
    ) {
      return createAttachedRuntimeBuiltinToolSurface({
        managedInvocation: {
          invocationService: makeObservedRuntimeInvocationService({
            credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
              allowedRouteIds: ["credential-route:external-runtime:primary"],
            }),
          }),
          routes: [
            {
              routeId: "external-runtime-attached",
              routeSource: "explicit-managed-route",
              providerId: "mcp-external-runtime",
              model: "external-runtime-fixture",
              capability: makeRouteCapability({
                routeId: "external-runtime-attached",
                providerId: "mcp-external-runtime",
                model: "external-runtime-fixture",
                profiles: ["read-only"],
                externalRuntimeAttachment: routeAttachment,
              }),
              createAdapter: async () => adapter,
              ...(routeAttachment ? { externalRuntimeAttachment: routeAttachment } : {}),
              profiles: [
                {
                  authorityProfileId: "authority:external-runtime-attached:read-only",
                  access: "read-only",
                  allowedToolNames: ["read", "grep", "glob"],
                  networkAllowed: false,
                  workingDirectory: {
                    path: "C:/workspace/kiln",
                    mode: "read-only",
                  },
                  timeoutMs: 120000,
                  timeoutSource: "explicit-route",
                  credentialRoute: {
                    mode: "runtime-selected",
                    routeId: "credential-route:external-runtime:primary",
                  },
                  memoryScope: {
                    scope: { kind: "project", id: "kiln" },
                    access: "read-only",
                  },
                },
              ],
            },
          ],
        },
      });
    }

    const baseInvokeInput = {
      routeId: "external-runtime-attached",
      access: "read-only",
      providerRoute: { providerId: "mcp-external-runtime", model: "external-runtime-fixture" },
      task: "Run a bounded external-runtime dispatch.",
    };

    for (const toolName of ["managed_agent.invoke", "managed_agent.start"] as const) {
      it(`${toolName} admits and persists the attachment when it matches the route's declared attachment`, async () => {
        const adapter = makeAdapter({
          adapterDescriptorId: "adapter:mcp-external-runtime:harness",
          providerId: "mcp-external-runtime",
          supportedAccess: ["read-only"],
        });
        const surface = makeAttachedRuntimeSurface(adapter, ATTACHED_ROUTE_ATTACHMENT);
        const session = makeSession();

        const result = (await surface.callBuiltinTools.get(toolName)?.(
          {
            ...baseInvokeInput,
            externalRuntimeAttachment: { runtimeId: "mcp-external-runtime", attachmentId: "instance-a" },
          },
          {
            session,
            toolCall: { id: `tool-call-${toolName}-match`, name: toolName, input: {} },
          },
        )) as {
          readonly isError: boolean;
          readonly metadata: {
            readonly capabilitySnapshot?: { readonly externalRuntimeAttachment?: unknown };
          };
        };

        expect(result.isError).toBe(false);
        expect(adapter.invoke).toHaveBeenCalledTimes(1);
        expect(result.metadata.capabilitySnapshot?.externalRuntimeAttachment).toEqual(ATTACHED_ROUTE_ATTACHMENT);
        const startedEvent = session.sessionEvents.find((event) => event.kind === "agent_invocation_started") as
          | { readonly capabilitySnapshot?: { readonly externalRuntimeAttachment?: unknown } }
          | undefined;
        expect(startedEvent?.capabilitySnapshot?.externalRuntimeAttachment).toEqual(ATTACHED_ROUTE_ATTACHMENT);
      });

      it(`${toolName} denies with external_runtime_attachment_mismatch when the requested attachment differs, without invoking the adapter`, async () => {
        const adapter = makeAdapter({
          adapterDescriptorId: "adapter:mcp-external-runtime:harness",
          providerId: "mcp-external-runtime",
          supportedAccess: ["read-only"],
        });
        const surface = makeAttachedRuntimeSurface(adapter, ATTACHED_ROUTE_ATTACHMENT);
        const session = makeSession();

        const result = (await surface.callBuiltinTools.get(toolName)?.(
          {
            ...baseInvokeInput,
            externalRuntimeAttachment: { runtimeId: "mcp-external-runtime", attachmentId: "instance-b" },
          },
          {
            session,
            toolCall: { id: `tool-call-${toolName}-mismatch`, name: toolName, input: {} },
          },
        )) as {
          readonly isError: boolean;
          readonly output: string;
          readonly metadata: {
            readonly errorCode?: string;
            readonly requestedAttachment?: unknown;
            readonly routeAttachment?: unknown;
            readonly admissionReasons?: readonly { readonly code: string }[];
          };
        };

        expect(result.isError).toBe(true);
        expect(result.metadata.admissionReasons).toEqual([{ code: "external-runtime-attachment-mismatch" }]);
        expect(adapter.invoke).not.toHaveBeenCalled();
        expect(session.sessionEvents).toEqual([]);
      });

      it(`${toolName} denies with external_runtime_attachment_missing when the route declares an attachment and the dispatch omits it, without invoking the adapter`, async () => {
        const adapter = makeAdapter({
          adapterDescriptorId: "adapter:mcp-external-runtime:harness",
          providerId: "mcp-external-runtime",
          supportedAccess: ["read-only"],
        });
        const surface = makeAttachedRuntimeSurface(adapter, ATTACHED_ROUTE_ATTACHMENT);
        const session = makeSession();

        const result = (await surface.callBuiltinTools.get(toolName)?.(baseInvokeInput, {
          session,
          toolCall: { id: `tool-call-${toolName}-missing`, name: toolName, input: {} },
        })) as {
          readonly isError: boolean;
          readonly metadata: {
            readonly errorCode?: string;
            readonly admissionReasons?: readonly { readonly code: string }[];
          };
        };

        expect(result.isError).toBe(true);
        expect(result.metadata.errorCode).toBe("external_runtime_attachment_missing");
        expect(adapter.invoke).not.toHaveBeenCalled();
        expect(session.sessionEvents.map((event) => event.kind)).toEqual([
          "agent_invocation_requested",
          "agent_invocation_failed",
        ]);
      });

      it(`${toolName} denies with external_runtime_attachment_unsupported_route when the route declares no attachment but the dispatch requests one`, async () => {
        const adapter = makeAdapter({
          adapterDescriptorId: "adapter:mcp-external-runtime:harness",
          providerId: "mcp-external-runtime",
          supportedAccess: ["read-only"],
        });
        const surface = makeAttachedRuntimeSurface(adapter, undefined);
        const session = makeSession();

        const result = (await surface.callBuiltinTools.get(toolName)?.(
          {
            ...baseInvokeInput,
            externalRuntimeAttachment: { runtimeId: "mcp-external-runtime", attachmentId: "instance-a" },
          },
          {
            session,
            toolCall: { id: `tool-call-${toolName}-unsupported-route`, name: toolName, input: {} },
          },
        )) as {
          readonly isError: boolean;
          readonly metadata: {
            readonly errorCode?: string;
            readonly admissionReasons?: readonly { readonly code: string }[];
          };
        };

        expect(result.isError).toBe(true);
        expect(result.metadata.admissionReasons).toEqual([
          { code: "attachments-not-supported-by-route" },
          { code: "external-runtime-attachment-unsupported-route" },
        ]);
        expect(adapter.invoke).not.toHaveBeenCalled();
      });

      it(`${toolName} admits an unattached route when neither the route nor the dispatch declare an attachment (no regression)`, async () => {
        const adapter = makeAdapter({
          adapterDescriptorId: "adapter:mcp-external-runtime:harness",
          providerId: "mcp-external-runtime",
          supportedAccess: ["read-only"],
        });
        const surface = makeAttachedRuntimeSurface(adapter, undefined);
        const session = makeSession();

        const result = (await surface.callBuiltinTools.get(toolName)?.(baseInvokeInput, {
          session,
          toolCall: { id: `tool-call-${toolName}-no-attachment`, name: toolName, input: {} },
        })) as { readonly isError: boolean };

        expect(result.isError).toBe(false);
        expect(adapter.invoke).toHaveBeenCalledTimes(1);
      });

      it(`${toolName} rejects a vendor-specific/unknown field inside externalRuntimeAttachment instead of silently dropping it (F2)`, async () => {
        const adapter = makeAdapter({
          adapterDescriptorId: "adapter:mcp-external-runtime:harness",
          providerId: "mcp-external-runtime",
          supportedAccess: ["read-only"],
        });
        const surface = makeAttachedRuntimeSurface(adapter, ATTACHED_ROUTE_ATTACHMENT);
        const session = makeSession();

        const result = (await surface.callBuiltinTools.get(toolName)?.(
          {
            ...baseInvokeInput,
            externalRuntimeAttachment: {
              runtimeId: "mcp-external-runtime",
              attachmentId: "instance-a",
              robloxPlaceId: 123,
            },
          },
          {
            session,
            toolCall: { id: `tool-call-${toolName}-unknown-field`, name: toolName, input: {} },
          },
        )) as { readonly isError: boolean; readonly output: string };

        expect(result.isError).toBe(true);
        expect(result.output).toContain("robloxPlaceId");
        expect(adapter.invoke).not.toHaveBeenCalled();
      });

      it(`${toolName} rejects an empty externalRuntimeAttachment object instead of treating it as absent`, async () => {
        const adapter = makeAdapter({
          adapterDescriptorId: "adapter:mcp-external-runtime:harness",
          providerId: "mcp-external-runtime",
          supportedAccess: ["read-only"],
        });
        const surface = makeAttachedRuntimeSurface(adapter, ATTACHED_ROUTE_ATTACHMENT);
        const session = makeSession();

        const result = (await surface.callBuiltinTools.get(toolName)?.(
          {
            ...baseInvokeInput,
            externalRuntimeAttachment: {},
          },
          {
            session,
            toolCall: { id: `tool-call-${toolName}-empty`, name: toolName, input: {} },
          },
        )) as { readonly isError: boolean; readonly output: string };

        expect(result.isError).toBe(true);
        expect(adapter.invoke).not.toHaveBeenCalled();
      });

      it(`${toolName} rejects a whitespace-only attachmentId instead of coercing it`, async () => {
        const adapter = makeAdapter({
          adapterDescriptorId: "adapter:mcp-external-runtime:harness",
          providerId: "mcp-external-runtime",
          supportedAccess: ["read-only"],
        });
        const surface = makeAttachedRuntimeSurface(adapter, ATTACHED_ROUTE_ATTACHMENT);
        const session = makeSession();

        const result = (await surface.callBuiltinTools.get(toolName)?.(
          {
            ...baseInvokeInput,
            externalRuntimeAttachment: { runtimeId: "mcp-external-runtime", attachmentId: "   " },
          },
          {
            session,
            toolCall: { id: `tool-call-${toolName}-blank`, name: toolName, input: {} },
          },
        )) as { readonly isError: boolean; readonly output: string };

        expect(result.isError).toBe(true);
        expect(adapter.invoke).not.toHaveBeenCalled();
      });
    }

    it("preserves the attachment in the terminal lifecycle evidence for a completed invocation", async () => {
      const adapter = makeAdapter({
        adapterDescriptorId: "adapter:mcp-external-runtime:harness",
        providerId: "mcp-external-runtime",
        supportedAccess: ["read-only"],
      });
      const surface = makeAttachedRuntimeSurface(adapter, ATTACHED_ROUTE_ATTACHMENT);
      const session = makeSession();

      await surface.callBuiltinTools.get("managed_agent.invoke")?.(
        {
          ...baseInvokeInput,
          externalRuntimeAttachment: { runtimeId: "mcp-external-runtime", attachmentId: "instance-a" },
        },
        {
          session,
          toolCall: { id: "tool-call-terminal-evidence", name: "managed_agent.invoke", input: {} },
        },
      );

      const completedEvent = session.sessionEvents.find((event) => event.kind === "agent_invocation_completed") as
        | {
            readonly managedInvocationEvidence?: {
              readonly lifecycle?: { readonly externalRuntimeAttachment?: unknown };
            };
          }
        | undefined;
      expect(completedEvent?.managedInvocationEvidence?.lifecycle?.externalRuntimeAttachment).toEqual(
        ATTACHED_ROUTE_ATTACHMENT,
      );
    });

    it("denies a mismatch before the adapter is ever invoked, proving admission runs upstream of dispatch", async () => {
      const adapter = makeAdapter({
        adapterDescriptorId: "adapter:mcp-external-runtime:harness",
        providerId: "mcp-external-runtime",
        supportedAccess: ["read-only"],
      });
      const surface = makeAttachedRuntimeSurface(adapter, ATTACHED_ROUTE_ATTACHMENT);
      const session = makeSession();

      await surface.callBuiltinTools.get("managed_agent.invoke")?.(
        {
          ...baseInvokeInput,
          externalRuntimeAttachment: { runtimeId: "mcp-external-runtime", attachmentId: "wrong-instance" },
        },
        {
          session,
          toolCall: { id: "tool-call-mismatch-preflight", name: "managed_agent.invoke", input: {} },
        },
      );

      expect(adapter.invoke).not.toHaveBeenCalled();
    });

    // runtimeId and attachmentId are opaque identifiers. Tool-input parsing
    // must validate them as non-whitespace-only, but never normalise them: a
    // trimmed request identity would silently match a different physical
    // instance than the caller asked for.
    describe("opaque identity preservation", () => {
      const WHITESPACE_ROUTE_ATTACHMENT = {
        kind: "external-runtime" as const,
        runtimeId: "mcp-external-runtime",
        attachmentId: " instance-a",
      };
      const WHITESPACE_RUNTIME_ID_ROUTE_ATTACHMENT = {
        kind: "external-runtime" as const,
        runtimeId: " mcp-external-runtime",
        attachmentId: "instance-a",
      };

      function makeAdapterFixture() {
        return makeAdapter({
          adapterDescriptorId: "adapter:mcp-external-runtime:harness",
          providerId: "mcp-external-runtime",
          supportedAccess: ["read-only"],
        });
      }

      it("denies with a mismatch when the requested attachmentId differs from the route's only by a leading space", async () => {
        const adapter = makeAdapterFixture();
        const surface = makeAttachedRuntimeSurface(adapter, ATTACHED_ROUTE_ATTACHMENT);
        const session = makeSession();

        const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
          {
            ...baseInvokeInput,
            externalRuntimeAttachment: { runtimeId: "mcp-external-runtime", attachmentId: " instance-a" },
          },
          {
            session,
            toolCall: { id: "tool-call-attachment-whitespace-mismatch", name: "managed_agent.invoke", input: {} },
          },
        )) as {
          readonly isError: boolean;
          readonly metadata: {
            readonly errorCode?: string;
            readonly requestedAttachment?: unknown;
            readonly admissionReasons?: readonly { readonly code: string }[];
          };
        };

        expect(result.isError).toBe(true);
        expect(result.metadata.admissionReasons).toEqual([{ code: "external-runtime-attachment-mismatch" }]);
        expect(adapter.invoke).not.toHaveBeenCalled();
      });

      it("denies with a mismatch when the requested runtimeId differs from the route's only by a trailing space", async () => {
        const adapter = makeAdapterFixture();
        const surface = makeAttachedRuntimeSurface(adapter, ATTACHED_ROUTE_ATTACHMENT);
        const session = makeSession();

        const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
          {
            ...baseInvokeInput,
            externalRuntimeAttachment: { runtimeId: "mcp-external-runtime ", attachmentId: "instance-a" },
          },
          {
            session,
            toolCall: { id: "tool-call-runtime-id-whitespace-mismatch", name: "managed_agent.invoke", input: {} },
          },
        )) as {
          readonly isError: boolean;
          readonly metadata: {
            readonly errorCode?: string;
            readonly requestedAttachment?: unknown;
            readonly admissionReasons?: readonly { readonly code: string }[];
          };
        };

        expect(result.isError).toBe(true);
        expect(result.metadata.admissionReasons).toEqual([{ code: "external-runtime-attachment-mismatch" }]);
        expect(adapter.invoke).not.toHaveBeenCalled();
      });

      for (const routeAttachment of [WHITESPACE_ROUTE_ATTACHMENT, WHITESPACE_RUNTIME_ID_ROUTE_ATTACHMENT]) {
        it(`admits and preserves '${routeAttachment.runtimeId}:${routeAttachment.attachmentId}' byte-for-byte across snapshot, request, and lifecycle evidence`, async () => {
          const adapter = makeAdapterFixture();
          const surface = makeAttachedRuntimeSurface(adapter, routeAttachment);
          const session = makeSession();

          const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
            {
              ...baseInvokeInput,
              externalRuntimeAttachment: {
                runtimeId: routeAttachment.runtimeId,
                attachmentId: routeAttachment.attachmentId,
              },
            },
            {
              session,
              toolCall: {
                id: `tool-call-preserve-${routeAttachment.attachmentId.trim()}-${routeAttachment.runtimeId.trim()}`,
                name: "managed_agent.invoke",
                input: {},
              },
            },
          )) as {
            readonly isError: boolean;
            readonly metadata: { readonly capabilitySnapshot?: { readonly externalRuntimeAttachment?: unknown } };
          };

          expect(result.isError).toBe(false);
          expect(result.metadata.capabilitySnapshot?.externalRuntimeAttachment).toEqual(routeAttachment);
          expect(adapter.invoke).toHaveBeenCalledTimes(1);
          const invokedRequest = (
            adapter.invoke as unknown as {
              readonly mock: { readonly calls: readonly (readonly [ManagedAgentRuntimeInvocationInput])[] };
            }
          ).mock.calls[0]?.[0].request;
          expect(invokedRequest?.externalRuntimeAttachment).toEqual(routeAttachment);

          const startedEvent = session.sessionEvents.find((event) => event.kind === "agent_invocation_started") as
            | { readonly capabilitySnapshot?: { readonly externalRuntimeAttachment?: unknown } }
            | undefined;
          expect(startedEvent?.capabilitySnapshot?.externalRuntimeAttachment).toEqual(routeAttachment);

          const completedEvent = session.sessionEvents.find((event) => event.kind === "agent_invocation_completed") as
            | {
                readonly managedInvocationEvidence?: {
                  readonly lifecycle?: { readonly externalRuntimeAttachment?: unknown };
                };
              }
            | undefined;
          expect(completedEvent?.managedInvocationEvidence?.lifecycle?.externalRuntimeAttachment).toEqual(
            routeAttachment,
          );
        });
      }

      for (const blank of ["", "   "]) {
        it(`rejects runtimeId '${blank}' as an invalid opaque identity`, async () => {
          const adapter = makeAdapterFixture();
          const surface = makeAttachedRuntimeSurface(adapter, ATTACHED_ROUTE_ATTACHMENT);
          const session = makeSession();

          const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
            {
              ...baseInvokeInput,
              externalRuntimeAttachment: { runtimeId: blank, attachmentId: "instance-a" },
            },
            {
              session,
              toolCall: { id: `tool-call-blank-runtime-id-${blank.length}`, name: "managed_agent.invoke", input: {} },
            },
          )) as { readonly isError: boolean };

          expect(result.isError).toBe(true);
          expect(adapter.invoke).not.toHaveBeenCalled();
        });

        it(`rejects attachmentId '${blank}' as an invalid opaque identity`, async () => {
          const adapter = makeAdapterFixture();
          const surface = makeAttachedRuntimeSurface(adapter, ATTACHED_ROUTE_ATTACHMENT);
          const session = makeSession();

          const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
            {
              ...baseInvokeInput,
              externalRuntimeAttachment: { runtimeId: "mcp-external-runtime", attachmentId: blank },
            },
            {
              session,
              toolCall: {
                id: `tool-call-blank-attachment-id-${blank.length}`,
                name: "managed_agent.invoke",
                input: {},
              },
            },
          )) as { readonly isError: boolean };

          expect(result.isError).toBe(true);
          expect(adapter.invoke).not.toHaveBeenCalled();
        });
      }
    });

    it("exposes an identical externalRuntimeAttachment schema on managed_agent.invoke and managed_agent.start", () => {
      const invokeAttachmentSchema = (
        MANAGED_AGENT_INVOKE_TOOL.inputSchema as { readonly properties?: Record<string, unknown> }
      ).properties?.externalRuntimeAttachment;
      expect(invokeAttachmentSchema).toBeDefined();
    });
  });

  describe("attached runtime builtin tool surface materializable registration", () => {
    it("keeps managed invocation tools deferred, discoverable, and executable", async () => {
      const surface = makeSurface(makeAdapter(), undefined, undefined, {
        testEffectiveTurnAuthority: null,
      });

      const toolNames = [
        "managed_agent.invoke",
        "managed_agent.start",
        "managed_agent.orchestrate",
        "managed_agent.status",
        "managed_agent.list",
        "managed_agent.join",
        "managed_agent.cancel",
      ];

      for (const name of toolNames) {
        expect(surface.toolDefinitions.some((tool) => tool.name === name)).toBe(false);
        expect(surface.capabilities.has(name)).toBe(false);
        expect(surface.materializableTools.has(name)).toBe(true);
        expect(surface.materializableCapabilities.has(name)).toBe(true);
        expect(surface.callBuiltinTools.has(name)).toBe(true);
        const binding = surface.materializableToolBindings.get(name);
        expect(binding?.definition).toBe(surface.materializableTools.get(name));
        expect(binding?.capability).toBe(surface.materializableCapabilities.get(name));
        expect(binding?.executor, name).toBe(surface.callBuiltinTools.get(name));
        expect(binding).toMatchObject({
          definitionDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
          executableAdmissionId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        });

        const catalogSearchAuthority = surface.toolAuthority.get("tool_catalog_search");
        const catalogSearchEffect = surface.materializableCapabilities.get("tool_catalog_search")?.effectEnvelope;
        expect(catalogSearchAuthority).toBeDefined();
        expect(catalogSearchEffect).toBeDefined();
        const discovered = await surface.callBuiltinTools.get("tool_catalog_search")?.(
          {
            exact: name,
            includeSchemas: true,
          },
          {
            session: makeSession(`catalog-${name}`),
            toolCall: { id: `catalog-${name}`, name: "tool_catalog_search", input: {} },
            authority: catalogSearchAuthority!,
            resolvedEffect: catalogSearchEffect!,
          },
        ) as {
          readonly isError: boolean;
          readonly metadata?: Record<string, unknown>;
        } | undefined;
        expect(discovered).toMatchObject({
          isError: false,
          metadata: {
            kind: "catalog",
            operation: "search",
            exact: name,
            resultCount: 1,
            includedSchemas: true,
            stale: false,
            materializableToolName: name,
            catalogSnapshotId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
            materializableToolDefinitionDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
          },
        });
        expect(discovered?.metadata?.catalogSnapshotId).toBe(surface.toolCatalogSnapshotId);
      }
    });

    it("filters strict catalog visibility, bindings, authority, and executors together", async () => {
      const surface = createAttachedRuntimeBuiltinToolSurface({
        builtinToolOptions: {
          toolProjection: {
            mode: "strict",
            alwaysOnTools: ["tool_catalog_search", "managed_agent.invoke"],
          },
        },
        managedInvocation: makeSurfaceOptions(makeAdapter()),
        testEffectiveTurnAuthority: null,
      });

      expect(surface.toolDefinitions.map((tool) => tool.name)).toEqual(["tool_catalog_search"]);
      for (const projection of [
        surface.materializableTools,
        surface.materializableCapabilities,
        surface.materializableToolBindings,
        surface.toolAuthority,
        surface.callBuiltinTools,
      ]) {
        expect([...projection.keys()].sort()).toEqual(["managed_agent.invoke", "tool_catalog_search"]);
      }

      const authority = surface.toolAuthority.get("tool_catalog_search")!;
      const resolvedEffect = surface.materializableCapabilities.get("tool_catalog_search")!.effectEnvelope!;
      const search = surface.callBuiltinTools.get("tool_catalog_search")!;
      const result = await search(
        { exact: "managed_agent.invoke", includeSchemas: true },
        {
          session: makeSession("strict-catalog"),
          toolCall: { id: "strict-catalog", name: "tool_catalog_search", input: {} },
          authority,
          resolvedEffect,
          allowedToolNames: ["managed_agent.invoke", "tool_catalog_search"],
        },
      ) as { readonly metadata?: Record<string, unknown> };
      expect(result).toMatchObject({
        isError: false,
        metadata: {
          materializableToolName: "managed_agent.invoke",
          catalogSnapshotId: surface.toolCatalogSnapshotId,
          materializableToolDefinitionDigest: surface.materializableToolBindings.get("managed_agent.invoke")
            ?.definitionDigest,
        },
      });
      await expect(search(
        { exact: "managed_agent.start", includeSchemas: true },
        {
          session: makeSession("strict-catalog-peer"),
          toolCall: { id: "strict-catalog-peer", name: "tool_catalog_search", input: {} },
          authority,
          resolvedEffect,
          allowedToolNames: ["managed_agent.invoke", "tool_catalog_search"],
        },
      )).resolves.not.toMatchObject({
        metadata: { materializableToolName: "managed_agent.start" },
      });
    });
  });

  describe("route capability materialization invariants", () => {
    it.each([
      [
        "route id",
        (route: ReturnType<typeof makeManagedRoute>) => ({
          ...route.capability,
          identity: { ...route.capability.identity, routeId: "different-route" },
        }),
      ],
      [
        "provider",
        (route: ReturnType<typeof makeManagedRoute>) => ({
          ...route.capability,
          target: { ...route.capability.target, providerId: "different-provider" },
        }),
      ],
      [
        "model",
        (route: ReturnType<typeof makeManagedRoute>) => ({
          ...route.capability,
          target: { ...route.capability.target, modelId: "different-model" },
        }),
      ],
    ] as const)("rejects a capability %s mismatch before creating an adapter", async (_kind, mutateCapability) => {
      const adapter = makeAdapter();
      const createAdapter = vi.fn(async () => adapter);
      const baseRoute = makeManagedRoute("opencode-readonly", "opencode-default-model", async () => adapter);
      const surface = createAttachedRuntimeBuiltinToolSurface({
        managedInvocation: {
          routes: [{ ...baseRoute, capability: mutateCapability(baseRoute), createAdapter }],
        },
      });

      const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
        {
          routeId: "opencode-readonly",
          access: "read-only",
          providerRoute: { providerId: "opencode", model: "opencode-default-model" },
          task: "Inspect capability binding.",
        },
        {
          session: makeSession(),
          toolCall: { id: "tool-call-route-capability-mismatch", name: "managed_agent.invoke", input: {} },
        },
      )) as { readonly isError: boolean; readonly metadata: { readonly errorCode?: string } };

      expect(result.isError).toBe(true);
      expect(result.metadata.errorCode).toBe("route_capability_identity_mismatch");
      expect(createAdapter).not.toHaveBeenCalled();
      expect(adapter.invoke).not.toHaveBeenCalled();
    });

    it("rejects a materialized adapter provider mismatch before invocation", async () => {
      const adapter = makeAdapter({ providerId: "different-provider" });
      const createAdapter = vi.fn(async () => adapter);
      const baseRoute = makeManagedRoute("opencode-readonly", "opencode-default-model", async () => adapter);
      const surface = createAttachedRuntimeBuiltinToolSurface({
        managedInvocation: { routes: [{ ...baseRoute, createAdapter }] },
      });

      const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
        {
          routeId: "opencode-readonly",
          access: "read-only",
          providerRoute: { providerId: "opencode", model: "opencode-default-model" },
          task: "Inspect adapter binding.",
        },
        {
          session: makeSession(),
          toolCall: { id: "tool-call-adapter-capability-mismatch", name: "managed_agent.invoke", input: {} },
        },
      )) as { readonly isError: boolean; readonly metadata: { readonly errorCode?: string } };

      expect(result.isError).toBe(true);
      expect(result.metadata.errorCode).toBe("route_capability_adapter_mismatch");
      expect(createAdapter).toHaveBeenCalledTimes(1);
      expect(adapter.invoke).not.toHaveBeenCalled();
    });

    it("admits a remote harness only for a governed external-runtime capability", async () => {
      const adapter = makeAdapter({
        adapterDescriptorId: "adapter:codex-cloud:remote-harness",
        providerId: "codex-cloud",
        supportedExecutionModes: ["remote-harness"],
      });
      const createAdapter = vi.fn(async () => adapter);
      const baseRoute = makeManagedRoute("codex-cloud-remote-readonly", "gpt-5.5", async () => adapter, "codex-cloud");
      const surface = createAttachedRuntimeBuiltinToolSurface({
        managedInvocation: {
          routes: [
            {
              ...baseRoute,
              capability: makeRouteCapability({
                routeId: "codex-cloud-remote-readonly",
                providerId: "codex-cloud",
                model: "gpt-5.5",
                profiles: ["read-only"],
                adapterKind: "governed-external-runtime",
              }),
              createAdapter,
            },
          ],
        },
      });

      const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
        {
          routeId: "codex-cloud-remote-readonly",
          access: "read-only",
          providerRoute: { providerId: "codex-cloud", model: "gpt-5.5" },
          task: "Inspect remote adapter binding.",
        },
        {
          session: makeSession(),
          toolCall: { id: "tool-call-remote-capability-match", name: "managed_agent.invoke", input: {} },
        },
      )) as { readonly isError: boolean };

      expect(result.isError).toBe(false);
      expect(createAdapter).toHaveBeenCalledTimes(1);
      expect(adapter.invoke).toHaveBeenCalledTimes(1);
    });
  });

  describe("composed caller authority admission", () => {
    it("denies kiln-runtime caller with parentEffectiveRequestedAuthority=read_only + childRequestedAuthority=destructive at the executor level", async () => {
      // This test proves that the composed wiring — from attachment identity
      // through the executor into canonical route admission —
      // denies a destructive child dispatched from a read_only parent.
      // The pure-policy unit tests cover the policy function; this test
      // proves the executor/attachment composition does not bypass it.
      const adapter = makeAdapter();
      const surface = createAttachedRuntimeBuiltinToolSurface({
        managedInvocation: {
          callerIdentity: {
            kind: "kiln-runtime",
            surface: "run",
            attachmentId: "attachment:run:plan-mode",
          },
          routes: [makeManagedRoute("opencode-readonly", "opencode-default-model", async () => adapter)],
        },
        testEffectiveTurnAuthority: TEST_REQUESTED_DESTRUCTIVE_READ_ONLY_PARENT_AUTHORITY,
      });
      const session = makeSession();

      const result = (await surface.callBuiltinTools.get("managed_agent.invoke")?.(
        {
          routeId: "opencode-readonly",
          access: "read-only",
          providerRoute: { providerId: "opencode", model: "opencode-default-model" },
          task: "Delete production data.",
          requestedAuthority: "destructive",
        },
        {
          session,
          toolCall: { id: "tool-call-caller-bounding", name: "managed_agent.invoke", input: {} },
          attendedTrustedExecutionSessionAuthority: {} as never,
        },
      )) as {
        readonly output: string;
        readonly isError: boolean;
        readonly metadata: Record<string, unknown>;
      };

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Managed invocation denied");
      expect(result.output).toContain("authority-exceeds-caller-ceiling");
      expect(result.metadata).toMatchObject({
        status: "denied",
        callerIdentity: expect.objectContaining({
          kind: "kiln-runtime",
          parentEffectiveRequestedAuthority: "read_only",
        }),
        admissionReasons: expect.arrayContaining([
          expect.objectContaining({ code: "authority-exceeds-caller-ceiling" }),
        ]),
      });
      expect(adapter.invoke).not.toHaveBeenCalled();
    });
  });
});
