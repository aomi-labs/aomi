// @vitest-environment node
import { describe, expect, it } from "vitest";
import { appendCookie, redirectResponse } from "./http-response";

describe("Build native redirect responses", () => {
  it("preserves 307 and emits separate compatible cookies on mutable headers", () => {
    const response = redirectResponse(
      new URL("https://build.aomi.dev/projects"),
    );
    appendCookie(response, "aomi_github", "signed-token", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 604800,
    });
    appendCookie(response, "aomi_github_oauth_request", "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://build.aomi.dev/projects",
    );
    expect(response.headers.getSetCookie()).toEqual([
      "aomi_github=signed-token; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax",
      "aomi_github_oauth_request=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
    ]);
  });
});
