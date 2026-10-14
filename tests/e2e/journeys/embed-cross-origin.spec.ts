import { test, expect } from "../journey-fixture";
import type { Request } from "@playwright/test";

const privatePath = /^\/api\/(?:auth|account|thread)\//;

test("agent and account traffic go to the Portal origin", async ({
  widget,
  agent,
  portal,
}, info) => {
  const portalOrigin = new URL(portal).origin;
  const browserRequests: { method: string; url: string }[] = [];
  const record = (request: Request) => {
    const path = new URL(request.url()).pathname;
    if (
      (request.method() === "POST" && path === "/v1/agent/chat") ||
      privatePath.test(path)
    )
      browserRequests.push({ method: request.method(), url: request.url() });
  };
  widget.page.on("request", record);
  try {
    await widget.sendAndSettle("cross origin journey");
  } finally {
    widget.page.off("request", record);
  }
  expect(agent.log.find((r) => r.route === "chat.start")).toBeTruthy();
  const starts = browserRequests.filter(
    (request) => new URL(request.url).pathname === "/v1/agent/chat",
  );
  expect(starts).toHaveLength(1);
  expect(new URL(starts[0]!.url).origin).toBe(portalOrigin);
  // The session may already be settled before listening started, so the
  // browser's resource timings count as well as observed requests.
  const privateOrigins = await widget.page.evaluate(
    (pattern) =>
      performance
        .getEntriesByType("resource")
        .filter((entry) =>
          new RegExp(pattern).test(new URL(entry.name).pathname),
        )
        .map((entry) => new URL(entry.name).origin),
    privatePath.source,
  );
  const observedPrivateOrigins = [
    ...privateOrigins,
    ...browserRequests
      .filter((request) => privatePath.test(new URL(request.url).pathname))
      .map((request) => new URL(request.url).origin),
  ];
  expect(observedPrivateOrigins.length).toBeGreaterThan(0);
  expect([...new Set(observedPrivateOrigins)]).toEqual([portalOrigin]);
  if (info.project.name.startsWith("embed")) {
    expect(new URL(widget.page.url()).origin).not.toBe(portalOrigin);
  }
  await expect(
    widget.userMessages.filter({ hasText: "cross origin journey" }),
  ).toHaveCount(1);
});

test("the Portal's OAuth token route rejects an unregistered origin", async ({
  request,
  portal,
}) => {
  const tokenUrl = `${portal}/api/auth/oauth2/token`;
  const form = { grant_type: "client_credentials" };
  const own = await request.post(tokenUrl, {
    headers: { origin: new URL(portal).origin },
    form,
  });
  expect(own.status()).toBeLessThan(500);
  expect(own.status()).not.toBe(403);
  const foreign = await request.post(tokenUrl, {
    headers: { origin: "https://unregistered.example" },
    form,
  });
  expect(foreign.status()).toBe(403);
  expect(await foreign.json()).toEqual({ error: "origin_not_allowed" });
});
