import { describe, expect, it, vi } from "vitest";
import {
  WindowsModelGatewayAutostartAdapter,
  createModelGatewayAutostartDigest,
  type ModelGatewayLaunchDescriptor,
} from "../../src/index.js";

const launch: ModelGatewayLaunchDescriptor = {
  schemaVersion: 1,
  command: "C:\\Program Files\\Bun\\bun.exe",
  args: ["C:\\Kiln Dev\\packages\\cli\\dist\\index.js", "model-gateway", "ensure", "argument with spaces", "quote\"value"],
  mode: "local-dev",
  version: "3.0.0-test",
  requiredEnvNames: ["BEARER_TOKEN", "REPLAY_SECRET"],
};

describe("WindowsModelGatewayAutostartAdapter", () => {
  it("reports unsupported outside Windows without executing commands", async () => {
    const run = vi.fn();
    const adapter = createAdapter({ platform: "linux", run });
    await expect(adapter.install(launch)).resolves.toEqual({ state: "unsupported", platform: "linux" });
    await expect(adapter.uninstall()).resolves.toEqual({ state: "unsupported", platform: "linux" });
    await expect(adapter.status()).resolves.toEqual({ state: "unsupported", platform: "linux" });
    expect(run).not.toHaveBeenCalled();
  });

  it("installs an exact least-privilege user task without shell interpolation", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "ERROR: The system cannot find the file specified." })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "SUCCESS", stderr: "" });
    const writeXml = vi.fn(async (_path: string, _xml: string) => undefined);
    const remove = vi.fn(async () => undefined);
    const adapter = createAdapter({ run, writeXml, remove });

    await expect(adapter.install(launch)).resolves.toMatchObject({ state: "installed", digest: createModelGatewayAutostartDigest(launch) });
    expect(run.mock.calls[1]![0]).toEqual(["/Create", "/TN", expect.stringMatching(/^Kiln Model Gateway /), "/XML", "C:\\runtime\\autostart-task.xml", "/F"]);
    const xml = String(writeXml.mock.calls[0]![1]);
    expect(xml).toContain("<RunLevel>LeastPrivilege</RunLevel>");
    expect(xml).toContain("<UserId>operator</UserId>");
    expect(xml).toContain("<Command>C:\\Program Files\\Bun\\bun.exe</Command>");
    expect(xml).toContain("&quot;C:\\Kiln Dev\\packages\\cli\\dist\\index.js&quot;");
    expect(xml).toContain("&quot;quote\\&quot;value&quot;");
    expect(xml).not.toContain("secret-value");
    expect(remove).toHaveBeenCalledWith("C:\\runtime\\autostart-task.xml");
  });

  it("is idempotent for an owned matching task", async () => {
    const digest = createModelGatewayAutostartDigest(launch);
    const run = vi.fn(async () => ({ exitCode: 0, stdout: `<Task><RegistrationInfo><Description>kiln:model-gateway-autostart:v1:${digest}</Description></RegistrationInfo></Task>`, stderr: "" }));
    const adapter = createAdapter({ run });
    await expect(adapter.install(launch)).resolves.toEqual({ state: "installed", digest });
    expect(run).toHaveBeenCalledOnce();
  });

  it("never replaces or deletes a foreign task", async () => {
    const run = vi.fn(async () => ({ exitCode: 0, stdout: "<Task><RegistrationInfo><Description>operator task</Description></RegistrationInfo></Task>", stderr: "" }));
    const adapter = createAdapter({ run });
    await expect(adapter.install(launch)).resolves.toEqual({ state: "foreign" });
    await expect(adapter.uninstall()).resolves.toEqual({ state: "foreign" });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).not.toHaveBeenCalledWith(expect.arrayContaining(["/Create"]));
    expect(run).not.toHaveBeenCalledWith(expect.arrayContaining(["/Delete"]));
  });

  it("uninstalls only the exact owned task", async () => {
    const digest = createModelGatewayAutostartDigest(launch);
    const run = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: `<Description>kiln:model-gateway-autostart:v1:${digest}</Description>`, stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "SUCCESS", stderr: "" });
    const adapter = createAdapter({ run });
    await expect(adapter.uninstall()).resolves.toEqual({ state: "absent" });
    expect(run.mock.calls[1]![0]).toEqual(["/Delete", "/TN", expect.stringMatching(/^Kiln Model Gateway /), "/F"]);
  });
});

function createAdapter(overrides: Partial<ConstructorParameters<typeof WindowsModelGatewayAutostartAdapter>[0]> = {}) {
  return new WindowsModelGatewayAutostartAdapter({
    platform: "win32",
    runtimeDir: "C:\\runtime",
    userId: "operator",
    run: vi.fn(async () => ({ exitCode: 1, stdout: "", stderr: "not found" })),
    writeXml: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    ...overrides,
  });
}
