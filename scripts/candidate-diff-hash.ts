import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const arguments_ = process.argv.slice(2);
const baseIndex = arguments_.indexOf("--base");
const base = baseIndex >= 0 ? arguments_[baseIndex + 1] : undefined;
if (!base) throw new Error("candidate-diff-hash requires --base <revision>");
const exclusions = arguments_.flatMap((argument, index, values) =>
  argument === "--exclude" && values[index + 1] ? [values[index + 1]!] : []
);
const excluded = new Set(exclusions);
const pathspecs = [".", ...exclusions.map((path) => `:(exclude)${path}`)];
const trackedDiff = execFileSync("git", ["diff", "--no-ext-diff", base, "--", ...pathspecs], { encoding: "utf8" });
const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split(/\r?\n/u)
  .filter((path) => path.length > 0 && !excluded.has(path))
  .sort();

const hash = createHash("sha256");
hash.update(trackedDiff);
for (const path of untracked) {
  hash.update(`\nFILE:${path}\n`);
  hash.update(readFileSync(path));
}
process.stdout.write(`sha256:${hash.digest("hex")}\n`);
