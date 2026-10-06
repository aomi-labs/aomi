// @vitest-environment node

import { describe, expect, it } from "vitest";
import type {
  WidgetAuthStore,
  WidgetAuthTicket,
} from "../src/widget-auth/store";
import {
  issueWidgetSession,
  resolveWidgetSession,
  revokeWidgetSession,
} from "../src/widget-auth/session";
import { observedWidgetOrigin } from "../src/widget-auth/origin";

function memoryStore() {
  const tickets = new Map<
    string,
    { ticket: WidgetAuthTicket; expiresAt: Date }
  >();
  const store: WidgetAuthStore = {
    write: async ({ identifier, ticket, expiresAt }) => {
      tickets.set(identifier, { ticket, expiresAt });
    },
    read: async ({ identifier, now }) => {
      const value = tickets.get(identifier);
      return value && value.expiresAt > now ? value.ticket : null;
    },
    consume: async ({ identifier, now }) => {
      const value = tickets.get(identifier);
      tickets.delete(identifier);
      return value && value.expiresAt > now ? value.ticket : null;
    },
    delete: async ({ identifier }) => tickets.delete(identifier),
  };
  return { store, tickets };
}

describe("widget sessions", () => {
  it("stores only a hash, binds the token to origin, expires, and revokes", async () => {
    const { store, tickets } = memoryStore();
    const now = new Date("2030-01-01T00:00:00.000Z");
    const session = await issueWidgetSession({
      userId: "user-1",
      origin: "https://consumer.example",
      authMethod: "para",
      now,
      ttlSeconds: 60,
      store,
    });
    expect(session.token).toMatch(/^aomi_wst_/);
    expect([...tickets.keys()].join(" ")).not.toContain(session.token);
    expect(JSON.stringify([...tickets.values()])).not.toContain(session.token);

    const request = new Request("https://portal.example/api/account", {
      headers: {
        Authorization: `Bearer ${session.token}`,
        Origin: "https://consumer.example",
      },
    });
    await expect(
      resolveWidgetSession({
        request,
        now,
        store,
        isUserActive: async () => true,
      }),
    ).resolves.toMatchObject({ userId: "user-1", authMethod: "para" });

    const wrongOrigin = new Request(request, {
      headers: {
        Authorization: `Bearer ${session.token}`,
        Origin: "https://attacker.example",
      },
    });
    await expect(
      resolveWidgetSession({
        request: wrongOrigin,
        now,
        store,
        isUserActive: async () => true,
      }),
    ).resolves.toBeNull();
    await expect(
      resolveWidgetSession({
        request,
        now,
        store,
        isUserActive: async () => false,
      }),
    ).resolves.toBeNull();
    await expect(
      resolveWidgetSession({
        request,
        now: new Date(now.getTime() + 61_000),
        store,
        isUserActive: async () => true,
      }),
    ).resolves.toBeNull();
    await expect(
      revokeWidgetSession({
        request,
        now,
        store,
        isUserActive: async () => true,
      }),
    ).resolves.toBe(true);
    expect(tickets.size).toBe(0);
  });

  it("requires explicit secure origins, with localhost HTTP in every environment", () => {
    expect(
      observedWidgetOrigin(
        new Request("https://portal.example", {
          headers: { Origin: "https://consumer.example" },
        }),
        "production",
      ),
    ).toBe("https://consumer.example");
    expect(
      observedWidgetOrigin(
        new Request("https://portal.example", {
          headers: { Origin: "http://localhost:3001" },
        }),
        "development",
      ),
    ).toBe("http://localhost:3001");
    expect(
      observedWidgetOrigin(
        new Request("https://portal.example", {
          headers: { Origin: "http://localhost:3001" },
        }),
        "production",
      ),
    ).toBe("http://localhost:3001");
    expect(
      observedWidgetOrigin(
        new Request("https://portal.example", {
          headers: { Origin: "http://192.168.1.20:3001" },
        }),
        "production",
      ),
    ).toBeNull();
    expect(
      observedWidgetOrigin(new Request("https://portal.example")),
    ).toBeNull();
  });
});
