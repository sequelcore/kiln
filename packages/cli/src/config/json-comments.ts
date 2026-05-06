export function stripJsonComments(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  for (const line of lines) {
    let inString = false;
    let commentIndex = -1;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index]!;
      if (character === "\"" && (index === 0 || line[index - 1]! !== "\\")) {
        inString = !inString;
      } else if (!inString && character === "/" && index + 1 < line.length && line[index + 1] === "/") {
        commentIndex = index;
        break;
      }
    }
    result.push(commentIndex >= 0 ? line.slice(0, commentIndex).trimEnd() : line);
  }
  return result.join("\n");
}
