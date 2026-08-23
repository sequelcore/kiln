import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  serializeGatewayConfigDescriptors,
  serializeGatewayConfigEditorSchema,
} from "../src/engine/gateway/gateway-config-schema.js";
import {
  serializeAppConfigDescriptors,
  serializeAppConfigEditorSchema,
} from "../src/engine/loader/app-config-schema.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = join(packageRoot, "schemas");

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(join(outputDirectory, "gateway-config-v1.json"), serializeGatewayConfigEditorSchema(), "utf8");
writeFileSync(
  join(outputDirectory, "gateway-config-descriptors-v1.json"),
  serializeGatewayConfigDescriptors(),
  "utf8",
);
writeFileSync(join(outputDirectory, "app-config-v1.json"), serializeAppConfigEditorSchema(), "utf8");
writeFileSync(
  join(outputDirectory, "app-config-descriptors-v1.json"),
  serializeAppConfigDescriptors(),
  "utf8",
);
