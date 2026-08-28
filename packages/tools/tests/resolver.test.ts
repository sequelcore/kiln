import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  getVendoredPackageCandidates,
  listVendoredPlatformPackages,
  resolveVendoredToolBinary,
  resolveVendoredPlatformPackage,
} from "../src/index.js";

function normalizePath(path: string | undefined): string | undefined {
  return path?.replace(/\\/g, "/");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("listVendoredPlatformPackages", () => {
  it("describes the 4 initial platform packages", () => {
    const descriptors = listVendoredPlatformPackages();
    const packageNames = descriptors.map((descriptor) => descriptor.packageName);

    expect(packageNames).toEqual([
      "@kilnai/tools-win32-x64",
      "@kilnai/tools-darwin-arm64",
      "@kilnai/tools-darwin-x64",
      "@kilnai/tools-linux-x64",
    ]);
    expect(descriptors.map((descriptor) => descriptor.binaries)).toEqual([
      ["rg", "fd", "jq", "oxlint"],
      ["rg", "fd", "jq", "oxlint"],
      ["rg", "jq", "oxlint"],
      ["rg", "fd", "jq", "oxlint"],
    ]);
  });
});

describe("getVendoredPackageCandidates", () => {
  it("prioritizes exact platform+arch match first", () => {
    const candidates = getVendoredPackageCandidates({
      platform: "darwin",
      arch: "arm64",
    });

    expect(candidates[0]?.packageName).toBe("@kilnai/tools-darwin-arm64");
  });

  it("returns no package when no exact platform+arch match exists", () => {
    const candidates = getVendoredPackageCandidates({
      platform: "linux",
      arch: "arm64",
    });

    expect(candidates).toEqual([]);
  });
});

describe("resolveVendoredPlatformPackage", () => {
  it("resolves the exact platform package", () => {
    const resolved = resolveVendoredPlatformPackage({
      platform: "win32",
      arch: "x64",
      resolvePackageJson: (specifier) => {
        if (specifier === "@kilnai/tools-win32-x64/package.json") {
          return "C:/mock/tools-win32-x64/package.json";
        }
        throw new Error("not found");
      },
    });

    expect(resolved).toEqual({
      packageName: "@kilnai/tools-win32-x64",
      platform: "win32",
      arch: "x64",
      binaries: ["rg", "fd", "jq", "oxlint"],
      packageJsonPath: "C:/mock/tools-win32-x64/package.json",
    });
  });

  it("returns undefined when no candidate resolves", () => {
    const resolved = resolveVendoredPlatformPackage({
      platform: "linux",
      arch: "x64",
      resolvePackageJson: () => {
        throw new Error("not found");
      },
    });

    expect(resolved).toBeUndefined();
  });

  it("does not fall back to another platform package or PATH", () => {
    const attempted: string[] = [];
    const resolved = resolveVendoredPlatformPackage({
      platform: "linux",
      arch: "arm64",
      resolvePackageJson: (specifier) => {
        attempted.push(specifier);
        return "C:/wrong-platform/package.json";
      },
    });

    expect(resolved).toBeUndefined();
    expect(attempted).toEqual([]);
  });
});

describe("resolveVendoredToolBinary", () => {
  it("resolves a Windows executable only when the vendored binary exists", () => {
    const resolved = resolveVendoredToolBinary("rg", {
      platform: "win32",
      arch: "x64",
      resolvePackageJson: (specifier) => {
        if (specifier === "@kilnai/tools-win32-x64/package.json") {
          return "C:/mock/tools-win32-x64/package.json";
        }
        throw new Error("not found");
      },
      readTextFile: (path) => {
        if (normalizePath(path) === "C:/mock/tools-win32-x64/tools.json") {
          return JSON.stringify({
            tools: {
              rg: {
                path: "bin/rg.exe",
                version: "15.1.0",
                source: "https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/ripgrep-15.1.0-x86_64-pc-windows-msvc.zip",
                archiveSha256:
                  "124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a",
                binarySha256: sha256("windows-rg"),
                archivePath: "rg.exe",
              },
            },
          });
        }
        throw new Error("not found");
      },
      fileExists: (path) => normalizePath(path) === "C:/mock/tools-win32-x64/bin/rg.exe",
      readBinaryFile: () => Buffer.from("windows-rg"),
    });

    expect({
      ...resolved,
      path: normalizePath(resolved?.path),
      packageRoot: normalizePath(resolved?.packageRoot),
    }).toEqual({
      binary: "rg",
      path: "C:/mock/tools-win32-x64/bin/rg.exe",
      packageName: "@kilnai/tools-win32-x64",
      packageRoot: "C:/mock/tools-win32-x64",
      platform: "win32",
      arch: "x64",
      version: "15.1.0",
      archiveSha256:
        "124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a",
      binarySha256: sha256("windows-rg"),
    });
  });

  it("resolves a Unix executable without adding a file extension", () => {
    const resolved = resolveVendoredToolBinary("rg", {
      platform: "linux",
      arch: "x64",
      resolvePackageJson: (specifier) => {
        if (specifier === "@kilnai/tools-linux-x64/package.json") {
          return "/mock/tools-linux-x64/package.json";
        }
        throw new Error("not found");
      },
      readTextFile: (path) => {
        if (normalizePath(path) === "/mock/tools-linux-x64/tools.json") {
          return JSON.stringify({
            tools: {
              rg: {
                path: "bin/rg",
                version: "15.1.0",
                source: "https://example.test/rg.tar.gz",
                archiveSha256: "a".repeat(64),
                binarySha256: sha256("linux-rg"),
                archivePath: "rg",
              },
            },
          });
        }
        throw new Error("not found");
      },
      fileExists: (path) => normalizePath(path) === "/mock/tools-linux-x64/bin/rg",
      readBinaryFile: () => Buffer.from("linux-rg"),
    });

    expect(normalizePath(resolved?.path)).toBe("/mock/tools-linux-x64/bin/rg");
  });

  it("returns undefined when the platform package exists but the binary does not", () => {
    const resolved = resolveVendoredToolBinary("rg", {
      platform: "win32",
      arch: "x64",
      resolvePackageJson: () => "C:/mock/tools-win32-x64/package.json",
      readTextFile: () =>
        JSON.stringify({
          tools: {
            rg: {
              path: "bin/rg.exe",
              version: "15.1.0",
              source: "https://example.test/rg.zip",
              archiveSha256: "a".repeat(64),
              binarySha256: "b".repeat(64),
              archivePath: "rg.exe",
            },
          },
        }),
      fileExists: () => false,
    });

    expect(resolved).toBeUndefined();
  });

  it("returns undefined when the platform package has no manifest entry for the binary", () => {
    const resolved = resolveVendoredToolBinary("jq", {
      platform: "win32",
      arch: "x64",
      resolvePackageJson: () => "C:/mock/tools-win32-x64/package.json",
      readTextFile: () =>
        JSON.stringify({
          tools: {},
        }),
      fileExists: () => true,
    });

    expect(resolved).toBeUndefined();
  });

  it("does not resolve fd on darwin x64 because upstream does not publish that asset", () => {
    const resolved = resolveVendoredToolBinary("fd", {
      platform: "darwin",
      arch: "x64",
      resolvePackageJson: () => "/mock/tools-darwin-x64/package.json",
      readTextFile: () =>
        JSON.stringify({
          tools: {
            fd: {
              path: "bin/fd",
              version: "10.4.2",
              source: "https://example.test/fd.tar.gz",
              archiveSha256: "b".repeat(64),
              binarySha256: "b".repeat(64),
              archivePath: "fd",
            },
          },
        }),
      fileExists: () => true,
    });

    expect(resolved).toBeUndefined();
  });

  it("resolves jq from a declared platform manifest entry", () => {
    const resolved = resolveVendoredToolBinary("jq", {
      platform: "win32",
      arch: "x64",
      resolvePackageJson: () => "C:/mock/tools-win32-x64/package.json",
      readTextFile: () =>
        JSON.stringify({
          tools: {
            jq: {
              path: "bin/jq.exe",
              version: "1.8.2",
              source: "https://github.com/jqlang/jq/releases/download/jq-1.8.2/jq-windows-amd64.exe",
              archiveSha256:
                "a6fc67fedaf9128a3309a1e2ebb8b986aeccf70122ee46d2cb4849e423f0c627",
              binarySha256: sha256("windows-jq"),
            },
          },
        }),
      fileExists: (path) => normalizePath(path) === "C:/mock/tools-win32-x64/bin/jq.exe",
      readBinaryFile: () => Buffer.from("windows-jq"),
    });

    expect(normalizePath(resolved?.path)).toBe("C:/mock/tools-win32-x64/bin/jq.exe");
    expect(resolved?.version).toBe("1.8.2");
  });

  it("resolves Oxlint with separate archive and materialized binary digests", () => {
    const resolved = resolveVendoredToolBinary("oxlint", {
      platform: "linux",
      arch: "x64",
      resolvePackageJson: (specifier) => {
        if (specifier === "@kilnai/tools-linux-x64/package.json") {
          return "/mock/tools-linux-x64/package.json";
        }
        throw new Error("not found");
      },
      readTextFile: () =>
        JSON.stringify({
          tools: {
            oxlint: {
              path: "bin/oxlint",
              version: "1.80.0",
              source: "https://github.com/oxc-project/oxc/releases/download/apps_v1.80.0/oxlint-x86_64-unknown-linux-musl.tar.gz",
              archiveSha256: "a".repeat(64),
              binarySha256: sha256("oxlint"),
              archivePath: "oxlint-x86_64-unknown-linux-musl",
            },
          },
        }),
      fileExists: () => true,
      readBinaryFile: () => Buffer.from("oxlint"),
    });

    expect(resolved).toMatchObject({
      binary: "oxlint",
      version: "1.80.0",
      archiveSha256: "a".repeat(64),
      binarySha256: sha256("oxlint"),
    });
  });

  it("rejects a tampered materialized binary even when it exists", () => {
    const resolved = resolveVendoredToolBinary("oxlint", {
      platform: "win32",
      arch: "x64",
      resolvePackageJson: () => "C:/mock/tools-win32-x64/package.json",
      readTextFile: () =>
        JSON.stringify({
          tools: {
            oxlint: {
              path: "bin/oxlint.exe",
              version: "1.80.0",
              source: "https://example.test/oxlint.zip",
              archiveSha256: "a".repeat(64),
              binarySha256: sha256("original"),
              archivePath: "oxlint.exe",
            },
          },
        }),
      fileExists: () => true,
      readBinaryFile: () => Buffer.from("tampered"),
    });

    expect(resolved).toBeUndefined();
  });
});
