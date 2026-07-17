import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const generatedPaths = ["dist", "tsconfig.tsbuildinfo"] as const;

export async function cleanTypescriptOutput(
  packageRoot = process.cwd(),
): Promise<void> {
  const root = resolve(packageRoot);
  await Promise.all(
    generatedPaths.map((path) =>
      rm(resolve(root, path), { recursive: true, force: true })
    ),
  );
}

if (import.meta.main) {
  await cleanTypescriptOutput();
}
