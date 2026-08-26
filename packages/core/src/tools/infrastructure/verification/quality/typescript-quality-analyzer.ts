import * as ts from "@typescript/typescript6";
import {
  COMPLEXITY_PROFILE,
  COMPLEXITY_PROFILE_REVISION,
  COMPLEXITY_RULES,
  QUALITY_PROFILE_ORDER,
  type QualityAnalysisDiagnostic,
  type QualityAnalysisProfileObservation,
  type QualityProfileName,
  TEST_INTEGRITY_PROFILE,
  TEST_INTEGRITY_PROFILE_REVISION,
  TEST_INTEGRITY_RULES,
  TYPE_INTEGRITY_PROFILE,
  TYPE_INTEGRITY_PROFILE_REVISION,
  TYPE_INTEGRITY_RULES,
} from "../../../../verification/static/quality-observation.js";

export const TYPESCRIPT_QUALITY_PARSER_VERSION = ts.version;
export const HIGH_CYCLOMATIC_COMPLEXITY_THRESHOLD = 20;

export interface TypeScriptQualityAnalysis {
  readonly parserVersion: string;
  readonly profiles: readonly QualityAnalysisProfileObservation[];
}

export function analyzeTypeScriptQuality(
  fileName: string,
  sourceText: string,
  requestedProfiles: readonly QualityProfileName[],
): TypeScriptQualityAnalysis {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, scriptKind(fileName));
  const parseDiagnostics =
    (sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (parseDiagnostics.length > 0) {
    const first = parseDiagnostics[0]!;
    throw new Error(`TypeScript parse failed: ${ts.flattenDiagnosticMessageText(first.messageText, " ")}`);
  }
  const profiles = canonicalProfiles(requestedProfiles).map((profile): QualityAnalysisProfileObservation => {
    if (profile === TYPE_INTEGRITY_PROFILE) {
      return {
        name: TYPE_INTEGRITY_PROFILE,
        revision: TYPE_INTEGRITY_PROFILE_REVISION,
        rules: TYPE_INTEGRITY_RULES,
        diagnostics: analyzeTypeIntegrity(sourceFile),
      };
    }
    if (profile === COMPLEXITY_PROFILE) {
      return {
        name: COMPLEXITY_PROFILE,
        revision: COMPLEXITY_PROFILE_REVISION,
        rules: COMPLEXITY_RULES,
        diagnostics: analyzeComplexity(sourceFile),
      };
    }
    return {
      name: TEST_INTEGRITY_PROFILE,
      revision: TEST_INTEGRITY_PROFILE_REVISION,
      rules: TEST_INTEGRITY_RULES,
      diagnostics: analyzeTestIntegrity(sourceFile),
    };
  });
  return { parserVersion: ts.version, profiles };
}

