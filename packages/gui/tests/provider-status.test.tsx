import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderStatus } from "../src/components/provider-status.js";
import { useSessionStore } from "../src/lib/session-store/index.js";

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
    continuationTargetId: null,
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

    expect(screen.getByText("Authority: Auto -> Blocked · Read-only sandbox · Authoritative")).toBeInTheDocument();
  });

  it("keeps authority accessible without duplicating it in the compact composer status", () => {
    useSessionStore.setState({
      authorityStatus: {
        effective: "idempotent",
        admittedAuthority: "idempotent",
        requestedAuthority: "planning",
        executionMode: "execute",
        sandboxProjection: "none",
        completeness: "partial",
      },
    });

    render(<ProviderStatus onOpenPicker={() => undefined} compact />);

    expect(screen.getByRole("button", {
      name: "Provider selector. Current selection: Claude / claude-sonnet-4-6. Authority: Planning -> Idempotent · Partial. Click to change.",
    })).toBeInTheDocument();
    expect(screen.queryByText("Authority: Planning -> Idempotent · Partial"))
      .not.toBeInTheDocument();
    expect(screen.queryByText(/Sandboxed/)).not.toBeInTheDocument();
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

    expect(screen.getByRole("button", { name: "Provider selector. Current selection: Select provider / model. Authority: Unknown. Click to change." })).toBeInTheDocument();
    expect(screen.getByText("Select provider / model")).toBeInTheDocument();
  });

  it("announces provider switching without restoring technical detail", () => {
    useSessionStore.setState({ providerSwitching: true });

    render(<ProviderStatus onOpenPicker={() => undefined} compact />);

    expect(screen.getByRole("button", { name: /Provider selector/ })).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Switching provider...")).toBeInTheDocument();
    expect(screen.queryByText(/Authority:/)).not.toBeInTheDocument();
  });
});
