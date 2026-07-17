import { rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });

async function bundle(
  entrypoint: string,
  format: "esm" | "iife",
  naming: string,
): Promise<void> {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir: "dist",
    naming,
    minify: true,
    target: "browser",
    format,
  });

  if (!result.success) {
    throw new AggregateError(result.logs, `Failed to build ${format} widget artifact`);
  }
}

await Promise.all([
  bundle("src/index.ts", "esm", "index.js"),
  bundle("src/browser.ts", "iife", "widget.iife.js"),
]);

const declarations = Bun.spawn(
  ["bunx", "tsc", "--project", "tsconfig.build.json"],
  { stdout: "inherit", stderr: "inherit" },
);

if (await declarations.exited !== 0) {
  throw new Error("Failed to build widget declarations");
}
