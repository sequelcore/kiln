import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DomainRegistry, type DomainDiscoveryPort } from "../../src/domain/domain-registry.js";
import { parseDomainYaml } from "../../src/domain/yaml-parser.js";
import type { DomainConfig } from "../../src/domain/index.js";

const PYTHON_YAML = `
name: python
displayName: Python
detectPatterns:
  - pyproject.toml
  - setup.py
  - requirements.txt
toolTags:
  - python
  - testing
  - linting
qualityGates:
  - name: lint
    command: "ruff check ."
    description: Lint Python source with ruff
    required: true
multishotExamples: ""
phaseExamples: ""
`;

const REACT_TS_YAML = `
name: react-ts
displayName: React / TypeScript
detectPatterns:
  - tsconfig.json
toolTags:
  - typescript
  - react
  - testing
  - linting
qualityGates:
  - name: types
    command: "tsc --noEmit"
    description: Type-check TypeScript
    required: true
multishotExamples: ""
phaseExamples: ""
`;

const JAVA_SPRING_YAML = `
name: java-spring
displayName: Java / Spring Boot
detectPatterns:
  - build.gradle
  - build.gradle.kts
  - pom.xml
toolTags:
  - java
  - spring
  - testing
qualityGates:
  - name: build
    command: "./gradlew build"
    description: Build with Gradle
    required: true
multishotExamples: ""
phaseExamples: ""
`;

const GO_YAML = `
name: go
displayName: Go
detectPatterns:
  - go.mod
  - go.sum
toolTags:
  - go
  - testing
qualityGates:
  - name: lint
    command: "go vet ./..."
    description: Lint Go source with go vet
    required: true
multishotExamples: ""
phaseExamples: ""
`;

const RUST_YAML = `
name: rust
displayName: Rust
detectPatterns:
  - Cargo.toml
  - Cargo.lock
toolTags:
  - rust
  - testing
qualityGates:
  - name: build
    command: cargo build
    description: Build Rust project
    required: true
multishotExamples: ""
phaseExamples: ""
`;

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
  readFileSync: vi.fn(() => { throw new Error("Unexpected readFileSync call"); }),
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReaddirSync = vi.mocked(readdirSync);

const PRIVATE_DOMAINS_DIR = "/private/project/domains";

const testDiscovery: DomainDiscoveryPort = {
  exists: (projectPath, relativePath) => existsSync(join(projectPath, relativePath)),
  readYamlFiles: (directory) => {
    if (!existsSync(directory)) return [];
    return readdirSync(directory).flatMap((entry) => {
      const name = String(entry);
      if (!name.endsWith(".yaml") && !name.endsWith(".yml")) return [];
      const filePath = join(directory, name);
      try {
        return [{ filePath, content: readFileSync(filePath, "utf8") }];
      } catch {
        return [];
      }
    });
  },
};

// Parse configs from YAML (no filesystem needed)
const builtinConfigs = [
  parseDomainYaml(PYTHON_YAML),
  parseDomainYaml(REACT_TS_YAML),
  parseDomainYaml(JAVA_SPRING_YAML),
  parseDomainYaml(GO_YAML),
];

