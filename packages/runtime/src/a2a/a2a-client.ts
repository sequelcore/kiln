// A2AClient: discovers remote agents via Agent Card and sends tasks

import type { AgentCard, A2ATask, A2AMessage } from "@kilnai/core";
import { KilnError } from "@kilnai/core";

export class A2AClient {
  async discoverAgent(agentUrl: string): Promise<AgentCard> {
    const cardUrl = `${agentUrl.replace(/\/$/, "")}/.well-known/agent.json`;

    let response: Response;
    try {
      response = await fetch(cardUrl);
    } catch (err) {
      throw new KilnError("A2A_CLIENT_FAILED", `Failed to fetch agent card from ${cardUrl}: ${err}`, {
        context: { agentUrl, cardUrl },
        cause: err,
      });
    }

    if (!response.ok) {
      throw new KilnError("A2A_CLIENT_FAILED", `Agent card request failed with status ${response.status}`, {
        context: { agentUrl, cardUrl, status: response.status },
      });
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (err) {
      throw new KilnError("A2A_CLIENT_FAILED", "Failed to parse agent card JSON", {
        context: { agentUrl, cardUrl },
        cause: err,
      });
    }

    if (typeof data !== "object" || data === null) {
      throw new KilnError("A2A_CLIENT_FAILED", "Agent card response is not a valid object", {
        context: { agentUrl, cardUrl },
      });
    }

    const card = data as AgentCard;
    if (!card.name || !card.url || !card.version || !card.capabilities) {
      throw new KilnError("A2A_CLIENT_FAILED", "Agent card is missing required fields", {
        context: { agentUrl, cardUrl, card },
      });
    }

    return card;
  }

  async sendTask(agentUrl: string, message: A2AMessage, timeout?: number): Promise<A2ATask> {
    const endpoint = agentUrl.replace(/\/$/, "");

    const requestBody = {
      jsonrpc: "2.0",
      method: "tasks/send",
      params: { message },
      id: crypto.randomUUID(),
    };

    const controller = new AbortController();
    const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout) : undefined;

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      if (err instanceof Error && err.name === "AbortError") {
        throw new KilnError("A2A_CLIENT_FAILED", `Task request timed out after ${timeout}ms`, {
          context: { agentUrl, timeout },
        });
      }
      throw new KilnError("A2A_CLIENT_FAILED", `Failed to send task to ${endpoint}: ${err}`, {
        context: { agentUrl },
        cause: err,
      });
    }

    if (timeoutId) clearTimeout(timeoutId);

    if (!response.ok) {
      throw new KilnError("A2A_CLIENT_FAILED", `Task request failed with status ${response.status}`, {
        context: { agentUrl, status: response.status },
      });
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (err) {
      throw new KilnError("A2A_CLIENT_FAILED", "Failed to parse task response JSON", {
        context: { agentUrl },
        cause: err,
      });
    }

    if (typeof data !== "object" || data === null) {
      throw new KilnError("A2A_CLIENT_FAILED", "Task response is not a valid object", {
        context: { agentUrl },
      });
    }

    const jsonRpc = data as { error?: { message: string }; result?: A2ATask };
    if (jsonRpc.error) {
      throw new KilnError("A2A_CLIENT_FAILED", `Remote agent error: ${jsonRpc.error.message}`, {
        context: { agentUrl, error: jsonRpc.error },
      });
    }

    if (!jsonRpc.result) {
      throw new KilnError("A2A_CLIENT_FAILED", "Task response missing 'result' field", {
        context: { agentUrl, response: data },
      });
    }

    return jsonRpc.result;
  }
}
