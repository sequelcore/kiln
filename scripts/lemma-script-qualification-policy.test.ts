import { describe, expect, it } from "vitest";
import { evaluateLemmaScriptQualificationPolicy } from "./lemma-script-qualification-policy.js";

const SOURCE = `
type Role = "admin" | "reader";
export function isAllowed(role: Role): boolean {
  return role === "admin";
}
`;

const GENERATED_DAFNY = `
function isAllowed(role: string): bool
{
  return role == "admin";
}
`;

const SYNTHETIC_ENSURES = [{ kind: "bool", value: true, ty: { kind: "bool" } }];

const TYPED_INFO = {
  schema: 1,
  lemmascript: "0.6.0",
  file: "fixture.ts",
  backendDirective: null,
  typeDecls: [{ name: "Role", kind: "string-union", values: ["admin", "reader"] }],
  externs: [],
  constants: [],
  functions: [
    {
      name: "isAllowed",
      exported: true,
      typeParams: [],
      params: [
        {
          name: "role",
          tsType: "Role",
          ty: { kind: "user", name: "Role" },
        },
      ],
      returnTy: { kind: "bool" },
      requires: [],
      ensures: SYNTHETIC_ENSURES,
      decreases: null,
      contract: [],
      isPure: true,
      forcePure: false,
      autohavoc: false,
      bodyKinds: ["return", "binop", "var", "str"],
    },
  ],
  classes: [],
  dafny: {},
} as const;

const BASE_INPUT = {
  typedInfo: TYPED_INFO,
  sourceText: SOURCE,
  generatedDafny: GENERATED_DAFNY,
  expectedLemmaScriptVersion: "0.6.0",
  requiredFunctionNames: ["isAllowed"],
} as const;

function inputWithTypedInfo(overrides: Record<string, unknown>) {
  return {
    ...BASE_INPUT,
    typedInfo: { ...TYPED_INFO, ...overrides },
  };
}

