// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { resolveChatUrl, chatAppUrl } from "./chat-url";

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_CHAT_URL;

});

describe("resolveChatUrl", () => {
  it("returns the env var value when set", () => {
    process.env.NEXT_PUBLIC_CHAT_URL = "https://custom-chat.aomi.dev";
    expect(resolveChatUrl()).toBe("https://custom-chat.aomi.dev");
  });

  it("falls back when env var is empty string", () => {
    process.env.NEXT_PUBLIC_CHAT_URL = "";
    expect(resolveChatUrl()).toBe("https://chat-staging.aomi.dev");
  });

  it("trims whitespace from env var value", () => {
    process.env.NEXT_PUBLIC_CHAT_URL = "  https://trimmed.aomi.dev  ";
    expect(resolveChatUrl()).toBe("https://trimmed.aomi.dev");
  });

  it("falls back when env var is only whitespace", () => {
    process.env.NEXT_PUBLIC_CHAT_URL = "   ";
    expect(resolveChatUrl()).toBe("https://chat-staging.aomi.dev");
  });

  it("preserves trailing slashes from env var", () => {
    process.env.NEXT_PUBLIC_CHAT_URL = "https://custom.aomi.dev/";
    expect(resolveChatUrl()).toBe("https://custom.aomi.dev/");
  });
});

describe("chatAppUrl", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_CHAT_URL = "https://chat.aomi.dev";
  });

  it("constructs a deep-link URL for the given app name", () => {
    expect(chatAppUrl("my-bot")).toBe("https://chat.aomi.dev?app=my-bot");
  });

  it("encodes special characters in app name", () => {
    expect(chatAppUrl("my bot!")).toBe("https://chat.aomi.dev?app=my+bot%21");
  });

  it("encodes url-unsafe characters", () => {
    expect(chatAppUrl("a&b/c")).toBe("https://chat.aomi.dev?app=a%26b%2Fc");
  });

  it("handles empty app name", () => {
    expect(chatAppUrl("")).toBe("https://chat.aomi.dev?app=");
  });

  it("handles numeric app names", () => {
    expect(chatAppUrl("123")).toBe("https://chat.aomi.dev?app=123");
  });

  it("can lock the frame to the requested app", () => {
    expect(chatAppUrl("my-bot", { locked: true })).toBe(
      "https://chat.aomi.dev?app=my-bot&lock_app=1",
    );
  });

  it("can target a specific application row", () => {
    expect(chatAppUrl("my-bot", { locked: true, applicationId: 42 })).toBe(
      "https://chat.aomi.dev?app=my-bot&application_id=42&lock_app=1",
    );
  });
});
