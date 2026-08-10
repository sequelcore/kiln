import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createOperatorProjectManagedJobApplicationComposition } from "../../../cli/src/application/operator-project-managed-jobs.js";
import { readGlobalConfig } from "../../../cli/src/config/global-config.js";
import {
  KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_ROUTE_ENV,
  KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_TESTS_ENV,
  describeManagedAgentProviderLive,
  withManagedAgentLiveFixtureWorkspace,
} from "./managed-agent-live-test-harness.js";

describeManagedAgentProviderLive(
  "managed opencode-go direct approved-write live proof",
  KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_TESTS_ENV,
  () => {
    it("commits, fences, writes, settles, and replays one approved disposable job", async () => {
      await withManagedAgentLiveFixtureWorkspace({
        prefix: "kiln-opencode-go-managed-write-",
        files: { "proof.txt": "before\n" },
        onWorkspaceCreated: async (workspace) => {
          const kilnRoot = join(workspace.workspaceRoot, ".kiln");
          await mkdir(join(kilnRoot, "agents"), { recursive: true });
          await writeFile(join(kilnRoot, "kiln.yaml"), 'version: "1"\n', "utf8");
          await writeFile(join(kilnRoot, "agents", "live-opencode-write.md"), liveAgentDefinition(), "utf8");
        },
      }, async (workspace) => {
        const requestTrace: Array<Record<string, unknown>> = [];
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (input, init) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.endsWith("/chat/completions") && typeof init?.body === "string") {
            try {
              const body = JSON.parse(init.body) as {
                readonly model?: unknown;
                readonly max_tokens?: unknown;
                readonly messages?: readonly { readonly role?: unknown; readonly tool_calls?: readonly unknown[]; readonly tool_call_id?: unknown }[];
                readonly tools?: readonly { readonly function?: { readonly name?: unknown; readonly description?: unknown; readonly parameters?: unknown } }[];
                readonly tool_choice?: unknown;
              };
              const trace: Record<string, unknown> = {
                bodyBytes: Buffer.byteLength(init.body, "utf8"),
                model: body.model,
                maxTokens: body.max_tokens,
                roles: body.messages?.map((message) => message.role),
                messageBytes: body.messages?.map((message) => Buffer.byteLength(JSON.stringify(message), "utf8")),
                assistantToolCallCounts: body.messages?.filter((message) => message.role === "assistant").map((message) => message.tool_calls?.length ?? 0),
                toolResultCount: body.messages?.filter((message) => message.role === "tool" && message.tool_call_id !== undefined).length ?? 0,
                toolNames: body.tools?.map((tool) => tool.function?.name),
                toolBytes: body.tools?.map((tool) => Buffer.byteLength(JSON.stringify(tool), "utf8")),
                toolChoice: body.tool_choice,
              };
              requestTrace.push(trace);
            } catch {
              requestTrace.push({ parse: "failed" });
            }
          }
          return originalFetch(input, init);
        };
        const routeId = process.env[KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_ROUTE_ENV]?.trim()
          || "opencode-go-critical-approved-write";
        const liveRoute = assertLiveRoute(routeId);
        const composition = await createOperatorProjectManagedJobApplicationComposition({
          projectPath: workspace.workspaceRoot,
        });
        try {
          const accepted = await composition.application.accept({
            objective: [
              "Use the admitted write or edit tool on proof.txt exactly once.",
              "Replace its complete contents with exactly: after",
              "Do not create, edit, or delete any other project file.",
              "Report completion only after the tool returns success.",
            ].join(" "),
            configuredAgentProfileId: "live-opencode-write",
            callerId: "managed-live-operator",
            idempotencyKey: "opencode-go-managed-write-live-v1",
          });
          expect(accepted).toMatchObject({
            state: "awaiting_approval",
            admissionProfileId: "foundation-apply-approved-writes",
            dispatch: { kind: "economic", candidateSet: { candidates: [{ routeId, model: liveRoute.model }] } },
          });
          await expect(workspace.readFile("proof.txt")).resolves.toBe("before\n");

          await composition.application.approveWrite(
            accepted.id,
            new Date(Date.now() + 5 * 60_000).toISOString(),
          );

          const status = await composition.application.getStatus({ callerId: "managed-live-operator" }, accepted.id);
          const result = await composition.application.getResult({ callerId: "managed-live-operator" }, accepted.id);
          const replay = await composition.application.getReplay({ callerId: "managed-live-operator" }, accepted.id);
          if (status.state !== "succeeded") {
            throw new Error(JSON.stringify({
              state: status.state,
              diagnostic: status.diagnostic,
              failureEvidence: status.failureEvidence,
              resultAvailability: result.availability,
              economicAvailability: replay.dispatch.kind === "economic" ? replay.dispatch.economic.availability : "native",
              requestTrace,
            }));
          }
          expect(status).toMatchObject({
            state: "succeeded",
            result: { routeId, providerId: "opencode-go" },
            writeApproval: { state: "consumed", consumedBy: `managed-job:${accepted.id}` },
          });
          expect(result).toMatchObject({
            availability: "available",
            routeId,
            providerId: "opencode-go",
            writeApproval: { state: "consumed" },
            writeEvidence: expect.arrayContaining([
              expect.objectContaining({ kind: "write-proposal-created" }),
              expect.objectContaining({ kind: "write-proposal-approved" }),
              expect.objectContaining({ kind: "write-attempt-completed" }),
            ]),
          });
          expect(replay).toMatchObject({
            lifecycleState: "succeeded",
            resultAvailability: "available",
            writeApproval: { state: "consumed" },
            dispatch: { kind: "economic", economic: { availability: "available" } },
          });
          await expect(workspace.readFile("proof.txt")).resolves.toBe("after");
          const projected = JSON.stringify([status, result, replay]);
          expect(projected).not.toContain(workspace.workspaceRoot);
          expect(projected).not.toMatch(/accountRef|credentialRevision|api[_-]?key|authorization|bearer/iu);

          const replayed = await composition.application.accept({
            objective: [
              "Use the admitted write or edit tool on proof.txt exactly once.",
              "Replace its complete contents with exactly: after",
              "Do not create, edit, or delete any other project file.",
              "Report completion only after the tool returns success.",
            ].join(" "),
            configuredAgentProfileId: "live-opencode-write",
            callerId: "managed-live-operator",
            idempotencyKey: "opencode-go-managed-write-live-v1",
          });
          expect(replayed).toEqual(status);
          await expect(workspace.readFile("proof.txt")).resolves.toBe("after");
        } finally {
          globalThis.fetch = originalFetch;
          await composition.close();
        }
      });
    }, 360_000);
  },
);

