import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderStatus } from "../src/components/provider-status.js";
import { useSessionStore } from "../src/lib/session-store.js";

function resetStore(): void {
  useSessionStore.setState({
    status: "ready",
    messages: [],
    timelineEntries: [],
    currentAssistant: null,
    planMode: false,
    activity: null,
    errorBanner: null,
    providerCatalogStatus: "ready",
    providerCatalogError: null,
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
    liveSessionId: null,
    resumeTargetId: null,
    detachedSessionIds: [],
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
        admittedAuthority: "fail_closed",
        requestedAuthority: "auto",
        executionMode: "execute",
        sandboxProjection: "read_only",
        completeness: "authoritative",
      },
    });

    render(<ProviderStatus onOpenPicker={() => undefined} />);

    expect(screen.getByText("authority: auto -> fail_closed · sandbox read_only · authoritative")).toBeInTheDocument();
  });

  it("shows authority in the compact composer status", () => {
    useSessionStore.setState({
      authorityStatus: {
        effective: "audited",
        admittedAuthority: "audited",
        requestedAuthority: "auto",
        executionMode: "execute",
        sandboxProjection: "workspace_write",
        completeness: "authoritative",
      },
    });

    render(<ProviderStatus onOpenPicker={() => undefined} compact />);

    expect(screen.getByText("authority: auto -> audited · sandbox workspace_write · authoritative")).toBeInTheDocument();
  });

  it("renders domain and working directory indicators in the status area", () => {
    render(
      <ProviderStatus
        onOpenPicker={() => undefined}
        domainLabel="Kiln"
        workingDirectory="C:/workspace/kiln"
      />,
    );

    expect(screen.getByText("domain: Kiln")).toBeInTheDocument();
    expect(screen.getByText("cwd: C:/workspace/kiln")).toBeInTheDocument();
  });

  it("renders an explicit compact empty state before a provider is selected", () => {
    useSessionStore.setState({
      activeProvider: null,
      activeModel: null,
      providers: [],
    });

    render(<ProviderStatus onOpenPicker={() => undefined} compact />);

    expect(screen.getByRole("button", { name: "Provider selector. Current selection: Select provider / model. authority: unknown. Click to change." })).toBeInTheDocument();
    expect(screen.getByText("Select provider / model")).toBeInTheDocument();
  });
});
