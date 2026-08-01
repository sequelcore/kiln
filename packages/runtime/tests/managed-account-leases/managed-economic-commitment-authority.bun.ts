import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteManagedAccountLeaseAuthority } from "../../src/managed-account-leases/managed-account-lease-authority.js";

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "kiln-economic-authority-native-"));
  let authority: SqliteManagedAccountLeaseAuthority | undefined;
  try {
    const path = join(root, "authority.sqlite");
    authority = new SqliteManagedAccountLeaseAuthority({
      path,
      ownerId: "native-permission-proof",
    });

    if (process.platform !== "win32") {
      for (const artifact of [path, `${path}-wal`, `${path}-shm`]) {
        const mode = (await stat(artifact)).mode & 0o777;
        if (mode !== 0o600) {
          throw new Error(`${artifact} permissions are ${mode.toString(8)}, expected 600.`);
        }
      }
    }
  } finally {
    authority?.close();
    await rm(root, { recursive: true, force: true });
  }
}

await main();
