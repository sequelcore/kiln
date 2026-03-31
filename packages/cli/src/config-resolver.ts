import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export function getKilnDir(projectPath: string, dirName: string): string {
  const kilnDir = join(projectPath, dirName);
  if (!existsSync(kilnDir)) {
    mkdirSync(kilnDir, { recursive: true });
  }
  return kilnDir;
}

export function getKilnYamlPath(kilnDir: string): string {
  return join(kilnDir, "kiln.yaml");
}

export function getAppYamlPath(kilnDir: string): string {
  return join(kilnDir, "app.yaml");
}

export function getGatewayYamlPath(kilnDir: string): string {
  return join(kilnDir, "gateway.yaml");
}