function liveAgentDefinition(): string {
  const routeId = process.env[KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_ROUTE_ENV]?.trim()
    || "opencode-go-critical-approved-write";
  const route = assertLiveRoute(routeId);
  return [
    "---",
    "name: live-opencode-write",
    "role: Disposable approved-write live verifier",
    "goal: Apply one bounded operator-approved fixture write.",
    "tier: fast",
    "mode: managed-child",
    `routeId: ${routeId}`,
    "economicPolicyId: opencode-subscription-default",
    "providerRoute:",
    "  providerId: opencode-go",
    `  model: ${route.model}`,
    "authorityProfile: foundation-apply-approved-writes",
    "---",
    "Live proof only.",
    "",
  ].join("\n");
}

function assertLiveRoute(routeId: string): { readonly model: string } {
  const config = readGlobalConfig();
  const route = config?.managedAgents?.routes?.find((candidate) => candidate.id === routeId);
  if (
    !route
    || route.kind !== "direct"
    || route.provider !== "opencode-go"
    || typeof route.model !== "string"
    || route.model.trim().length === 0
    || route.profiles?.includes("foundation-apply-approved-writes") !== true
    || route.tools?.writes !== true
    || route.tools?.network !== false
    || route.writeAuthority?.workspace.mode !== "apply-approved"
    || route.writeAuthority.approval.mode !== "required-before-apply"
    || route.credentials?.mode !== "runtime-selected"
  ) {
    throw new Error("Live proof requires one account-leased opencode-go direct approved-write route.");
  }
  return { model: route.model };
}