describe("DomainRegistry", () => {
  let registry: DomainRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new DomainRegistry({ builtinConfigs, discovery: testDiscovery });
  });

  describe("constructor", () => {
    it("starts empty when no options provided", () => {
      const empty = new DomainRegistry();
      expect(empty.all()).toHaveLength(0);
    });

    it("accepts builtin configs via options", () => {
      expect(registry.all()).toHaveLength(4);
    });
  });

  describe("detect", () => {
    it("returns Python config when pyproject.toml exists", () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("pyproject.toml"),
      );

      const result = registry.detect("/project");
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("python");
    });

    it("returns React/TS config when tsconfig.json exists", () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("tsconfig.json"),
      );

      const result = registry.detect("/project");
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("react-ts");
    });

    it("returns Java config when build.gradle exists", () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("build.gradle"),
      );

      const result = registry.detect("/project");
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("java-spring");
    });

    it("returns Go config when go.mod exists", () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("go.mod"),
      );

      const result = registry.detect("/project");
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("go");
    });

    it("returns empty array for unknown project", () => {
      mockExistsSync.mockReturnValue(false);

      const result = registry.detect("/project");
      expect(result).toHaveLength(0);
    });

    it("returns multiple configs for hybrid project", () => {
      mockExistsSync.mockImplementation((p) => {
        const path = String(p);
        return path.endsWith("pyproject.toml") || path.endsWith("tsconfig.json");
      });

      const result = registry.detect("/project");
      expect(result).toHaveLength(2);

      const names = result.map((c) => c.name);
      expect(names).toContain("python");
      expect(names).toContain("react-ts");
    });
  });

  describe("detectAndMerge", () => {
    it("merges hybrid configs", () => {
      mockExistsSync.mockImplementation((p) => {
        const path = String(p);
        return path.endsWith("pyproject.toml") || path.endsWith("tsconfig.json");
      });

      const result = registry.detectAndMerge("/project");
      expect(result.name).toBe("python+react-ts");
      expect(result.displayName).toBe("Python + React / TypeScript");
      expect(result.toolTags.has("python")).toBe(true);
      expect(result.toolTags.has("typescript")).toBe(true);
      expect(result.toolTags.has("react")).toBe(true);
    });

    it("returns generic fallback for unknown project", () => {
      mockExistsSync.mockReturnValue(false);

      const result = registry.detectAndMerge("/project");
      expect(result.name).toBe("generic");
      expect(result.displayName).toBe("Generic");
      expect(result.qualityGates).toHaveLength(0);
      expect(result.toolTags.size).toBe(0);
    });
  });

  describe("register", () => {
    it("adds custom config", () => {
      const custom: DomainConfig = {
        name: "rust",
        displayName: "Rust",
        detectPatterns: ["Cargo.toml"],
        toolTags: new Set(["rust", "testing"]),
        qualityGates: [
          { name: "build", command: "cargo build", description: "Build with Cargo", required: true },
        ],
        multishotExamples: "",
        phaseExamples: "",
      };

      registry.register(custom);

      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("Cargo.toml"),
      );

      const detected = registry.detect("/project");
      expect(detected).toHaveLength(1);
      expect(detected[0]!.name).toBe("rust");
    });
  });

  describe("get", () => {
    it("retrieves config by name", () => {
      const python = registry.get("python");
      expect(python).toBeDefined();
      expect(python!.displayName).toBe("Python");
    });

    it("returns undefined for unknown name", () => {
      expect(registry.get("unknown")).toBeUndefined();
    });
  });

  describe("all", () => {
    it("returns all 4 built-in configs", () => {
      const all = registry.all();
      expect(all).toHaveLength(4);

      const names = all.map((c) => c.name);
      expect(names).toContain("python");
      expect(names).toContain("react-ts");
      expect(names).toContain("java-spring");
      expect(names).toContain("go");
    });
  });

  describe("loadInstalledDomains", () => {
    it("returns 0 when domains directory does not exist", () => {
      mockExistsSync.mockReturnValue(false);

      const loaded = registry.loadInstalledDomains(PRIVATE_DOMAINS_DIR);
      expect(loaded).toBe(0);
      expect(registry.all()).toHaveLength(4);
    });

    it("returns 0 when domains directory is empty", () => {
      mockExistsSync.mockImplementation((p) => {
        return String(p).includes(PRIVATE_DOMAINS_DIR);
      });
      mockReaddirSync.mockReturnValue([] as any);

      const loaded = registry.loadInstalledDomains(PRIVATE_DOMAINS_DIR);
      expect(loaded).toBe(0);
    });

    it("loads installed domain YAML files", () => {
      mockExistsSync.mockImplementation((p) => {
        return String(p).includes(PRIVATE_DOMAINS_DIR);
      });
      mockReaddirSync.mockReturnValue(["rust.yaml"] as any);
      vi.mocked(readFileSync).mockImplementation((filePath: unknown) => {
        const p = String(filePath);
        if (p.endsWith("rust.yaml")) return RUST_YAML;
        throw new Error(`Unexpected readFileSync call: ${filePath}`);
      });

      const loaded = registry.loadInstalledDomains(PRIVATE_DOMAINS_DIR);
      expect(loaded).toBe(1);
      expect(registry.all()).toHaveLength(5);
      expect(registry.get("rust")).toBeDefined();
      expect(registry.get("rust")!.displayName).toBe("Rust");
    });

    it("does not override existing configs with same name", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(["python.yaml"] as any);
      vi.mocked(readFileSync).mockImplementation((filePath: unknown) => {
        const p = String(filePath);
        if (p.endsWith("python.yaml")) return PYTHON_YAML;
        throw new Error(`Unexpected readFileSync call: ${filePath}`);
      });

      const loaded = registry.loadInstalledDomains(PRIVATE_DOMAINS_DIR);
      expect(loaded).toBe(0);
      expect(registry.all()).toHaveLength(4);
    });

    it("skips invalid YAML files gracefully", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(["broken.yaml", "rust.yaml"] as any);
      vi.mocked(readFileSync).mockImplementation((filePath: unknown) => {
        const p = String(filePath);
        if (p.endsWith("broken.yaml")) return "not valid yaml: [";
        if (p.endsWith("rust.yaml")) return RUST_YAML;
        throw new Error(`Unexpected readFileSync call: ${filePath}`);
      });

      const loaded = registry.loadInstalledDomains(PRIVATE_DOMAINS_DIR);
      expect(loaded).toBe(1);
      expect(registry.get("rust")).toBeDefined();
    });

    it("installed domains participate in detect()", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(["rust.yaml"] as any);
      vi.mocked(readFileSync).mockImplementation((filePath: unknown) => {
        const p = String(filePath);
        if (p.endsWith("rust.yaml")) return RUST_YAML;
        throw new Error(`Unexpected readFileSync call: ${filePath}`);
      });

      registry.loadInstalledDomains(PRIVATE_DOMAINS_DIR);

      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("Cargo.toml"),
      );

      const detected = registry.detect("/project");
      expect(detected).toHaveLength(1);
      expect(detected[0]!.name).toBe("rust");
    });

    it("installed domains participate in detectAndMerge()", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(["rust.yaml"] as any);
      vi.mocked(readFileSync).mockImplementation((filePath: unknown) => {
        const p = String(filePath);
        if (p.endsWith("rust.yaml")) return RUST_YAML;
        throw new Error(`Unexpected readFileSync call: ${filePath}`);
      });

      registry.loadInstalledDomains(PRIVATE_DOMAINS_DIR);

      mockExistsSync.mockImplementation((p) => {
        const path = String(p);
        return path.endsWith("Cargo.toml") || path.endsWith("pyproject.toml");
      });

      const merged = registry.detectAndMerge("/project");
      expect(merged.name).toBe("python+rust");
      expect(merged.toolTags.has("python")).toBe(true);
      expect(merged.toolTags.has("rust")).toBe(true);
    });

    it("ignores non-yaml files", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(["readme.md", "config.json"] as any);

      const loaded = registry.loadInstalledDomains(PRIVATE_DOMAINS_DIR);
      expect(loaded).toBe(0);
    });

    it("uses configurable domains directory", () => {
      const customRegistry = new DomainRegistry({
        builtinConfigs,
        domainsDir: "/private/custom/domains",
        discovery: testDiscovery,
      });
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(["rust.yaml"] as any);
      vi.mocked(readFileSync).mockImplementation((filePath: unknown) => {
        const p = String(filePath);
        if (p.endsWith("rust.yaml")) return RUST_YAML;
        throw new Error(`Unexpected readFileSync call: ${filePath}`);
      });

      const loaded = customRegistry.loadInstalledDomains();
      expect(loaded).toBe(1);
      // Verify the custom path was used (existsSync called with custom path)
      expect(mockExistsSync).toHaveBeenCalledWith(
        expect.stringContaining("custom"),
      );
    });
  });
});
