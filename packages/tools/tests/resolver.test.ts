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
      ["rg", "fd", "jq"],
      ["rg", "fd", "jq"],
      ["rg", "jq"],
      ["rg", "fd", "jq"],
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

  it("returns known packages in fallback order when no exact match exists", () => {
    const candidates = getVendoredPackageCandidates({
      platform: "linux",
      arch: "arm64",
    });

    expect(candidates.map((candidate) => candidate.packageName)).toEqual([
      "@kilnai/tools-win32-x64",
      "@kilnai/tools-darwin-arm64",
      "@kilnai/tools-darwin-x64",
      "@kilnai/tools-linux-x64",
    ]);
  });
});

describe("resolveVendoredPlatformPackage", () => {
  it("resolves the first candidate whose package.json can be resolved", () => {
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
      binaries: ["rg", "fd", "jq"],
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
                sha256:
                  "124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a",
              },
            },
          });
        }
        throw new Error("not found");
      },
      fileExists: (path) => normalizePath(path) === "C:/mock/tools-win32-x64/bin/rg.exe",
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
      sha256: "124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a",
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
                sha256:
                  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              },
            },
          });
        }
        throw new Error("not found");
      },
      fileExists: (path) => normalizePath(path) === "/mock/tools-linux-x64/bin/rg",
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
              sha256:
                "124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a",
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
              sha256:
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
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
              sha256:
                "a6fc67fedaf9128a3309a1e2ebb8b986aeccf70122ee46d2cb4849e423f0c627",
            },
          },
        }),
      fileExists: (path) => normalizePath(path) === "C:/mock/tools-win32-x64/bin/jq.exe",
    });

    expect(normalizePath(resolved?.path)).toBe("C:/mock/tools-win32-x64/bin/jq.exe");
    expect(resolved?.version).toBe("1.8.2");
  });
});
