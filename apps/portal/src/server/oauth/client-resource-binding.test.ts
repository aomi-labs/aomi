import { describe, expect, it } from "vitest";

import {
  bindAomiPublicClientResource,
  type ClientResourceBindingDatabase,
} from "./client-resource-binding";

type RegisteredClient = {
  authMethod: string;
  grants: unknown;
};

class BindingDatabase implements ClientResourceBindingDatabase {
  readonly clients = new Map<string, RegisteredClient>();
  readonly resources = new Map<string, Set<string>>();
  readonly statements: string[] = [];
  releases = 0;

  async connect() {
    return {
      query: async <Row>(text: string, values: unknown[] = []) => {
        this.statements.push(text.trim().split(/\s+/).join(" "));
        if (text === "begin" || text === "commit" || text === "rollback") {
          return { rows: [] as Row[] };
        }
        const clientId = String(values[0] ?? "");
        if (text.includes("from ba_oauth_clients")) {
          const client = this.clients.get(clientId);
          return {
            rows: client
              ? ([
                  {
                    token_endpoint_auth_method: client.authMethod,
                    grant_types: client.grants,
                  },
                ] as Row[])
              : ([] as Row[]),
          };
        }
        if (text.includes("from ba_oauth_client_resources")) {
          return {
            rows: [...(this.resources.get(clientId) ?? [])].map(
              (resourceId) => ({ resource_id: resourceId }) as Row,
            ),
          };
        }
        if (text.includes("insert into ba_oauth_client_resources")) {
          const insertedClientId = String(values[1]);
          const resource = String(values[2]);
          const links =
            this.resources.get(insertedClientId) ?? new Set<string>();
          links.add(resource);
          this.resources.set(insertedClientId, links);
          return { rows: [] as Row[] };
        }
        throw new Error(`unexpected query: ${text}`);
      },
      release: () => {
        this.releases += 1;
      },
    };
  }
}

const agent = "https://portal.example/v1/agent/mcp";
const pipeline = "https://portal.example/v1/pipeline/mcp";

describe("public OAuth client resource binding", () => {
  it("atomically binds an unscoped public authorization-code client", async () => {
    const db = new BindingDatabase();
    db.clients.set("codex", {
      authMethod: "none",
      grants: ["authorization_code", "refresh_token"],
    });

    await expect(
      bindAomiPublicClientResource({ clientId: "codex", resource: agent, db }),
    ).resolves.toBe("bound");
    expect([...db.resources.get("codex")!]).toEqual([agent]);
    expect(
      db.statements.some((statement) => statement.includes("for update")),
    ).toBe(true);
    expect(db.statements.at(-1)).toBe("commit");
    expect(db.releases).toBe(1);
  });

  it("accepts only the existing exact resource after first use", async () => {
    const db = new BindingDatabase();
    db.clients.set("codex", {
      authMethod: "none",
      grants: JSON.stringify(["refresh_token", "authorization_code"]),
    });
    db.resources.set("codex", new Set([agent]));

    await expect(
      bindAomiPublicClientResource({ clientId: "codex", resource: agent, db }),
    ).resolves.toBe("already_bound");
    await expect(
      bindAomiPublicClientResource({
        clientId: "codex",
        resource: pipeline,
        db,
      }),
    ).resolves.toBe("resource_conflict");
    expect([...db.resources.get("codex")!]).toEqual([agent]);
    expect(db.statements.at(-1)).toBe("rollback");
  });

  it("never binds missing, confidential, or broader clients", async () => {
    const db = new BindingDatabase();
    db.clients.set("confidential", {
      authMethod: "client_secret_basic",
      grants: ["authorization_code", "refresh_token"],
    });
    db.clients.set("mixed", {
      authMethod: "none",
      grants: ["authorization_code", "refresh_token", "client_credentials"],
    });

    await expect(
      bindAomiPublicClientResource({
        clientId: "missing",
        resource: agent,
        db,
      }),
    ).resolves.toBe("client_not_found");
    await expect(
      bindAomiPublicClientResource({
        clientId: "confidential",
        resource: agent,
        db,
      }),
    ).resolves.toBe("client_not_eligible");
    await expect(
      bindAomiPublicClientResource({ clientId: "mixed", resource: agent, db }),
    ).resolves.toBe("client_not_eligible");
    expect(db.resources.size).toBe(0);
  });
});