describe("LemmaScript qualification policy", () => {
  it("marks a pure boolean/string-union fixture eligible", () => {
    const result = evaluateLemmaScriptQualificationPolicy(BASE_INPUT);

    expect(result.status).toBe("eligible");
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["schema mismatch", inputWithTypedInfo({ schema: 2 })],
    ["version mismatch", inputWithTypedInfo({ lemmascript: "0.5.0" })],
    ["unsupported backend", inputWithTypedInfo({ backendDirective: "lean" })],
    ["Dafny error", inputWithTypedInfo({ dafny: { error: "emission failed" } })],
    ["nonempty externs", inputWithTypedInfo({ externs: [{ qualified: "external" }] })],
    ["missing required function", { ...BASE_INPUT, requiredFunctionNames: ["missing"] }],
    [
      "impure required function",
      inputWithTypedInfo({
        functions: [{ ...TYPED_INFO.functions[0], isPure: false }],
      }),
    ],
    [
      "forcePure required function",
      inputWithTypedInfo({
        functions: [{ ...TYPED_INFO.functions[0], forcePure: true }],
      }),
    ],
    [
      "autohavoc required function",
      inputWithTypedInfo({
        functions: [{ ...TYPED_INFO.functions[0], autohavoc: true }],
      }),
    ],
    [
      "unsupported body kind",
      inputWithTypedInfo({
        functions: [{ ...TYPED_INFO.functions[0], bodyKinds: ["while"] }],
      }),
    ],
    [
      "numeric target type",
      inputWithTypedInfo({
        functions: [{ ...TYPED_INFO.functions[0], returnTy: { kind: "int" } }],
      }),
    ],
  ])("blocks %s", (_label, input) => {
    expect(evaluateLemmaScriptQualificationPolicy(input).status).toBe("blocked");
  });

  it("blocks a required function without a contract", () => {
    const result = evaluateLemmaScriptQualificationPolicy(
      inputWithTypedInfo({
        functions: [{ ...TYPED_INFO.functions[0], ensures: [] }],
      }),
    );

    expect(result.status).toBe("blocked");
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "missing-contract", functionName: "isAllowed" })]),
    );
  });

  it("blocks a function without an ensures array", () => {
    const result = evaluateLemmaScriptQualificationPolicy(
      inputWithTypedInfo({
        functions: [{ ...TYPED_INFO.functions[0], ensures: undefined }],
      }),
    );

    expect(result.status).toBe("blocked");
  });

  it.each([
    ["null", null],
    ["empty string", ""],
    ["arbitrary string", "result is true"],
    ["empty object", {}],
    ["missing kind", { value: true }],
    ["empty kind", { kind: "" }],
    ["unknown kind", { kind: "unknown" }],
  ] as const)("blocks malformed ensures %s", (_label, ensure) => {
    const result = evaluateLemmaScriptQualificationPolicy(
      inputWithTypedInfo({
        functions: [{ ...TYPED_INFO.functions[0], ensures: [ensure] }],
      }),
    );

    expect(result.status).toBe("blocked");
  });

  it.each([
    ["impure", { isPure: false }],
    ["forcePure", { forcePure: true }],
    ["autohavoc", { autohavoc: true }],
    ["unsupported body kind", { bodyKinds: ["while"] }],
  ] as const)("applies strict function checks to non-target %s functions", (_label, flags) => {
    const helper = { ...TYPED_INFO.functions[0], name: "helper", ...flags };
    const result = evaluateLemmaScriptQualificationPolicy(
      inputWithTypedInfo({ functions: [TYPED_INFO.functions[0], helper] }),
    );

    expect(result.status).toBe("blocked");
  });

  it.each(["assume", "extern", "havoc", "autohavoc", "skip", "verify"])(
    "blocks source //@ %s directives",
    (directive) => {
      const result = evaluateLemmaScriptQualificationPolicy({
        ...BASE_INPUT,
        sourceText: `${SOURCE}\n//@ ${directive}\n`,
      });

      expect(result.status).toBe("blocked");
    },
  );

  it.each([
    ["assume", "assume true;"],
    ["expect", "expect true;"],
    ["axiom", "function {:axiom} trusted(x: string): bool;"],
    ["extern", "function {:extern} trusted(x: string): bool { return true; }"],
    ["include", 'include "trusted.dfy"'],
    ["block-comment-open", "/*"],
    ["block-comment-close", "*/"],
    ["verbatim-string", 'var text := @"trusted";'],
    ["verify false", "function {:verify false} trusted(x: string): bool { return true; }"],
    ["only", "{:only}"],
    ["selective checking", "{:selective_checking}"],
    ["assumption", "{:assumption}"],
    ["assume concurrent", "{:assume_concurrent}"],
    ["contradiction", "{:contradiction}"],
    ["options", "{:options}"],
    ["at axiom", "@Axiom"],
    ["at verify false", "@Verify(false)"],
    ["at verify only", "@VerifyOnly"],
    ["at options", "@Options(1)"],
    ["autoReq", "function {:autoReq} trusted(x: string): bool { return true; }"],
    ["autocontracts", "function {:autocontracts} trusted(x: string): bool { return true; }"],
    ["AutoRequires", "@AutoRequires"],
    ["AutoContracts", "@AutoContracts"],
    ["decreases wildcard", "decreases *"],
    ["weakening requires", "requires false"],
    ["weakening reads", "reads this"],
    ["weakening modifies", "modifies this"],
    ["bodyless trusted declaration", "function trusted(x: string): bool"],
    ["multiline verify false", "function {:verify\n false} trusted(x: string): bool { return true; }"],
    ["multiline decreases wildcard", "function trusted(x: string): bool { decreases\n *; return true; }"],
    ["same-line weakening requires", "function trusted(x: string): bool { requires false; return true; }"],
    ["same-line weakening reads", "function trusted(x: string): bool { reads this; return true; }"],
    ["same-line weakening modifies", "function trusted(x: string): bool { modifies this; return true; }"],
    ["multiline weakening clause", "function trusted(x: string): bool { reads\n this; return true; }"],
  ])("blocks generated Dafny %s patterns", (_label, fragment) => {
    const result = evaluateLemmaScriptQualificationPolicy({
      ...BASE_INPUT,
      generatedDafny: `${GENERATED_DAFNY}\n${fragment}\n`,
    });

    expect(result.status).toBe("blocked");
  });

  it("does not hide a banned token after a // inside a quoted string", () => {
    const result = evaluateLemmaScriptQualificationPolicy({
      ...BASE_INPUT,
      generatedDafny: `${GENERATED_DAFNY}\nvar s := "x//"; assume false;\n`,
    });

    expect(result.status).toBe("blocked");
  });

  it.each([
    [
      "open inline string",
      inputWithTypedInfo({
        functions: [
          {
            ...TYPED_INFO.functions[0],
            params: [{ ...TYPED_INFO.functions[0].params[0], ty: { kind: "string" } }],
          },
        ],
      }),
    ],
    [
      "empty inline string set",
      inputWithTypedInfo({
        functions: [
          {
            ...TYPED_INFO.functions[0],
            params: [
              {
                ...TYPED_INFO.functions[0].params[0],
                ty: { kind: "string", values: [] },
              },
            ],
          },
        ],
      }),
    ],
    [
      "open declared string union",
      inputWithTypedInfo({
        typeDecls: [{ name: "Role", kind: "string-union" }],
      }),
    ],
    [
      "empty declared string union",
      inputWithTypedInfo({
        typeDecls: [{ name: "Role", kind: "string-union", values: [] }],
      }),
    ],
  ])("blocks %s", (_label, input) => {
    expect(evaluateLemmaScriptQualificationPolicy(input).status).toBe("blocked");
  });

  it.each([
    [
      "numeric constant",
      inputWithTypedInfo({
        constants: [{ name: "limit", ty: { kind: "int" } }],
      }),
    ],
    [
      "numeric type declaration",
      inputWithTypedInfo({
        typeDecls: [
          ...TYPED_INFO.typeDecls,
          { name: "Count", kind: "alias", aliasOf: "nat", aliasOfTy: { kind: "nat" } },
        ],
      }),
    ],
    [
      "numeric non-target function",
      inputWithTypedInfo({
        functions: [
          TYPED_INFO.functions[0],
          { ...TYPED_INFO.functions[0], name: "helper", returnTy: { kind: "real" } },
        ],
      }),
    ],
    [
      "numeric tsType contradicts typed kind",
      inputWithTypedInfo({
        functions: [
          {
            ...TYPED_INFO.functions[0],
            params: [{ ...TYPED_INFO.functions[0].params[0], tsType: "number", ty: { kind: "bool" } }],
          },
        ],
      }),
    ],
    [
      "bigint tsType contradicts typed kind",
      inputWithTypedInfo({
        functions: [
          {
            ...TYPED_INFO.functions[0],
            params: [{ ...TYPED_INFO.functions[0].params[0], tsType: "bigint", ty: { kind: "bool" } }],
          },
        ],
      }),
    ],
  ])("blocks %s anywhere in typedInfo", (_label, input) => {
    expect(evaluateLemmaScriptQualificationPolicy(input).status).toBe("blocked");
  });

  it("rejects non-empty classes and malformed typed info", () => {
    const classInfo = {
      ...TYPED_INFO,
      classes: [
        {
          name: "Gate",
          fields: [],
          methods: [{ ...TYPED_INFO.functions[0], name: "allows" }],
        },
      ],
    };

    expect(
      evaluateLemmaScriptQualificationPolicy({
        ...BASE_INPUT,
        typedInfo: classInfo,
      }).status,
    ).toBe("blocked");

    expect(
      evaluateLemmaScriptQualificationPolicy({
        ...BASE_INPUT,
        typedInfo: classInfo,
      }).diagnostics,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: "classes-present" })]));

    expect(
      evaluateLemmaScriptQualificationPolicy({
        ...BASE_INPUT,
        typedInfo: null,
      }).status,
    ).toBe("blocked");
  });

  it("returns facts-only discriminated results", () => {
    const result = evaluateLemmaScriptQualificationPolicy(BASE_INPUT);

    expect(result).not.toHaveProperty("accepted");
    expect(["eligible", "blocked"]).toContain(result.status);
  });
});