function analyzeTypeIntegrity(sourceFile: ts.SourceFile): readonly QualityAnalysisDiagnostic[] {
  const diagnostics: QualityAnalysisDiagnostic[] = [];
  const visit = (node: ts.Node): void => {
    if (isAssertion(node)) {
      const nested = nestedAssertion(node.expression);
      if (nested) {
        const widening =
          nested.type.kind === ts.SyntaxKind.UnknownKeyword || nested.type.kind === ts.SyntaxKind.AnyKeyword;
        diagnostics.push({
          rule: { name: widening ? "widen-then-assert" : "chained-type-assertion", revision: "v1" },
          message: widening
            ? `Avoid widening through ${nested.type.getText(sourceFile)} before asserting a narrower type.`
            : "Avoid chained type assertions; preserve or validate the value's type instead.",
          ...locationOf(sourceFile, node),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sortedDiagnostics(diagnostics);
}

function analyzeComplexity(sourceFile: ts.SourceFile): readonly QualityAnalysisDiagnostic[] {
  const diagnostics: QualityAnalysisDiagnostic[] = [];
  const visit = (node: ts.Node): void => {
    const body = complexityBody(node);
    if (body) {
      const measured = 1 + parameterDefaultCount(node) + decisionCount(body, node);
      if (measured > HIGH_CYCLOMATIC_COMPLEXITY_THRESHOLD) {
        diagnostics.push({
          rule: { name: "high-cyclomatic-complexity", revision: "v1" },
          message: `${functionName(node)} has cyclomatic complexity ${measured}; review whether its control flow can be simplified or decomposed (signal threshold ${HIGH_CYCLOMATIC_COMPLEXITY_THRESHOLD}).`,
          ...locationOf(sourceFile, functionLocationNode(node)),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sortedDiagnostics(diagnostics);
}

function decisionCount(root: ts.Node, owner: ts.Node): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (node !== owner && complexityBody(node)) return;
    if (isDecisionNode(node)) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(root);
  return count;
}

function isDecisionNode(node: ts.Node): boolean {
  if (
    ts.isIfStatement(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    ts.isCatchClause(node) ||
    ts.isConditionalExpression(node) ||
    ts.isCaseClause(node)
  ) {
    return true;
  }
  if (
    (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isCallExpression(node)) &&
    node.questionDotToken !== undefined
  ) {
    return true;
  }
  if (ts.isBindingElement(node) && node.initializer !== undefined) return true;
  if (!ts.isBinaryExpression(node)) return false;
  return [
    ts.SyntaxKind.AmpersandAmpersandToken,
    ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.QuestionQuestionToken,
    ts.SyntaxKind.AmpersandAmpersandEqualsToken,
    ts.SyntaxKind.BarBarEqualsToken,
    ts.SyntaxKind.QuestionQuestionEqualsToken,
  ].includes(node.operatorToken.kind);
}

function analyzeTestIntegrity(sourceFile: ts.SourceFile): readonly QualityAnalysisDiagnostic[] {
  const diagnostics: QualityAnalysisDiagnostic[] = [];
  const bindings = vitestBindings(sourceFile);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && !isIntermediateTestBuilderCall(node)) {
      const identity = testCallIdentity(node.expression, bindings);
      if (identity) {
        const options = testOptions(node);
        const focused = identity.modifiers.includes("only") || options.only;
        if (focused) {
          diagnostics.push({
            rule: { name: "focused-test", revision: "v1" },
            message:
              "Focused Vitest call excludes other collected tests; remove only before treating the suite as evidence.",
            ...locationOf(sourceFile, node.expression),
          });
        }
        const disabled =
          identity.modifiers.some((modifier) => ["skip", "todo", "skipIf", "runIf"].includes(modifier)) ||
          options.skip ||
          options.todo;
        if (identity.kind !== "describe" && !disabled) {
          const callback = [...node.arguments].reverse().find(isFunctionExpression);
          if (callback && ts.isBlock(callback.body) && callback.body.statements.length === 0) {
            diagnostics.push({
              rule: { name: "empty-test-body", revision: "v1" },
              message: "This Vitest test body is empty and can pass without observing behavior.",
              ...locationOf(sourceFile, callback.body),
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sortedDiagnostics(diagnostics);
}

function isIntermediateTestBuilderCall(node: ts.CallExpression): boolean {
  return ts.isCallExpression(node.parent) && node.parent.expression === node;
}

type VitestBinding = "test" | "it" | "describe";

function vitestBindings(sourceFile: ts.SourceFile): ReadonlyMap<string, VitestBinding> {
  const bindings = new Map<string, VitestBinding>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "vitest" ||
      !statement.importClause?.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    for (const element of statement.importClause.namedBindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (imported === "test" || imported === "it" || imported === "describe") {
        bindings.set(element.name.text, imported);
      }
    }
  }
  return bindings;
}

function testCallIdentity(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, VitestBinding>,
): { readonly kind: VitestBinding; readonly modifiers: readonly string[] } | undefined {
  if (ts.isParenthesizedExpression(expression)) return testCallIdentity(expression.expression, bindings);
  if (ts.isIdentifier(expression)) {
    const kind = bindings.get(expression.text);
    return kind ? { kind, modifiers: [] } : undefined;
  }
  if (ts.isCallExpression(expression)) return testCallIdentity(expression.expression, bindings);
  if (ts.isPropertyAccessExpression(expression)) {
    const identity = testCallIdentity(expression.expression, bindings);
    return identity ? { kind: identity.kind, modifiers: [...identity.modifiers, expression.name.text] } : undefined;
  }
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    ts.isStringLiteral(expression.argumentExpression)
  ) {
    const identity = testCallIdentity(expression.expression, bindings);
    return identity
      ? { kind: identity.kind, modifiers: [...identity.modifiers, expression.argumentExpression.text] }
      : undefined;
  }
  return undefined;
}

function testOptions(node: ts.CallExpression): {
  readonly only: boolean;
  readonly skip: boolean;
  readonly todo: boolean;
} {
  const first = node.arguments[0];
  const options = node.arguments[1];
  if (
    !first ||
    (!ts.isStringLiteralLike(first) && !isFunctionExpression(first)) ||
    !options ||
    !ts.isObjectLiteralExpression(options)
  ) {
    return { only: false, skip: false, todo: false };
  }
  const enabled = (name: "only" | "skip" | "todo"): boolean =>
    options.properties.some(
      (property) =>
        ts.isPropertyAssignment(property) &&
        propertyName(property.name) === name &&
        property.initializer.kind === ts.SyntaxKind.TrueKeyword,
    );
  return { only: enabled("only"), skip: enabled("skip"), todo: enabled("todo") };
}

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : undefined;
}

function isFunctionExpression(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

function complexityBody(node: ts.Node): ts.Node | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  ) {
    return node.body;
  }
  if (ts.isPropertyDeclaration(node)) return node.initializer;
  if (ts.isClassStaticBlockDeclaration(node)) return node.body;
  return undefined;
}

function parameterDefaultCount(node: ts.Node): number {
  if (
    !ts.isFunctionDeclaration(node) &&
    !ts.isFunctionExpression(node) &&
    !ts.isArrowFunction(node) &&
    !ts.isMethodDeclaration(node) &&
    !ts.isGetAccessorDeclaration(node) &&
    !ts.isSetAccessorDeclaration(node) &&
    !ts.isConstructorDeclaration(node)
  ) {
    return 0;
  }
  let count = 0;
  const visit = (candidate: ts.Node): void => {
    if ((ts.isParameter(candidate) || ts.isBindingElement(candidate)) && candidate.initializer !== undefined) {
      count += 1;
    }
    ts.forEachChild(candidate, visit);
  };
  for (const parameter of node.parameters) visit(parameter);
  return count;
}

function functionName(node: ts.Node): string {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)) &&
    node.name
  ) {
    return node.name.getText();
  }
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isPropertyDeclaration(node)) return `${node.name.getText()} field initializer`;
  if (ts.isClassStaticBlockDeclaration(node)) return "class static block";
  if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  return "<anonymous>";
}

function functionLocationNode(node: ts.Node): ts.Node {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)) &&
    node.name
  ) {
    return node.name;
  }
  if (ts.isPropertyDeclaration(node)) return node.name;
  return node;
}

function canonicalProfiles(requested: readonly QualityProfileName[]): readonly QualityProfileName[] {
  if (requested.length < 1 || new Set(requested).size !== requested.length) {
    throw new Error("TypeScript quality analysis requires at least one unique profile");
  }
  const unsupported = requested.find((profile) => !QUALITY_PROFILE_ORDER.includes(profile));
  if (unsupported) throw new Error(`Unsupported TypeScript quality profile: ${unsupported}`);
  return QUALITY_PROFILE_ORDER.filter((profile) => requested.includes(profile));
}

function sortedDiagnostics(diagnostics: readonly QualityAnalysisDiagnostic[]): readonly QualityAnalysisDiagnostic[] {
  return [...diagnostics].sort(
    (left, right) =>
      left.line - right.line || left.column - right.column || left.rule.name.localeCompare(right.rule.name),
  );
}

function locationOf(sourceFile: ts.SourceFile, node: ts.Node): { readonly line: number; readonly column: number } {
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: location.line + 1, column: location.character + 1 };
}

function nestedAssertion(expression: ts.Expression): ts.AsExpression | ts.TypeAssertion | undefined {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return isAssertion(current) ? current : undefined;
}

function isAssertion(node: ts.Node): node is ts.AsExpression | ts.TypeAssertion {
  return ts.isAsExpression(node) || ts.isTypeAssertionExpression(node);
}

function scriptKind(fileName: string): ts.ScriptKind {
  return fileName.toLowerCase().endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}
