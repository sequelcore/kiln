/** Count executable node:test/mocha-style declarations after removing comments and literals. */
export function countBenchmarkHiddenTests(source: string): number {
  const code = stripJavaScriptTrivia(source);
  return [...code.matchAll(/(?<![\w.$])(?:test|it)\s*\(/gu)].length;
}

function stripJavaScriptTrivia(source: string): string {
  let output = "";
  let index = 0;
  while (index < source.length) {
    const current = source[index]!;
    const next = source[index + 1];
    if (current === "/" && next === "/") {
      output += "  ";
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        output += " ";
        index += 1;
      }
      continue;
    }
    if (current === "/" && next === "*") {
      output += "  ";
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        output += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      if (index < source.length) {
        output += "  ";
        index += 2;
      }
      continue;
    }
    if (current === "'" || current === '"' || current === "`") {
      const quote = current;
      output += " ";
      index += 1;
      while (index < source.length) {
        const character = source[index]!;
        output += character === "\n" ? "\n" : " ";
        index += 1;
        if (character === "\\") {
          if (index < source.length) {
            output += source[index] === "\n" ? "\n" : " ";
            index += 1;
          }
          continue;
        }
        if (character === quote) break;
      }
      continue;
    }
    output += current;
    index += 1;
  }
  return output;
}
