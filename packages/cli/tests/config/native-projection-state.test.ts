import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCommunicationIntent, resolveCommunicationProfile } from "@kilnai/core/agents";
import {
  createNativeProjectionFileSnapshot,
  createNativeProjectionSnapshot,
  detectNativeProjectionDrift,
  detectNativeProjectionFileDrift,
  emptyNativeProjectionInstallState,
  isFullyOwnedNativeProjectionFile,
  mergeManagedFields,
  nativeProjectionFileMatchesDesired,
  readNativeProjectionInstallState,
  removeNativeProjectionTargetState,
  stripManagedFields,
  upsertNativeProjectionTargetState,
  writeNativeProjectionInstallState,
} from "../../src/config/native-projection-state.js";

describe("native projection install state", () => {
  it("rejects tampered persisted communication evidence before status can expose it", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-state-"));
    try {
      const resolution = resolveCommunicationProfile({
        intent: resolveCommunicationIntent([{ source: "project", intent: { locale: "es-MX" } }]),
        execution: { provider: "openai", model: "gpt-5.6-sol", surface: "standalone-harness", harness: "codex" },
      });
      const state = upsertNativeProjectionTargetState(emptyNativeProjectionInstallState(), createNativeProjectionFileSnapshot({
        targetId: "codex-agent:reviewer",
        filePath: "C:/Users/test/.codex/agents/reviewer.toml",
        content: "model = 'gpt-5.6-sol'\n",
        communicationResolution: resolution,
      }));
      writeNativeProjectionInstallState(root, state);
      const statePath = join(root, "install-state.json");
      const tampered = JSON.parse(readFileSync(statePath, "utf8")) as {
        targets: Record<string, { communicationResolution: { responseDetail: Record<string, unknown> } }>;
      };
      tampered.targets["codex-agent:reviewer"]!.communicationResolution.responseDetail.rawPrompt = "secret";
      writeFileSync(statePath, JSON.stringify(tampered), "utf8");

      expect(() => readNativeProjectionInstallState(root)).toThrow("Invalid communication resolution");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("strips only the owned multiplicity from the end of managed arrays", () => {
    const item = { path: "C:/same/SKILL.md", enabled: false };
    expect(stripManagedFields({
      currentDocument: { skills: { config: [item, { path: "C:/other", enabled: true }, item] } },
      managedFields: ["skills.config"], managedArrayItems: { "skills.config": [item] },
    })).toEqual({ skills: { config: [item, { path: "C:/other", enabled: true }] } });
  });
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

  it("detects drift for whole-file managed projection targets", () => {
    const target = createNativeProjectionFileSnapshot({
      targetId: "claude-autoformat-hook",
      filePath: "C:/repo/.claude/hooks/autoformat.sh",
      content: "#!/bin/sh\nexit 0\n",
      updatedAt: "2026-05-06T12:00:00.000Z",
    });
    const state = upsertNativeProjectionTargetState(emptyNativeProjectionInstallState(), target);

    expect(detectNativeProjectionFileDrift({
      targetId: "claude-autoformat-hook",
      state,
      currentContent: "#!/bin/sh\nexit 0\n",
    })).toBeUndefined();

    expect(detectNativeProjectionFileDrift({
      targetId: "claude-autoformat-hook",
      state,
      currentContent: "#!/bin/sh\necho drift\n",
    })).toEqual({
      targetId: "claude-autoformat-hook",
      driftedFields: ["$file"],
    });
  });

  it("detects drift for binary whole-file projection targets", () => {
    const content = Uint8Array.from([0, 255, 17, 34]);
    const target = createNativeProjectionFileSnapshot({
      targetId: "codex-skill:visual/assets/icon.png",
      filePath: "C:/Users/test/.codex/skills/visual/assets/icon.png",
      content,
    });
    const state = upsertNativeProjectionTargetState(emptyNativeProjectionInstallState(), target);

    expect(detectNativeProjectionFileDrift({
      targetId: target.targetId,
      state,
      currentContent: Uint8Array.from(content),
    })).toBeUndefined();
    expect(detectNativeProjectionFileDrift({
      targetId: target.targetId,
      state,
      currentContent: Uint8Array.from([0, 255, 17, 35]),
    })).toEqual({ targetId: target.targetId, driftedFields: ["$file"] });
  });

  it("recognizes canonical bytes for a fully-owned file despite a stale snapshot", () => {
    const target = createNativeProjectionFileSnapshot({
      targetId: "codex-skill:planner/SKILL.md",
      filePath: "C:/Users/test/.codex/skills/planner/SKILL.md",
      content: "historical\n",
      harness: "codex",
      sourceIdentity: "skill:planner/SKILL.md",
    });

    expect(isFullyOwnedNativeProjectionFile(target)).toBe(true);
    expect(nativeProjectionFileMatchesDesired({
      target,
      currentContent: Buffer.from("canonical\n", "utf8"),
      desiredContent: "canonical\n",
      expected: {
        targetId: target.targetId,
        filePath: "C:/Users/test/.codex/skills/planner/SKILL.md",
        harness: "codex",
        sourceIdentity: "skill:planner/SKILL.md",
      },
    })).toBe(true);
    expect(nativeProjectionFileMatchesDesired({
      target,
      currentContent: "operator drift\n",
      desiredContent: "canonical\n",
      expected: {
        targetId: target.targetId,
        filePath: target.filePath,
        harness: "codex",
        sourceIdentity: "skill:planner/SKILL.md",
      },
    })).toBe(false);

    expect(nativeProjectionFileMatchesDesired({
      target,
      currentContent: "canonical\n",
      desiredContent: "canonical\n",
      expected: {
        targetId: target.targetId,
        filePath: target.filePath,
        harness: "claude",
        sourceIdentity: "skill:planner/SKILL.md",
      },
    })).toBe(false);
    expect(nativeProjectionFileMatchesDesired({
      target,
      currentContent: "canonical\n",
      desiredContent: "canonical\n",
      expected: {
        targetId: target.targetId,
        filePath: target.filePath.replace("planner", "other"),
        harness: "codex",
        sourceIdentity: "skill:planner/SKILL.md",
      },
    })).toBe(false);
    expect(nativeProjectionFileMatchesDesired({
      target,
      currentContent: "canonical\n",
      desiredContent: "canonical\n",
      expected: {
        targetId: "codex-skill:other/SKILL.md",
        filePath: target.filePath,
        harness: "codex",
        sourceIdentity: "skill:planner/SKILL.md",
      },
    })).toBe(false);

    const documentTarget = createNativeProjectionSnapshot({
      targetId: "codex-config",
      filePath: "C:/Users/test/.codex/config.toml",
      document: { model: "gpt-5.4" },
      managedFields: ["model"],
    });
    expect(isFullyOwnedNativeProjectionFile(documentTarget)).toBe(false);
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

  it("supports JSON Pointer managed paths for MCP server ids containing dots", () => {
    const field = "/mcp_servers/studio.v2";
    const document = {
      mcp_servers: {
        "studio.v2": { command: "cmd.exe", args: ["/c", "studio.bat"] },
        unmanaged: { command: "keep" },
      },
    };
    const target = createNativeProjectionSnapshot({
      targetId: "codex-mcp",
      filePath: "C:/repo/.codex/config.toml",
      document,
      managedFields: [field],
    });
    const state = upsertNativeProjectionTargetState(emptyNativeProjectionInstallState(), target);

    expect(detectNativeProjectionDrift({
      targetId: "codex-mcp",
      state,
      currentDocument: document,
    })).toBeUndefined();
    expect(stripManagedFields({ currentDocument: document, managedFields: [field] })).toEqual({
      mcp_servers: { unmanaged: { command: "keep" } },
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
