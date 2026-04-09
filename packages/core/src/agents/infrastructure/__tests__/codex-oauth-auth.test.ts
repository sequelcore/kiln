import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KilnError } from "../../../engine/errors.js";

type CodexOAuthTokenFile = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  client_id: string;
};

type DeviceAuthorizationResult = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
  codeVerifier: string;
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
    it("calls POST https://auth.openai.com/api/accounts/deviceauth/usercode with client_id=app_EMoamEEZ73f0CkXaXp7hrann and code_challenge (S256)", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, {
        device_code: "device-code",
        user_code: "USER-CODE",
        verification_uri: "https://chatgpt.com/auth/device",
        interval: 5,
      }));

      const auth = await createAuth();
      await auth.startDeviceAuthorization();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://auth.openai.com/api/accounts/deviceauth/usercode");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded" });
      const body = String(init.body);
      expect(body).toContain("client_id=app_EMoamEEZ73f0CkXaXp7hrann");
      expect(body).toContain("code_challenge=");
      expect(body).toContain("code_challenge_method=S256");
    });

    it("returns deviceCode, userCode, verificationUri, intervalSeconds, codeVerifier", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, {
        device_code: "device-code",
        user_code: "USER-CODE",
        verification_uri: "https://chatgpt.com/auth/device",
        interval: 7,
      }));

      const auth = await createAuth();
      const result = await auth.startDeviceAuthorization() as DeviceAuthorizationResult;

      expect(result).toMatchObject({
        deviceCode: "device-code",
        userCode: "USER-CODE",
        verificationUri: "https://chatgpt.com/auth/device",
        intervalSeconds: 7,
      });
      expect(result.codeVerifier).toEqual(expect.any(String));
      expect(result.codeVerifier.length).toBeGreaterThan(10);
    });

    it("throws KilnError on non-200 response", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(400, { error: "invalid_request" }));

      const auth = await createAuth();

      await expect(auth.startDeviceAuthorization()).rejects.toBeInstanceOf(KilnError);
    });
  });

  describe("pollForAuthorization", () => {
    it("retries when response has error='authorization_pending', respecting intervalSeconds", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(200, { error: "authorization_pending" }))
        .mockResolvedValueOnce(jsonResponse(200, {
          code: "authorization-code",
        }))
        .mockResolvedValueOnce(jsonResponse(200, {
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
        }));

      const auth = await createAuth();
      const pending = auth.pollForAuthorization({
        deviceCode: "device-code",
        intervalSeconds: 3,
        codeVerifier: "verifier",
      });

      await vi.advanceTimersByTimeAsync(3000);
      await pending;

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch.mock.calls[0]?.[0]).toBe("https://auth.openai.com/api/accounts/deviceauth/token");
      expect(mockFetch.mock.calls[1]?.[0]).toBe("https://auth.openai.com/api/accounts/deviceauth/token");
      expect(mockFetch.mock.calls[2]?.[0]).toBe("https://auth.openai.com/oauth/token");
    });

    it("returns CodexOAuthTokenFile on success (exchanges code at /oauth/token with code_verifier)", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(200, { code: "authorization-code" }))
        .mockResolvedValueOnce(jsonResponse(200, {
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 7200,
        }));

      const auth = await createAuth();
      const token = await auth.pollForAuthorization({
        deviceCode: "device-code",
        intervalSeconds: 5,
        codeVerifier: "pkce-verifier",
      }) as CodexOAuthTokenFile;

      expect(token.access_token).toBe("access-token");
      expect(token.refresh_token).toBe("refresh-token");
      expect(token.client_id).toBe("app_EMoamEEZ73f0CkXaXp7hrann");
      expect(new Date(token.expires_at).toISOString()).toBe(token.expires_at);

      const [, exchangeInit] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(String(exchangeInit.body)).toContain("grant_type=authorization_code");
      expect(String(exchangeInit.body)).toContain("code=authorization-code");
      expect(String(exchangeInit.body)).toContain("code_verifier=pkce-verifier");
    });

    it("throws KilnError when error='expired_token'", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, { error: "expired_token" }));

      const auth = await createAuth();

      await expect(auth.pollForAuthorization({
        deviceCode: "device-code",
        intervalSeconds: 5,
        codeVerifier: "verifier",
      })).rejects.toBeInstanceOf(KilnError);
    });

    it("throws KilnError on unexpected error codes", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, { error: "slow_down_forever" }));

      const auth = await createAuth();

      await expect(auth.pollForAuthorization({
        deviceCode: "device-code",
        intervalSeconds: 5,
        codeVerifier: "verifier",
      })).rejects.toBeInstanceOf(KilnError);
    });
  });

  describe("refreshToken", () => {
    it("calls POST /oauth/token with grant_type=refresh_token", async () => {
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
      expect(String(init.body)).toContain("grant_type=refresh_token");
      expect(String(init.body)).toContain("refresh_token=refresh-token");
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

    it("returns false when token is expired (even within refresh window — hasValidCredentials just checks existence + basic validity)", async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify(futureToken({
        expires_at: "2026-04-08T23:59:00.000Z",
      })));

      const auth = await createAuth("/tmp/auth.json");

      await expect(auth.hasValidCredentials()).resolves.toBe(false);
    });
  });
});
