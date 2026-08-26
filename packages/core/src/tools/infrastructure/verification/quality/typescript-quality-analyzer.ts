import * as ts from "@typescript/typescript6";
import {
  type QualityAnalysisDiagnostic,
  type QualityAnalysisProfileObservation,
  TYPE_INTEGRITY_PROFILE,
  TYPE_INTEGRITY_PROFILE_REVISION,
  TYPE_INTEGRITY_RULES,
} from "../../../../verification/static/quality-observation.js";

export const TYPESCRIPT_QUALITY_PARSER_VERSION = ts.version;

export interface TypeScriptQualityAnalysis {
  readonly parserVersion: string;
  readonly profiles: readonly QualityAnalysisProfileObservation[];
}

export function analyzeTypeScriptQuality(fileName: string, sourceText: string): TypeScriptQualityAnalysis {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, scriptKind(fileName));
  const parseDiagnostics =
    (sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (parseDiagnostics.length > 0) {
    const first = parseDiagnostics[0]!;
    throw new Error(`TypeScript parse failed: ${ts.flattenDiagnosticMessageText(first.messageText, " ")}`);
  }
  const diagnostics: QualityAnalysisDiagnostic[] = [];
  const visit = (node: ts.Node): void => {
    if (isAssertion(node)) {
      const nested = nestedAssertion(node.expression);
      if (nested) {
        const widening =
          nested.type.kind === ts.SyntaxKind.UnknownKeyword || nested.type.kind === ts.SyntaxKind.AnyKeyword;
        const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        diagnostics.push({
          rule: { name: widening ? "widen-then-assert" : "chained-type-assertion", revision: "v1" },
          message: widening
            ? `Avoid widening through ${nested.type.getText(sourceFile)} before asserting a narrower type.`
            : "Avoid chained type assertions; preserve or validate the value's type instead.",
          line: location.line + 1,
          column: location.character + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  diagnostics.sort(
    (left, right) =>
      left.line - right.line || left.column - right.column || left.rule.name.localeCompare(right.rule.name),
  );
  return {
    parserVersion: ts.version,
    profiles: [
      {
        name: TYPE_INTEGRITY_PROFILE,
        revision: TYPE_INTEGRITY_PROFILE_REVISION,
        rules: TYPE_INTEGRITY_RULES,
        diagnostics,
      },
    ],
  };
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
