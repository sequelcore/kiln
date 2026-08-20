import { describe, expect, it } from "vitest";
import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { parseDocument } from "yaml";

const authority = Type.Object({
  sandbox: Type.Union([
    Type.Literal("read-only"),
    Type.Literal("workspace-write"),
    Type.Literal("danger-full-access"),
  ], { description: "Maximum filesystem effect admitted for the layer." }),
}, { additionalProperties: false });

const agentPolicy = Type.Object({
  tools: Type.Array(Type.String()),
}, { additionalProperties: false });

const projectSchema = Type.Object({
  version: Type.Literal(1, { description: "Breaking project schema generation." }),
  domain: Type.String({ minLength: 1 }),
  permissions: Type.Optional(authority),
  profiles: Type.Record(Type.String({ minLength: 1 }), agentPolicy),
  agents: Type.Array(Type.Union([
    Type.Object({ kind: Type.Literal("local"), name: Type.String() }, { additionalProperties: false }),
    Type.Object({
      kind: Type.Literal("managed"),
      name: Type.String(),
      policy: agentPolicy,
    }, { additionalProperties: false }),
  ])),
  permissionCeiling: Type.Optional(Type.Object({
    sandbox: Type.Union([
      Type.Literal("read-only"),
      Type.Literal("workspace-write"),
      Type.Literal("danger-full-access"),
    ]),
  }, {
    additionalProperties: false,
    description: "Known globally-owned field; project semantic admission rejects it.",
    "x-kiln-owner": "global-configuration",
    "x-kiln-project-admission": "forbidden",
  })),
}, {
  $id: "https://kiln.local/schema/project-config-spike-v1.json",
  additionalProperties: false,
});

type ProjectSchemaSpike = Static<typeof projectSchema>;

const fixture = `# operator comment
version: 1
domain: "support"
profiles:
  base: &base-policy
    tools: [read, grep] # keep inline
agents:
  - kind: managed
    name: 'scout'
    policy: *base-policy
permissions:
  sandbox: 'workspace-write'
  escape: true
permissionCeiling:
  sandbox: read-only
mystery: rejected
`;

interface Diagnostic {
  readonly path: string;
  readonly code: "global-only" | "authority-broadening";
}

function admitSemantics(
  project: ProjectSchemaSpike,
  globalSandbox: "read-only" | "workspace-write" | "danger-full-access",
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (project.permissionCeiling !== undefined) {
    diagnostics.push({ path: "/permissionCeiling", code: "global-only" });
  }
  const rank = { "read-only": 0, "workspace-write": 1, "danger-full-access": 2 } as const;
  if (project.permissions && rank[project.permissions.sandbox] > rank[globalSandbox]) {
    diagnostics.push({ path: "/permissions/sandbox", code: "authority-broadening" });
  }
  return diagnostics;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value), null, 2) + "\n";
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, member]) => [key, sortJson(member)]),
  );
}

function descriptor(schema: TSchema): readonly Record<string, unknown>[] {
  const properties = schema.properties as Record<string, TSchema>;
  return Object.entries(properties).map(([identity, member]) => ({
    identity,
    description: member.description,
    owner: member["x-kiln-owner"] ?? "project-configuration",
    projectAdmission: member["x-kiln-project-admission"] ?? "supported",
  }));
}

describe("Roadmap 12 project schema fidelity spike", () => {
  it("uses one schema for runtime admission, inferred types, editor schema, and descriptors", () => {
    const parsed = parseDocument(fixture).toJS() as unknown;
    const structural = [...Value.Errors(projectSchema, parsed)];

    expect(structural.map((error) => error.path)).toEqual([
      "/mystery",
      "/permissions/escape",
    ]);

    const clean = parseDocument(fixture).toJS() as Record<string, unknown>;
    delete (clean.permissions as Record<string, unknown>).escape;
    delete clean.mystery;
    expect(Value.Check(projectSchema, clean)).toBe(true);
    expect(admitSemantics(clean as ProjectSchemaSpike, "read-only")).toEqual([
      { path: "/permissionCeiling", code: "global-only" },
      { path: "/permissions/sandbox", code: "authority-broadening" },
    ]);

    expect(canonicalJson({ schema: projectSchema, revision: 1 })).toBe(
      canonicalJson({ revision: 1, schema: projectSchema }),
    );
    expect(descriptor(projectSchema)).toContainEqual({
      identity: "permissionCeiling",
      description: "Known globally-owned field; project semantic admission rejects it.",
      owner: "global-configuration",
      projectAdmission: "forbidden",
    });
  });

  it("mutates the YAML document AST without erasing unrelated syntax", () => {
    const document = parseDocument(fixture);
    document.setIn(["permissions", "sandbox"], "read-only");
    const output = String(document);

    expect(output).toContain("# operator comment");
    expect(output).toContain("domain: \"support\"");
    expect(output).toContain("base: &base-policy");
    expect(output).toContain("policy: *base-policy");
    expect(output).toContain("tools: [ read, grep ] # keep inline");
    expect(output.indexOf("profiles:")).toBeLessThan(output.indexOf("agents:"));
    expect(output).toContain("sandbox: read-only");
  });
});
