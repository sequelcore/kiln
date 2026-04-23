import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuiGatewayClient } from "../src/api/client.js";

describe("GuiGatewayClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads session detail from the GUI session detail endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "session-9",
      meta: {
        kilnSessionId: "session-9",
        task: "Inspect preview flow",
        startedAt: "2026-04-21T10:00:00.000Z",
      },
      transcript: [],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GuiGatewayClient("http://localhost:4810");
    const detail = await client.loadSessionDetail("session-9");

    expect(detail?.id).toBe("session-9");
    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/gui/api/sessions/session-9");
  });

  it("returns null when no candidate endpoint resolves a session detail payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GuiGatewayClient("http://localhost:4810");
    const detail = await client.loadSessionDetail("missing-session");

    expect(detail).toBeNull();
    expect(fetchMock).toHaveBeenCalled();
  });
});
