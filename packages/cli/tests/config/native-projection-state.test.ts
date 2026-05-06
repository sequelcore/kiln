import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createNativeProjectionSnapshot,
  detectNativeProjectionDrift,
  emptyNativeProjectionInstallState,
  mergeManagedFields,
  readNativeProjectionInstallState,
  removeNativeProjectionTargetState,
  stripManagedFields,
  upsertNativeProjectionTargetState,
  writeNativeProjectionInstallState,
} from "../../src/config/native-projection-state.js";

describe("native projection install state", () => {
  it("detects drift only when managed fields change", () => {
    const target = createNativeProjectionSnapshot({
      targetId: "codex",
      filePath: "C:/Users/test/.codex/config.toml",
      document: {
        model: "gpt-5.4",
        approval_policy: "on-request",
        userSetting: true,
      },
      managedFields: ["model", "approval_policy"],
      updatedAt: "2026-05-06T12:00:00.000Z",
    });
    const state = upsertNativeProjectionTargetState(emptyNativeProjectionInstallState(), target);

    expect(detectNativeProjectionDrift({
      targetId: "codex",
      state,
      currentDocument: {
        model: "gpt-5.4",
        approval_policy: "on-request",
        userSetting: false,
      },
    })).toBeUndefined();

    expect(detectNativeProjectionDrift({
      targetId: "codex",
      state,
      currentDocument: {
        model: "gpt-5.4",
        approval_policy: "never",
        userSetting: true,
      },
    })).toEqual({
      targetId: "codex",
      driftedFields: ["approval_policy"],
    });
  });

  it("merges managed fields without clobbering unmanaged native keys", () => {
    const merged = mergeManagedFields({
      currentDocument: {
        model: "old",
        approval_policy: "never",
        userSetting: {
          keep: true,
        },
      },
      managedPatch: {
        model: "gpt-5.4",
        approval_policy: "on-request",
        userSetting: {
          keep: false,
        },
      },
      managedFields: ["model", "approval_policy"],
    });

    expect(merged).toEqual({
      model: "gpt-5.4",
      approval_policy: "on-request",
      userSetting: {
        keep: true,
      },
    });
  });

  it("supports nested managed field paths", () => {
    const merged = mergeManagedFields({
      currentDocument: {
        kiln: {
          unmanaged: "keep",
          permission_sync: {
            backend: "old",
          },
        },
      },
      managedPatch: {
        kiln: {
          permission_sync: {
            backend: "codex",
          },
        },
      },
      managedFields: ["kiln.permission_sync"],
    });

    expect(merged).toEqual({
      kiln: {
        unmanaged: "keep",
        permission_sync: {
          backend: "codex",
        },
      },
    });
  });

  it("strips managed fields while preserving unmanaged native keys", () => {
    const stripped = stripManagedFields({
      currentDocument: {
        approval_policy: "on-request",
        userSetting: true,
        kiln: {
          permission_sync: { backend: "codex" },
          legacy: "keep",
        },
      },
      managedFields: ["approval_policy", "kiln.permission_sync"],
    });

    expect(stripped).toEqual({
      userSetting: true,
      kiln: {
        legacy: "keep",
      },
    });
  });

  it("removes empty parent objects after stripping nested managed fields", () => {
    const stripped = stripManagedFields({
      currentDocument: {
        kiln: {
          permission_sync: { backend: "codex" },
        },
      },
      managedFields: ["kiln.permission_sync"],
    });

    expect(stripped).toEqual({});
  });

  it("removes target state by id without affecting other targets", () => {
    const codexTarget = createNativeProjectionSnapshot({
      targetId: "codex",
      filePath: "C:/Users/test/.codex/config.toml",
      document: { approval_policy: "on-request" },
      managedFields: ["approval_policy"],
      updatedAt: "2026-05-06T12:00:00.000Z",
    });
    const opencodeTarget = createNativeProjectionSnapshot({
      targetId: "opencode",
      filePath: "C:/Users/test/.config/opencode/opencode.json",
      document: { permission: { default: "ask" } },
      managedFields: ["permission"],
      updatedAt: "2026-05-06T12:00:00.000Z",
    });
    const state = upsertNativeProjectionTargetState(
      upsertNativeProjectionTargetState(emptyNativeProjectionInstallState(), codexTarget),
      opencodeTarget,
    );

    expect(removeNativeProjectionTargetState(state, "codex")).toEqual({
      version: 1,
      targets: {
        opencode: opencodeTarget,
      },
    });
  });

  it("round-trips install state under .kiln/install-state.json", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-projection-state-"));
    const kilnDir = join(root, ".kiln");
    const state = upsertNativeProjectionTargetState(
      emptyNativeProjectionInstallState(),
      createNativeProjectionSnapshot({
        targetId: "opencode",
        filePath: "C:/Users/test/.config/opencode/opencode.json",
        document: {
          permission: {
            default: "deny",
          },
        },
        managedFields: ["permission.default"],
        updatedAt: "2026-05-06T12:00:00.000Z",
      }),
    );

    try {
      writeNativeProjectionInstallState(kilnDir, state);

      expect(JSON.parse(readFileSync(join(kilnDir, "install-state.json"), "utf8"))).toEqual(state);
      expect(readNativeProjectionInstallState(kilnDir)).toEqual(state);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
