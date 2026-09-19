// @vitest-environment node

import { describe, expect, it } from "vitest";
import type {
  WidgetAuthStore,
  WidgetAuthTicket,
} from "../src/widget-auth/store";
import {
  issueWidgetSession,
  revokeWidgetSession,
} from "../src/widget-auth/session";

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

describe("revokeWidgetSession", () => {
  it("deletes the token row even when the owning user is deactivated", async () => {
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
    const request = new Request("https://portal.example/api/auth/sign-out", {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${session.token}`,
        Origin: "https://consumer.example",
      },
    });

    await expect(
      revokeWidgetSession({
        request,
        now,
        store,
        // A deactivated user must NOT block cleanup of their token row.
        isUserActive: async () => false,
      }),
    ).resolves.toBe(true);
    expect(tickets.size).toBe(0);
  });

  it("refuses to revoke a token presented from a different origin", async () => {
    const { store, tickets } = memoryStore();
    const now = new Date("2030-01-01T00:00:00.000Z");
    const session = await issueWidgetSession({
      userId: "user-1",
      origin: "https://consumer.example",
      authMethod: "siwe",
      now,
      ttlSeconds: 60,
      store,
    });
    const request = new Request("https://portal.example/api/auth/sign-out", {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${session.token}`,
        Origin: "https://attacker.example",
      },
    });

    await expect(revokeWidgetSession({ request, now, store })).resolves.toBe(
      false,
    );
    expect(tickets.size).toBe(1);
  });
});
