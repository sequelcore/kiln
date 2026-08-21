import { stringify } from "yaml";
import {
  commitGlobalConfigBytes,
  readGlobalConfig,
  readGlobalConfigSnapshot,
  type KilnGlobalConfig,
} from "../../src/config/global-config.js";

/** Test-only canonical seeding through the retained byte-commit primitive. */
export function persistGlobalConfigFixture(
  value: KilnGlobalConfig | ((current: KilnGlobalConfig | null) => KilnGlobalConfig),
) {
  const current = readGlobalConfig();
  const next = typeof value === "function" ? value(current) : value;
  return commitGlobalConfigBytes({
    content: stringify(next),
    expectedRevision: readGlobalConfigSnapshot().revision,
  });
}
