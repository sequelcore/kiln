import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

/**
 * CLI startup resolves agents, skills, and configuration from the user home
 * directory whenever a caller does not pass an explicit one. Without this
 * setup the suite reads the operator's real home: results depend on whatever
 * that machine happens to have installed, and every route resolution pays the
 * cost of scanning it.
 *
 * Each test file gets its own empty synthetic home instead. Tests that need
 * home-directory contents must create it under this directory explicitly.
 */
const syntheticHome = mkdtempSync(join(tmpdir(), "kiln-cli-home-"));

process.env.HOME = syntheticHome;
process.env.USERPROFILE = syntheticHome;

// resolveGlobalConfigPath prefers XDG_CONFIG_HOME over the home directory, so
// an inherited value would send global configuration outside the synthetic home
// and make results depend on the host. Linux sets it; Windows does not, which
// is why suites that hardcode the home-directory layout only failed on CI.
delete process.env.XDG_CONFIG_HOME;

afterAll(() => {
  rmSync(syntheticHome, { recursive: true, force: true });
});
