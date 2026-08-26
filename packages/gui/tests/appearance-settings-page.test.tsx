import type { KilnSettingsSnapshot } from "@kilnai/gateway-contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppearanceSettingsPage } from "../src/components/appearance-settings-page.js";

const preference = {
  mode: "system" as const,
  themeByScheme: { light: "automata", dark: "phosphor" },
};

function snapshot(): KilnSettingsSnapshot {
  return {
    schemaRevision: 3,
    generatedAt: "2026-08-24T00:00:00.000Z",
    health: "current",
    activationStatus: {
      desiredRevisionSetId: `sha256:${"a".repeat(64)}`,
      state: "not-started",
      boundary: null,
      activeRevision: null,
      entries: [],
      summary: "No pending activation.",
    },
    sections: [],
    entries: [
      {
        key: "ui.appearance",
        identity: "/ui/appearance",
        section: "appearance",
        label: "Operator appearance",
        description: "Color scheme and themes.",
        searchTerms: ["theme"],
        control: { kind: "json" },
        supportedScopes: ["global"],
        effective: { value: preference },
        source: "global",
        override: "overridden",
        inherited: false,
        modified: true,
        writeTargets: [],
        owners: ["operator-preferences"],
        authorityImpact: "none",
        approvalRequired: false,
        activation: "hot",
        health: "current",
        capabilities: { read: true, set: true, reset: true },
        revisions: {},
      },
    ],
    revisions: {},
    modifiedCount: 1,
  };
}

describe("AppearanceSettingsPage", () => {
  it("persists one complete preference when the operator chooses a fixed scheme", async () => {
    const onSave = vi.fn(async () => undefined);
    render(
      <AppearanceSettingsPage snapshot={snapshot()} loading={false} error={null} onSave={onSave} onRefresh={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Light" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        {
          mode: "light",
          themeByScheme: { light: "automata", dark: "phosphor" },
        },
        "absent",
      ),
    );
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
  });

  it("offers the shared Sequel theme for dark mode", () => {
    render(
      <AppearanceSettingsPage
        snapshot={snapshot()}
        loading={false}
        error={null}
        onSave={vi.fn(async () => undefined)}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Use Sequel for dark mode" })).toBeInTheDocument();
  });

  it("restores the canonical appearance and exposes a recoverable inline failure", async () => {
    render(
      <AppearanceSettingsPage
        snapshot={snapshot()}
        loading={false}
        error={null}
        onSave={async () => {
          throw new Error("revision conflict");
        }}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dark" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("revision conflict");
    });
    expect(screen.getByRole("button", { name: "System" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps a committed appearance when settings refresh fails", async () => {
    render(
      <AppearanceSettingsPage
        snapshot={snapshot()}
        loading={false}
        error={null}
        onSave={vi.fn(async () => undefined)}
        onRefresh={async () => {
          throw new Error("gateway unavailable");
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dark" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Theme saved, but settings could not be refreshed");
    });
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  });
});
