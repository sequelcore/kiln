/**
 * Phase 7 foundation surface for Kiln's terminal UI.
 *
 * This package is an interface adapter boundary only.
 * Runtime orchestration, session lifecycle, approval policy, and persistence
 * stay in existing core/runtime/cli layers.
 */

export const KILN_TUI_PACKAGE = "@kilnai/tui";

/**
 * Marker interface for the future terminal application boundary.
 * Concrete terminal implementation is intentionally deferred until the
 * application-service extraction work is complete.
 */
export interface KilnTuiApp {
  start(): Promise<void>;
}
