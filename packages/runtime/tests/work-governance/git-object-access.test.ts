import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile }));

import { git } from "../../src/work-governance/git-object-access.js";

describe("work-governance Git process boundary", () => {
  beforeEach(() => { execFile.mockReset(); });

  it("captures raw object bytes without opening a console and preserves the isolated index", async () => {
    const output = Buffer.from([0, 255, 10]);
    execFile.mockImplementation((_file, _args, _options, callback) => callback(null, output));

    await expect(git("/workspace", ["cat-file", "blob", "HEAD:file"], "/private/index")).resolves.toEqual(output);
    expect(execFile).toHaveBeenCalledOnce();
    const call = execFile.mock.calls[0];
    if (call === undefined) throw new Error("Git process was not launched");
    const [file, args, options, callback] = call;
    // Inspect launch policy separately so failures never print the inherited environment.
    expect({ file, args, ...options, env: undefined }).toEqual({
      file: "git",
      args: ["cat-file", "blob", "HEAD:file"],
      cwd: "/workspace",
      windowsHide: true,
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
      env: undefined,
    });
    expect(options.env.GIT_INDEX_FILE).toBe("/private/index");
    expect(options.env === process.env).toBe(false);
    expect(callback).toEqual(expect.any(Function));
  });

  it("propagates Git failure without substituting an empty object", async () => {
    const error = new Error("Git object unavailable");
    execFile.mockImplementation((_file, _args, _options, callback) => callback(error));
    await expect(git("/workspace", ["cat-file", "tree", "missing"])).rejects.toBe(error);
  });
});
