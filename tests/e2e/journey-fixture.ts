import { test as base, expect, type Response } from "@playwright/test";
import { FakeAgentBackend } from "./fake-backend/backend";
import { createFakeAgentServer } from "./fake-backend/server";
import { WidgetPage } from "./pom/widget";

export type JourneyOptions = {
  /** Origin of the real Portal that owns auth for every host under test. */
  portal: string;
};

type GuestOwner = {
  kind: "cookie" | "widget-memory";
  assertOwnerAfterReload(): Promise<void>;
};

export const test = base.extend<
  { agent: FakeAgentBackend; widget: WidgetPage; guestOwner: GuestOwner },
  JourneyOptions
>({
  portal: ["", { option: true, scope: "worker" }],
  guestOwner: async ({ page, baseURL, portal }, use) => {
    const request = page.context().request;
    if (baseURL && new URL(baseURL).origin === new URL(portal).origin) {
      // Agent starts go to the fake directly and skip the BFF's guest
      // bootstrap, so sign in the real guest first; reloads then read the
      // same Better Auth cookie a real turn would.
      const signIn = await request.post(
        `${portal}/api/auth/sign-in/anonymous`,
        {
          headers: { origin: new URL(portal).origin },
          data: {},
        },
      );
      expect(signIn.status(), "real guest sign-in").toBe(200);
      const guestId = async () => {
        const session = await request.get(`${portal}/api/auth/get-session`);
        const body = await session.json();
        expect(body?.user?.isAnonymous).toBe(true);
        return body?.user?.id as string;
      };
      const owner = await guestId();
      expect(owner).toBeTruthy();
      await use({
        kind: "cookie",
        async assertOwnerAfterReload() {
          expect(await guestId()).toBe(owner);
        },
      });
      return;
    }
    // Embedded guests keep their credential in memory, so a reload starts a
    // new guest who must not see the previous guest's chat.
    const guests: string[] = [];
    const onResponse = (response: Response) => {
      if (
        new URL(response.url()).pathname !== "/api/auth/widget/guest" ||
        response.status() !== 200
      )
        return;
      void response
        .json()
        .then((body) => {
          if (typeof body?.user?.id === "string") guests.push(body.user.id);
        })
        .catch(() => undefined);
    };
    page.on("response", onResponse);
    try {
      await use({
        kind: "widget-memory",
        async assertOwnerAfterReload() {
          await expect.poll(() => guests.length).toBe(2);
          expect(guests[1]).not.toBe(guests[0]);
        },
      });
    } finally {
      page.off("response", onResponse);
    }
  },
  agent: async ({ page, guestOwner: _guestOwner }, use, info) => {
    const server = await createFakeAgentServer();
    // Only agent traffic is faked; auth, account and catalogs stay real.
    await page.route(/\/v1\/agent(?:\/|$)/, (route) => {
      const url = new URL(route.request().url());
      return route.continue({
        url: `${server.origin}${url.pathname}${url.search}`,
      });
    });
    try {
      await use(server.backend);
    } finally {
      await server.close();
    }
    await info.attach("agent-requests", {
      body: JSON.stringify(server.backend.log, null, 2),
      contentType: "application/json",
    });
  },
  widget: async ({ page, agent: _agent }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      if (window.self !== window.top) return;
      localStorage.setItem("aomi-cookie-consent", "declined");
    });
    await page.goto("/");
    const widget = new WidgetPage(page);
    await widget.ready();
    await use(widget);
    expect(errors).toEqual([]);
  },
});
export { expect };
