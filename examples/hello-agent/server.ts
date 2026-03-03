import { startGateway } from "@kilnai/runtime";
import { join } from "node:path";

await startGateway(join(import.meta.dir, "gateway.yaml"));
