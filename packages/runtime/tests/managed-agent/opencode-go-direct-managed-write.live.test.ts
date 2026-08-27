import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createOperatorProjectAgentTaskApplicationComposition } from "../../../cli/src/application/operator-project-agent-tasks.js";
import { readGlobalConfig } from "../../../cli/src/config/global-config.js";
import {
  KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_ROUTE_ENV,
  KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_TESTS_ENV,
  describeManagedAgentProviderLive,
  requireManagedAgentLiveEnvironment,
  withManagedAgentLiveFixtureWorkspace,
} from "./managed-agent-live-test-harness.js";
import { createTestFetch } from "../fetch-fixture.js";

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
        const fetchImplementation = async (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.endsWith("/chat/completions") && typeof init?.body === "string") {
            try {
              const body = JSON.parse(init.body) as {
                readonly model?: unknown;
                readonly max_tokens?: unknown;
                readonly messages?: readonly { readonly role?: unknown; readonly tool_calls?: readonly unknown[]; readonly tool_call_id?: unknown }[];
                readonly tools?: readonly { readonly function?: { readonly name?: unknown; readonly description?: unknown; readonly parameters?: unknown } }[];
                readonly tool_choice?: unknown;
                readonly stream_options?: { readonly include_usage?: unknown };
              };
              const headers = new Headers(init.headers);
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
                includesStreamUsage: body.stream_options?.include_usage === true,
                hasProjectIdentity: headers.has("x-opencode-project"),
                hasSessionIdentity: headers.has("x-opencode-session"),
                hasRequestIdentity: headers.has("x-opencode-request"),
                client: headers.get("x-opencode-client"),
                hasKilnUserAgent: headers.get("user-agent")?.startsWith("kiln/") === true,
              };
              requestTrace.push(trace);
            } catch {
              requestTrace.push({ parse: "failed" });
            }
          }
          const response = await originalFetch(input, init);
          const trace = requestTrace.at(-1);
          if (!trace || !url.endsWith("/chat/completions")) return response;
          trace.responseStatus = response.status;
          trace.hasResponseBody = response.body !== null;
          return observeOpenCodeResponse(response, trace);
        };
        globalThis.fetch = createTestFetch(fetchImplementation);
        const routeId = requireManagedAgentLiveEnvironment(KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_ROUTE_ENV);
        const liveRoute = assertLiveTarget(routeId);
        const composition = await createOperatorProjectAgentTaskApplicationComposition({
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

          const status = await waitForTerminalJob(
            () => composition.application.getStatus({ callerId: "managed-live-operator" }, accepted.id),
            240_000,
          );
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
            writeApproval: { state: "consumed", consumedBy: `agent-task:${accepted.id}` },
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
          expect(requestTrace).not.toHaveLength(0);
          expect(requestTrace).toEqual(expect.arrayContaining([
            expect.objectContaining({
              includesStreamUsage: true,
              hasProjectIdentity: true,
              hasSessionIdentity: true,
              hasRequestIdentity: true,
              client: "kiln",
              hasKilnUserAgent: true,
            }),
          ]));
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

async function waitForTerminalJob<T extends { readonly state: string }>(
  readStatus: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const status = await readStatus();
    if (!["awaiting_approval", "queued", "running"].includes(status.state)) return status;
    if (Date.now() >= deadline) {
      throw new Error(`Managed live job remained ${status.state} beyond ${timeoutMs}ms.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function observeOpenCodeResponse(response: Response, trace: Record<string, unknown>): Response {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let byteChunks = 0;
  let dataEvents = 0;
  let sawDone = false;
  let sawUsage = false;
  const finishReasons = new Set<string>();
  const deltaKeys = new Set<string>();
  const toolCallNames = new Set<string>();
  const flushLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ")) return;
    dataEvents += 1;
    const data = trimmed.slice(6);
    if (data === "[DONE]") {
      sawDone = true;
      return;
    }
    try {
      const event = JSON.parse(data) as {
        readonly usage?: unknown;
        readonly choices?: readonly {
          readonly finish_reason?: unknown;
          readonly delta?: Record<string, unknown> & {
            readonly tool_calls?: readonly { readonly function?: { readonly name?: unknown } }[];
          };
        }[];
      };
      if (event.usage !== undefined) sawUsage = true;
      for (const choice of event.choices ?? []) {
        if (typeof choice.finish_reason === "string") finishReasons.add(choice.finish_reason);
        for (const key of Object.keys(choice.delta ?? {})) deltaKeys.add(key);
        for (const toolCall of choice.delta?.tool_calls ?? []) {
          if (typeof toolCall.function?.name === "string") toolCallNames.add(toolCall.function.name);
        }
      }
    } catch {
      trace.sseParseFailure = true;
    }
  };
  const updateTrace = (): void => {
    trace.responseByteChunks = byteChunks;
    trace.sseDataEvents = dataEvents;
    trace.sawDone = sawDone;
    trace.sawUsage = sawUsage;
    trace.finishReasons = [...finishReasons].sort();
    trace.deltaKeys = [...deltaKeys].sort();
    trace.toolCallNames = [...toolCallNames].sort();
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const result = await reader.read();
      if (result.done) {
        buffer += decoder.decode();
        if (buffer.trim().length > 0) flushLine(buffer);
        updateTrace();
        controller.close();
        return;
      }
      byteChunks += 1;
      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) flushLine(line);
      updateTrace();
      controller.enqueue(result.value);
    },
    async cancel(reason) {
      updateTrace();
      await reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function liveAgentDefinition(): string {
  const targetId = requireManagedAgentLiveEnvironment(KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_ROUTE_ENV);
  const target = assertLiveTarget(targetId);
  return [
    "---",
    "name: live-opencode-write",
    "role: Disposable approved-write live verifier",
    "goal: Apply one bounded operator-approved fixture write.",
    "tier: fast",
    "mode: managed-child",
    `targetId: ${targetId}`,
    `authorityProfileId: ${target.authorityProfileId}`,
    "---",
    "Live proof only.",
    "",
  ].join("\n");
}

function assertLiveTarget(targetId: string): { readonly authorityProfileId: string; readonly model: string } {
  const config = readGlobalConfig();
  const target = config?.targetCatalog?.targets.find((candidate) => candidate.id === targetId);
  const authorityProfile = config?.authorityProfiles?.find(
    (candidate) => candidate.admissionProfile === "foundation-apply-approved-writes",
  );
  const intent = config?.managedAgents?.intents?.find(
    (candidate) => candidate.target?.mode === "explicit" && candidate.target.targetId === targetId,
  );
  if (
    !target
    || target.kind !== "direct"
    || target.providerId !== "opencode-go"
    || target.providerModelId.trim().length === 0
     || target.accountPolicyId.trim().length === 0
    || !authorityProfile
    || authorityProfile.tools?.writes !== true
    || authorityProfile.tools?.network !== false
    || authorityProfile.writeAuthority?.workspace?.mode !== "apply-approved"
    || authorityProfile.writeAuthority?.approval.mode !== "required-before-apply"
    || !intent
  ) {
    throw new Error("Live proof requires one account-leased opencode-go direct approved-write target and authority profile.");
  }
  return { authorityProfileId: authorityProfile.id, model: target.providerModelId };
}
