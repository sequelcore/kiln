import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderStatus } from "../src/components/provider-status.js";
import { useSessionStore } from "../src/lib/session-store.js";

function resetStore(): void {
  useSessionStore.setState({
    status: "ready",
    messages: [],
    currentAssistant: null,
    planMode: false,
    activity: null,
    errorBanner: null,
    providers: [
      {
        id: "claude",
        label: "Claude",
        group: "harness",
        free: false,
        available: true,
        models: ["claude-sonnet-4-6"],
      },
    ],
    activeProvider: "claude",
    activeModel: "claude-sonnet-4-6",
    sessionList: [],
    selectedSessionId: null,
    resumeTargetId: null,
    routedProvider: null,
    routedModel: null,
    routeMode: "auto",
    respondingProvider: null,
    respondingModel: null,
    turnCounter: 0,
    clearPending: false,
    providerSwitching: false,
    providerExplicitSelection: false,
    authorityStatus: null,
    outboundSend: null,
    clearTimeoutId: null,
    providerSwitchTimeoutId: null,
    approvalQueue: [],
    toolCallLog: [],
    activityPhase: "idle",
  });
}

describe("ProviderStatus", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetStore();
  });

  it("renders effective authority and completeness labels", () => {
    useSessionStore.setState({
      authorityStatus: {
        effective: "fail_closed",
        completeness: "authoritative",
      },
    });

    render(<ProviderStatus onOpenPicker={() => undefined} />);

    expect(screen.getByText("authority: fail_closed · authoritative")).toBeInTheDocument();
  });
});
