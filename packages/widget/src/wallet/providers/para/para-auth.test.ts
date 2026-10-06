import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createParaCredentialGetter,
  DISCONNECTED_PARA_ACCOUNT,
  resolveParaSubject,
} from "./para-auth";

vi.mock("@getpara/react-sdk", () => ({
  useAccount: vi.fn(),
  useClient: vi.fn(),
  useLogout: vi.fn(),
  useModal: vi.fn(),
}));

describe("createParaCredentialGetter", () => {
  it("issues a session JWT directly through the active Para client", async () => {
    const issueJwt = vi.fn(async () => ({
      token: "  signed-provider-token  ",
      keyId: "key-1",
    }));
    const getCredential = createParaCredentialGetter({ issueJwt });

    await expect(getCredential?.()).resolves.toEqual({
      provider: "para",
      tokenKind: "session_jwt",
      providerToken: "signed-provider-token",
      keyId: "key-1",
    });
    expect(issueJwt).toHaveBeenCalledOnce();
    expect(issueJwt).toHaveBeenCalledWith({});
  });

  it("returns no getter when the Para client is unavailable", () => {
    expect(createParaCredentialGetter(null)).toBeNull();
  });

  describe("issueJwt backoff", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function forbidden() {
      return Object.assign(new Error("Forbidden"), { status: 403 });
    }

    it("backs off for 30 seconds after an unavailable response", async () => {
      vi.useFakeTimers();
      const issueJwt = vi
        .fn<() => Promise<{ token?: string }>>()
        .mockRejectedValueOnce(forbidden())
        .mockResolvedValue({ token: "signed" });
      const getCredential = createParaCredentialGetter({ issueJwt })!;

      await expect(getCredential()).resolves.toBeNull();
      await expect(getCredential()).resolves.toBeNull();
      expect(issueJwt).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(30_001);
      await expect(getCredential()).resolves.toMatchObject({
        providerToken: "signed",
      });
      expect(issueJwt).toHaveBeenCalledTimes(2);
    });

    it("asks Para again immediately when the caller wants a fresh credential", async () => {
      vi.useFakeTimers();
      const issueJwt = vi
        .fn<() => Promise<{ token?: string }>>()
        .mockRejectedValueOnce(forbidden())
        .mockRejectedValueOnce(forbidden())
        .mockResolvedValue({ token: "signed" });
      const getCredential = createParaCredentialGetter({ issueJwt })!;

      await expect(getCredential()).resolves.toBeNull();
      await expect(getCredential({ fresh: true })).resolves.toBeNull();
      await expect(getCredential({ fresh: true })).resolves.toMatchObject({
        providerToken: "signed",
      });
      expect(issueJwt).toHaveBeenCalledTimes(3);
      // Polling callers still honour the backoff armed by the failures above.
      await expect(getCredential()).resolves.toBeNull();
      expect(issueJwt).toHaveBeenCalledTimes(3);
    });
  });
});

describe("resolveParaSubject", () => {
  it("uses the embedded account user id exposed by current Para SDKs", () => {
    expect(
      resolveParaSubject(
        {
          ...DISCONNECTED_PARA_ACCOUNT,
          isConnected: true,
          embedded: { userId: "embedded-user" },
        },
        { userId: "client-user" },
      ),
    ).toBe("embedded-user");
  });

  it("falls back to ParaCore.userId for SDK account shapes without the id", () => {
    expect(
      resolveParaSubject(
        { ...DISCONNECTED_PARA_ACCOUNT, isConnected: true },
        { userId: "client-user" },
      ),
    ).toBe("client-user");
  });
});
