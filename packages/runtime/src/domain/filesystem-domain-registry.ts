import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type DomainDiscoveryPort,
  DomainRegistry,
  type DomainRegistryOptions,
  type DomainYamlSource,
} from "@kilnai/core/domain";

export type FilesystemDomainRegistryOptions = Omit<DomainRegistryOptions, "discovery">;

class NodeDomainDiscovery implements DomainDiscoveryPort {
  exists(projectPath: string, relativePath: string): boolean {
    return existsSync(join(projectPath, relativePath));
  }

  readYamlFiles(directory: string): readonly DomainYamlSource[] {
    if (!existsSync(directory)) return [];
    return readdirSync(directory)
      .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
      .flatMap((name) => {
        const filePath = join(directory, name);
        try {
          return [{ filePath, content: readFileSync(filePath, "utf8") }];
        } catch {
          return [];
        }
      });
  }
}

export function createFilesystemDomainRegistry(options: FilesystemDomainRegistryOptions = {}): DomainRegistry {
  return new DomainRegistry({ ...options, discovery: new NodeDomainDiscovery() });
}
