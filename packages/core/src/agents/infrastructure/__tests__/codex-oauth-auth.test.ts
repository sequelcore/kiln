import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KilnError } from "../../../engine/errors.js";

type CodexOAuthTokenFile = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  client_id: string;
};

type DeviceAuthorizationResult = {
  deviceAuthId: string;
  userCode: string;
  intervalSeconds: number;
};

const mockMkdir = vi.fn();
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockUnlink = vi.fn();
const mockJoin = vi.fn((...parts: string[]) => parts.join("/"));
const mockDirname = vi.fn((input: string) => {
  const parts = input.split("/");
  parts.pop();
  return parts.length > 0 ? parts.join("/") : ".";
});
const mockHomedir = vi.fn(() => "/mock-home");
const mockFetch = vi.fn();

vi.mock("node:fs/promises", () => ({
  mkdir: mockMkdir,
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  unlink: mockUnlink,
}));

vi.mock("node:path", () => ({
  join: mockJoin,
  dirname: mockDirname,
}));

vi.mock("node:os", () => ({
  homedir: mockHomedir,
}));

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

function futureToken(overrides?: Partial<CodexOAuthTokenFile>): CodexOAuthTokenFile {
  return {
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_at: "2026-04-09T01:00:00.000Z",
    client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
    ...overrides,
  };
}

async function loadModule(): Promise<typeof import("../codex-oauth-auth.js")> {
  return import("../codex-oauth-auth.js");
}

