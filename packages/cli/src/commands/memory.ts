import {
  createDefaultBuiltinToolSurface,
  type DefaultBuiltinToolRegistryOptions,
} from "@kilnai/core";
import type { KilnAppConfig } from "../config.js";
import { loadConfiguredWebToolSurfaceOptions } from "../config/web-tools-config.js";

const MEMORY_RESOURCE_PREFIX = "kiln://memory/";

export async function memoryCommand(
  appConfig: KilnAppConfig,
  subcommand: string,
  args: string[],
  projectPath?: string,
): Promise<void> {
  const root = projectPath ?? process.cwd();

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printMemoryHelp();
    return;
  }

  const options = await loadConfiguredWebToolSurfaceOptions(appConfig, root);
  const surface = createDefaultBuiltinToolSurface(options);
  try {
    switch (subcommand) {
      case "graph":
        await printMemoryResource(surface.resources, buildGraphUri(args));
        return;
      case "node":
        await printMemoryResource(surface.resources, buildNodeUri(args));
        return;
      case "neighbors":
        await printMemoryResource(surface.resources, buildNeighborsUri(args));
        return;
      case "provenance":
        await printMemoryResource(surface.resources, buildProvenanceUri(args));
        return;
      case "relation":
        await printMemoryResource(surface.resources, buildRelationUri(args));
        return;
      case "admissions":
        await printMemoryResource(surface.resources, buildAdmissionsUri(args));
        return;
      case "templates":
        console.log(JSON.stringify(
          surface.resources
            .listTemplates()
            .filter((template) => template.uriTemplate.startsWith(MEMORY_RESOURCE_PREFIX)),
          null,
          2,
        ));
        return;
      default:
        throw new Error(`Unknown memory subcommand: ${subcommand}`);
    }
  } finally {
    closeMemoryResources(options);
  }
}

function printMemoryHelp(): void {
  console.log(`
Usage: kiln memory <subcommand>

Subcommands:
  graph             Read a bounded Memory Lattice graph
  node <id>         Read one memory node with revisions, relations, and admissions
  neighbors <id>    Read a bounded graph centered on one memory node
  provenance <id>   Read provenance, revisions, and admissions for one memory node
  relation <id>     Read one memory relation
  admissions        Read bounded context-admission evidence
  templates         List Memory Lattice resource URI templates

Options:
  --scope <kind:id>       Filter by scope, for example project:kiln
  --scope-kind <kind>     Filter by scope kind
  --scope-id <id>         Filter by scope id
  --layer <layer>         Filter graph by memory layer
  --query <text>          Search graph records
  --depth <n>             Graph traversal depth
  --limit <n>             Maximum records or admissions
  --session-id <id>       Filter admissions by session
  --record-id <id>        Filter admissions by memory record
`);
}

async function printMemoryResource(
  resources: ReturnType<typeof createDefaultBuiltinToolSurface>["resources"],
  uri: string,
): Promise<void> {
  const result = await resources.read(uri);
  if (result.contents.length === 1 && "text" in result.contents[0]! && typeof result.contents[0]!.text === "string") {
    console.log(result.contents[0]!.text);
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

function buildGraphUri(args: readonly string[]): string {
  assertSupportedArgs(args, ["--scope", "--scope-kind", "--scope-id", "--layer", "--query", "--depth", "--limit"], 0);
  return withQuery("kiln://memory/graph", collectQuery(args, [
    ["--scope", "scope"],
    ["--scope-kind", "scopeKind"],
    ["--scope-id", "scopeId"],
    ["--layer", "layer"],
    ["--query", "query"],
    ["--depth", "depth"],
    ["--limit", "limit"],
  ]));
}

function buildNodeUri(args: readonly string[]): string {
  assertSupportedArgs(args, ["--scope", "--scope-kind", "--scope-id"], 1);
  const id = requirePositional(args, "node id");
  return withQuery(`kiln://memory/nodes/${encodePathSegment(id)}`, collectScopeQuery(args));
}

function buildNeighborsUri(args: readonly string[]): string {
  assertSupportedArgs(args, ["--scope", "--scope-kind", "--scope-id", "--depth", "--limit"], 1);
  const id = requirePositional(args, "node id");
  return withQuery(`kiln://memory/nodes/${encodePathSegment(id)}/neighbors`, collectQuery(args, [
    ["--scope", "scope"],
    ["--scope-kind", "scopeKind"],
    ["--scope-id", "scopeId"],
    ["--depth", "depth"],
    ["--limit", "limit"],
  ]));
}

function buildProvenanceUri(args: readonly string[]): string {
  assertSupportedArgs(args, ["--scope", "--scope-kind", "--scope-id"], 1);
  const id = requirePositional(args, "node id");
  return withQuery(`kiln://memory/nodes/${encodePathSegment(id)}/provenance`, collectScopeQuery(args));
}

function buildRelationUri(args: readonly string[]): string {
  assertSupportedArgs(args, ["--scope", "--scope-kind", "--scope-id"], 1);
  const id = requirePositional(args, "relation id");
  return withQuery(`kiln://memory/relations/${encodePathSegment(id)}`, collectScopeQuery(args));
}

function buildAdmissionsUri(args: readonly string[]): string {
  assertSupportedArgs(args, ["--session-id", "--record-id", "--limit"], 0);
  return withQuery("kiln://memory/admissions", collectQuery(args, [
    ["--session-id", "sessionId"],
    ["--record-id", "recordId"],
    ["--limit", "limit"],
  ]));
}

function collectScopeQuery(args: readonly string[]): URLSearchParams {
  return collectQuery(args, [
    ["--scope", "scope"],
    ["--scope-kind", "scopeKind"],
    ["--scope-id", "scopeId"],
  ]);
}

function collectQuery(
  args: readonly string[],
  flags: readonly (readonly [flag: string, key: string])[],
): URLSearchParams {
  const query = new URLSearchParams();
  for (const [flag, key] of flags) {
    const value = readFlag(args, flag);
    if (value !== undefined) {
      query.set(key, value);
    }
  }
  return query;
}

function readFlag(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function requirePositional(args: readonly string[], label: string): string {
  const value = firstPositional(args);
  if (!value) {
    throw new Error(`Memory ${label} is required`);
  }
  return value;
}

function assertSupportedArgs(
  args: readonly string[],
  flags: readonly string[],
  positionalCount: number,
): void {
  let positionals = 0;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!arg.startsWith("--")) {
      positionals += 1;
      continue;
    }
    if (!flags.includes(arg)) {
      throw new Error(`Unsupported memory option: ${arg}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${arg} requires a value`);
    }
    index += 1;
  }
  if (positionals > positionalCount) {
    throw new Error("Too many memory arguments");
  }
}

function firstPositional(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!arg.startsWith("--")) {
      return arg;
    }
    index += 1;
  }
  return undefined;
}

function withQuery(baseUri: string, query: URLSearchParams): string {
  const suffix = query.toString();
  return suffix ? `${baseUri}?${suffix}` : baseUri;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function closeMemoryResources(options: DefaultBuiltinToolRegistryOptions): void {
  options.memoryResources?.repository.close();
}
