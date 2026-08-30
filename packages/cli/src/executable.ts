#!/usr/bin/env bun

import type { KilnAppConfig } from "./config.js";
import { createCli } from "./cli.js";

/**
 * The package executable is deliberately separate from the public module
 * facade.  Command composition is loaded only when the installed executable
 * is invoked; importing `@kilnai/cli` remains library-only.
 */
export async function runExecutable(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const config: KilnAppConfig = {
    createRegistry: () => {
      throw new Error("This CLI command does not admit filesystem domain-registry composition.");
    },
  };
  await createCli(config, argv, {
    composeRegistry: async () => {
      const { createFilesystemDomainRegistry } = await import("@kilnai/runtime");
      return () => createFilesystemDomainRegistry();
    },
  });
}

if (import.meta.main) {
  await runExecutable();
}
