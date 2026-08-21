import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  serializeProjectConfigDescriptors,
  serializeProjectConfigEditorSchema,
} from "../src/config/project-config-schema.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = join(packageRoot, "schemas");

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(join(outputDirectory, "project-config-v1.json"), serializeProjectConfigEditorSchema(), "utf8");
writeFileSync(
  join(outputDirectory, "project-config-descriptors-v1.json"),
  serializeProjectConfigDescriptors(),
  "utf8",
);
