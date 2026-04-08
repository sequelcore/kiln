import { describe, expect, it } from "vitest";
import {
  getVendoredPackageCandidates,
  listVendoredPlatformPackages,
  resolveVendoredPlatformPackage,
} from "../src/index.js";

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
    expect(descriptors.every((descriptor) => descriptor.binaries.length === 3)).toBe(true);
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
