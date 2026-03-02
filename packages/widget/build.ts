await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  naming: "widget.js",
  minify: true,
  target: "browser",
  format: "iife",
});
