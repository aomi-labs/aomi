import { afterEach, describe, expect, it, vi } from "vitest";

const { readBackend, load } = vi.hoisted(() => ({
  readBackend: vi.fn(),
  load: vi.fn(),
}));
vi.mock("../cli-session", () => ({ CliSession: { load } }));
vi.mock("../state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state")>()),
  readActiveBackendUrl: readBackend,
}));
import { currentBackendCommand } from "./control";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  load.mockReset();
  readBackend.mockReset();
});

describe("effective CLI connection", () => {
  it.each([
    [undefined, undefined, undefined, "https://chat.aomi.dev", "default"],
    [
      undefined,
      undefined,
      "https://saved.example",
      "https://saved.example",
      "session",
    ],
    [
      undefined,
      "https://api-staging.aomi.dev",
      "https://saved.example",
      "https://api-staging.aomi.dev",
      "AOMI_BACKEND_URL",
    ],
    [
      "https://flag.example",
      "https://api-staging.aomi.dev",
      "https://saved.example",
      "https://flag.example",
      "--backend-url",
    ],
  ])(
    "reports the effective origin and source",
    (flag, env, saved, origin, source) => {
      vi.stubEnv("AOMI_BACKEND_URL", env);
      readBackend.mockReturnValue(saved);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      currentBackendCommand({ baseUrl: flag, json: true });
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
        origin,
        source,
      });
      expect(load).not.toHaveBeenCalled();
      expect(readBackend).toHaveBeenCalledTimes(flag || env ? 0 : 1);
    },
  );

  it("redacts credential-bearing URL components and does not create a session", () => {
    vi.stubEnv(
      "AOMI_BACKEND_URL",
      "https://user:secret@proxy.example/private?key=secret",
    );
    readBackend.mockReturnValue(undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    currentBackendCommand({ json: true });
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
      origin: "https://proxy.example",
      source: "AOMI_BACKEND_URL",
    });
    expect(log.mock.calls.flat().join(" ")).not.toContain("secret");
  });
});

it.each(["file:///tmp/backend", "data:text/plain,backend"])(
  "rejects non-HTTP origins without exposing the URL: %s",
  (baseUrl) => {
    vi.stubEnv("AOMI_CLI_STRICT_EXIT", "1");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => currentBackendCommand({ baseUrl, json: true })).toThrow();
    expect(error.mock.calls.flat().join(" ")).not.toContain(baseUrl);
  },
);
