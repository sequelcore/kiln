import { captureSources } from "./snapshot.js";
import { TypeScriptReferenceAdapter } from "./reference-adapter.js";
import { ProjectCapture } from "./project-capture.js";

const args = process.argv.slice(2);
const configuredProject = args[0] === "--project" ? args[1] : undefined;
const [queryPath, lineText, columnText, ...sourcePaths] = configuredProject ? args.slice(2) : args;
if (
  !queryPath ||
  !lineText ||
  !columnText ||
  (!configuredProject && !sourcePaths.length) ||
  (configuredProject && sourcePaths.length)
) {
  throw new Error(
    "Usage: bun run research:references <query-path> <line> <column> <source-path> [...source-paths], or --project <tsconfig> <query-path> <line> <column>; positions are one-based",
  );
}
const snapshot = configuredProject
  ? new ProjectCapture(process.cwd(), configuredProject)
  : captureSources(process.cwd(), sourcePaths);
const adapter = new TypeScriptReferenceAdapter(snapshot);
try {
  const result = await adapter.query({
    operation: "references",
    workspaceRoot: snapshot.root,
    path: queryPath,
    position: { line: Number(lineText) - 1, character: Number(columnText) - 1 },
    limit: 1000,
  });
  console.log(
    JSON.stringify(
      {
        query: { path: queryPath, line: Number(lineText), column: Number(columnText) },
        sources: snapshot.sources.map(({ path, hash }) => ({ path, hash })),
        ...result,
      },
      null,
      2,
    ),
  );
  if (result.disposition !== "complete") process.exitCode = 1;
} finally {
  await adapter.close();
}