async function createAuth(tokenPath = "/tmp/codex-oauth.json") {
  const { CodexOAuthAuth } = await loadModule();
  return new CodexOAuthAuth({ tokenPath });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-09T00:00:00.000Z"));
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  mockMkdir.mockReset();
  mockReadFile.mockReset();
  mockWriteFile.mockReset();
  mockUnlink.mockReset();
  mockJoin.mockClear();
  mockDirname.mockClear();
  mockHomedir.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("CodexOAuthAuth", () => {
  describe("startDeviceAuthorization", () => {
    it("calls POST https://auth.openai.com/api/accounts/deviceauth/usercode with only client_id in JSON", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, {
        device_auth_id: "device-auth-id",
        user_code: "USER-CODE",
        interval: "5",
        expires_at: "2026-04-09T01:00:00.000Z",
      }));

      const auth = await createAuth();
      await auth.startDeviceAuthorization();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://auth.openai.com/api/accounts/deviceauth/usercode");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "Content-Type": "application/json" });
      expect(JSON.parse(String(init.body))).toEqual({
        client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
      });
    });

    it("returns deviceAuthId, userCode, and intervalSeconds with a minimum of 3 seconds", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, {
        device_auth_id: "device-auth-id",
        user_code: "USER-CODE",
        interval: "1",
        expires_at: "2026-04-09T01:00:00.000Z",
      }));

      const auth = await createAuth();
      const result = await auth.startDeviceAuthorization() as DeviceAuthorizationResult;

      expect(result).toEqual({
        deviceAuthId: "device-auth-id",
        userCode: "USER-CODE",
        intervalSeconds: 3,
      });
    });

    it("throws KilnError on non-200 response", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(400, { error: "invalid_request" }));

      const auth = await createAuth();

      await expect(auth.startDeviceAuthorization()).rejects.toBeInstanceOf(KilnError);
    });
  });

  describe("pollForAuthorization", () => {
    it("treats 403/404 as pending, waits intervalSeconds before each poll, and exchanges the returned authorization code", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(403, {}))
        .mockResolvedValueOnce(jsonResponse(404, {}))
        .mockResolvedValueOnce(jsonResponse(200, {
          authorization_code: "authorization-code",
          code_verifier: "server-code-verifier",
        }))
        .mockResolvedValueOnce(jsonResponse(200, {
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
        }));

      const auth = await createAuth();
      const pending = auth.pollForAuthorization({
        deviceAuthId: "device-auth-id",
        userCode: "USER-CODE",
        intervalSeconds: 3,
      });

      await vi.advanceTimersByTimeAsync(9000);
      const token = await pending as CodexOAuthTokenFile;

      expect(token.access_token).toBe("access-token");
      expect(mockFetch).toHaveBeenCalledTimes(4);
      expect(mockFetch.mock.calls[0]?.[0]).toBe("https://auth.openai.com/api/accounts/deviceauth/token");
      expect(mockFetch.mock.calls[1]?.[0]).toBe("https://auth.openai.com/api/accounts/deviceauth/token");
      expect(mockFetch.mock.calls[2]?.[0]).toBe("https://auth.openai.com/api/accounts/deviceauth/token");
      expect(mockFetch.mock.calls[3]?.[0]).toBe("https://auth.openai.com/oauth/token");
      expect(JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body))).toEqual({
        device_auth_id: "device-auth-id",
        user_code: "USER-CODE",
      });

      const [, exchangeInit] = mockFetch.mock.calls[3] as [string, RequestInit];
      expect(exchangeInit.headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded" });
      const exchangeBody = String(exchangeInit.body);
      expect(exchangeBody).toContain("grant_type=authorization_code");
      expect(exchangeBody).toContain("code=authorization-code");
      expect(exchangeBody).toContain("redirect_uri=https%3A%2F%2Fauth.openai.com%2Fdeviceauth%2Fcallback");
      expect(exchangeBody).toContain("client_id=app_EMoamEEZ73f0CkXaXp7hrann");
      expect(exchangeBody).toContain("code_verifier=server-code-verifier");
    });

    it("throws KilnError on non-pending polling errors", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(400, { error: "bad_request" }));

      const auth = await createAuth();
      const pending = auth.pollForAuthorization({
        deviceAuthId: "device-auth-id",
        userCode: "USER-CODE",
        intervalSeconds: 3,
      });
      const assertion = expect(pending).rejects.toBeInstanceOf(KilnError);

      await vi.advanceTimersByTimeAsync(3000);
      await assertion;
    });

    it("throws KilnError when polling succeeds without authorization_code or code_verifier", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, {
        authorization_code: "authorization-code",
      }));

      const auth = await createAuth();
      const pending = auth.pollForAuthorization({
        deviceAuthId: "device-auth-id",
        userCode: "USER-CODE",
        intervalSeconds: 3,
      });
      const assertion = expect(pending).rejects.toBeInstanceOf(KilnError);

      await vi.advanceTimersByTimeAsync(3000);
      await assertion;
    });

    it("times out after 15 minutes", async () => {
      mockFetch.mockResolvedValue(jsonResponse(403, {}));

      const auth = await createAuth();
      const pending = auth.pollForAuthorization({
        deviceAuthId: "device-auth-id",
        userCode: "USER-CODE",
        intervalSeconds: 3,
      });
      const assertion = expect(pending).rejects.toBeInstanceOf(KilnError);

      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      await assertion;
    });
  });

  describe("refreshToken", () => {
    it("calls POST /oauth/token with form-encoded refresh_token grant", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, {
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        expires_in: 3600,
      }));

      const auth = await createAuth();
      await auth.refreshToken(futureToken());

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://auth.openai.com/oauth/token");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded" });
      const body = String(init.body);
      expect(body).toContain("grant_type=refresh_token");
      expect(body).toContain("refresh_token=refresh-token");
      expect(body).toContain("client_id=app_EMoamEEZ73f0CkXaXp7hrann");
    });

    it("returns updated CodexOAuthTokenFile with new tokens and expiry", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, {
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        expires_in: 5400,
      }));

      const auth = await createAuth();
      const token = await auth.refreshToken(futureToken()) as CodexOAuthTokenFile;

      expect(token).toMatchObject({
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
      });
      expect(new Date(token.expires_at).getTime()).toBeGreaterThan(Date.now());
    });

    it("throws KilnError on failure", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(401, { error: "invalid_grant" }));

      const auth = await createAuth();

      await expect(auth.refreshToken(futureToken())).rejects.toBeInstanceOf(KilnError);
    });
  });

  describe("getValidAccessToken", () => {
    it("returns access_token from file when not expired", async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify(futureToken({
        access_token: "persisted-access-token",
        expires_at: "2026-04-09T02:00:00.000Z",
      })));

      const auth = await createAuth("/tmp/auth.json");
      const accessToken = await auth.getValidAccessToken();

      expect(accessToken).toBe("persisted-access-token");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("auto-refreshes and saves when token expires within 120 seconds", async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify(futureToken({
        access_token: "stale-token",
        refresh_token: "refresh-me",
        expires_at: "2026-04-09T00:01:30.000Z",
      })));
      mockFetch.mockResolvedValueOnce(jsonResponse(200, {
        access_token: "fresh-token",
        refresh_token: "fresh-refresh-token",
        expires_in: 3600,
      }));

      const auth = await createAuth("/tmp/auth.json");
      const accessToken = await auth.getValidAccessToken();

      expect(accessToken).toBe("fresh-token");
      expect(mockWriteFile).toHaveBeenCalledTimes(1);
    });

    it("throws KilnError when no token file exists", async () => {
      mockReadFile.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

      const auth = await createAuth("/tmp/auth.json");

      await expect(auth.getValidAccessToken()).rejects.toBeInstanceOf(KilnError);
    });

    it("throws KilnError when the persisted token file has a blank access_token", async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify(futureToken({
        access_token: "   ",
        expires_at: "2026-04-09T02:00:00.000Z",
      })));

      const auth = await createAuth("/tmp/auth.json");

      await expect(auth.getValidAccessToken()).rejects.toBeInstanceOf(KilnError);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("throws KilnError when the persisted token file has a blank refresh_token even if expires_at is in the future", async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify(futureToken({
        refresh_token: "   ",
        expires_at: "2026-04-09T02:00:00.000Z",
      })));

      const auth = await createAuth("/tmp/auth.json");

      await expect(auth.getValidAccessToken()).rejects.toBeInstanceOf(KilnError);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("loadTokenFile / saveTokenFile / clearTokenFile", () => {
    it("saveTokenFile writes JSON to tokenPath, creating directory recursively", async () => {
      const token = futureToken();
      const auth = await createAuth("/tmp/kiln/auth/codex-oauth.json");

      await auth.saveTokenFile(token);

      expect(mockMkdir).toHaveBeenCalledTimes(1);
      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      expect(mockWriteFile.mock.calls[0]?.[0]).toBe("/tmp/kiln/auth/codex-oauth.json");
      expect(JSON.parse(String(mockWriteFile.mock.calls[0]?.[1]))).toEqual(token);
    });

    it("loadTokenFile reads and parses the file, returns null if missing", async () => {
      mockReadFile
        .mockResolvedValueOnce(JSON.stringify(futureToken()))
        .mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

      const auth = await createAuth("/tmp/auth.json");

      await expect(auth.loadTokenFile()).resolves.toEqual(futureToken());
      await expect(auth.loadTokenFile()).resolves.toBeNull();
    });

    it("clearTokenFile deletes the file", async () => {
      const auth = await createAuth("/tmp/auth.json");

      await auth.clearTokenFile();

      expect(mockUnlink).toHaveBeenCalledTimes(1);
      expect(mockUnlink).toHaveBeenCalledWith("/tmp/auth.json");
    });
  });

  describe("hasValidCredentials", () => {
    it("returns true when token file exists and token is not expired", async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify(futureToken({
        expires_at: "2026-04-09T03:00:00.000Z",
      })));

      const auth = await createAuth("/tmp/auth.json");

      await expect(auth.hasValidCredentials()).resolves.toBe(true);
    });

    it("returns false when no token file", async () => {
      mockReadFile.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

      const auth = await createAuth("/tmp/auth.json");

      await expect(auth.hasValidCredentials()).resolves.toBe(false);
    });

    it("returns false when token is expired", async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify(futureToken({
        expires_at: "2026-04-08T23:59:00.000Z",
      })));

      const auth = await createAuth("/tmp/auth.json");

      await expect(auth.hasValidCredentials()).resolves.toBe(false);
    });

    it("returns false when access_token is blank even if the token is not expired", async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify(futureToken({
        access_token: "   ",
        expires_at: "2026-04-09T03:00:00.000Z",
      })));

      const auth = await createAuth("/tmp/auth.json");

      await expect(auth.hasValidCredentials()).resolves.toBe(false);
    });

    it("returns false when refresh_token is blank even if the token is not expired", async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify(futureToken({
        refresh_token: "   ",
        expires_at: "2026-04-09T03:00:00.000Z",
      })));

      const auth = await createAuth("/tmp/auth.json");

      await expect(auth.hasValidCredentials()).resolves.toBe(false);
    });
  });
});
