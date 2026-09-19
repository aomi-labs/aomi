// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const baseDatabaseUrl = process.env.AOMI_AUTH_TEST_DATABASE_URL?.trim();
const schemaName = `aomi_oauth_device_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = baseDatabaseUrl
  ? withSearchPath(baseDatabaseUrl, schemaName)
  : undefined;
const describePostgres = isLoopbackPostgres(baseDatabaseUrl)
  ? describe
  : describe.skip;
const origin = "http://localhost:3001";
const deviceGrant = "urn:ietf:params:oauth:grant-type:device_code";
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalBetterAuthUrl = process.env.BETTER_AUTH_URL;

describePostgres("production Better Auth OAuth device route", () => {
  let pool: ReturnType<typeof import("@aomi-labs/account").getPool>;
  let route: typeof import("./[...all]/route");

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.BETTER_AUTH_URL = origin;
    const account = await import("@aomi-labs/account");
    pool = account.getPool();
    await pool.query(`create schema "${schemaName}"`);
    await createAuthSchema(pool);
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      route = await import("./[...all]/route");
    } finally {
      process.env.NODE_ENV = nodeEnv;
    }
  });

  afterAll(async () => {
    try {
      await pool?.query(`drop schema if exists "${schemaName}" cascade`);
    } finally {
      try {
        await pool?.end();
      } finally {
        restoreEnv("DATABASE_URL", originalDatabaseUrl);
        restoreEnv("BETTER_AUTH_URL", originalBetterAuthUrl);
      }
    }
  });

  it.each([
    ["Agent REST", `${origin}/v1/agent`, "agent:read offline_access"],
    [
      "Pipeline REST",
      `${origin}/v1/pipeline`,
      "pipeline:catalog offline_access",
    ],
  ])("completes DCR through token for %s", async (_name, resource, scope) => {
    const registration = await jsonRequest("/oauth2/register", {
      client_name: `Aomi CLI integration ${randomUUID()}`,
      token_endpoint_auth_method: "none",
      grant_types: [deviceGrant, "refresh_token"],
      resources: [resource],
      scope,
    });
    expect(registration.response.status).toBe(201);
    const clientId = requiredString(registration.body, "client_id");

    const issued = await formRequest("/device/code", {
      client_id: clientId,
      resource,
      scope,
    });
    expect(issued.response.status).toBe(200);
    const deviceCode = requiredString(issued.body, "device_code");
    const userCode = requiredString(issued.body, "user_code");

    const signedIn = await jsonRequest("/sign-in/anonymous", {});
    expect(signedIn.response.status).toBe(200);
    const sessionCookie = responseCookie(signedIn.response);
    const user = recordValue(signedIn.body, "user");
    expect(requiredString(user, "id")).not.toBe("");

    const verified = await getRequest(
      `/device?${new URLSearchParams({ user_code: userCode })}`,
      sessionCookie,
    );
    expect(verified.response.status).toBe(200);
    expect(verified.body).toMatchObject({
      user_code: userCode,
      status: "pending",
      client_id: clientId,
      scope,
      resource,
    });

    const approved = await jsonRequest(
      "/device/approve",
      { userCode },
      sessionCookie,
    );
    expect(approved.response.status).toBe(200);
    expect(approved.body).toEqual({ success: true });

    const token = await formRequest("/oauth2/token", {
      grant_type: deviceGrant,
      device_code: deviceCode,
      client_id: clientId,
      resource,
    });
    expect(token.response.status).toBe(200);
    expect(requiredString(token.body, "access_token")).not.toBe("");
    expect(requiredString(token.body, "refresh_token")).not.toBe("");
    expect(token.body).toMatchObject({
      token_type: "Bearer",
      scope,
    });
  });

  async function jsonRequest(
    path: string,
    body: Record<string, unknown>,
    cookie?: string,
  ) {
    return dispatch(
      new Request(`${origin}/api/auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  }

  async function formRequest(path: string, body: Record<string, string>) {
    return dispatch(
      new Request(`${origin}/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body),
      }),
    );
  }

  async function getRequest(path: string, cookie: string) {
    return dispatch(
      new Request(`${origin}/api/auth${path}`, {
        headers: { cookie },
      }),
    );
  }

  async function dispatch(request: Request) {
    const response =
      request.method === "GET"
        ? await route.GET(request)
        : await route.POST(request);
    const body = (await response.json().catch(() => null)) as unknown;
    return { response, body };
  }
});

function requiredString(value: unknown, key: string): string {
  const record = recordValue(value);
  const result = record[key];
  if (typeof result !== "string" || !result) {
    throw new Error(`missing_${key}`);
  }
  return result;
}

function recordValue(value: unknown, key?: string): Record<string, unknown> {
  const candidate =
    key && value && typeof value === "object"
      ? (value as Record<string, unknown>)[key]
      : value;
  if (!candidate || typeof candidate !== "object") {
    throw new Error(`missing_${key ?? "record"}`);
  }
  return candidate as Record<string, unknown>;
}

function responseCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("missing_session_cookie");
  return setCookie.split(";", 1)[0] ?? "";
}

async function createAuthSchema(
  pool: ReturnType<typeof import("@aomi-labs/account").getPool>,
) {
  await pool.query(`
    create table if not exists users (
      id text primary key,
      username text unique,
      status text not null default 'active',
      created_at bigint not null,
      updated_at bigint not null
    );
    create table if not exists auth_providers (
      id bigserial primary key,
      user_id text not null references users (id) on delete cascade,
      provider text not null,
      issuer_environment text not null,
      tenant_id text not null,
      subject text,
      method text not null,
      value text not null,
      verified_at bigint,
      is_primary boolean not null default false,
      provider_metadata jsonb not null default '{}'::jsonb,
      created_at bigint not null,
      updated_at bigint not null
    );
    create unique index if not exists auth_provider_device_test_subject
      on auth_providers (provider, issuer_environment, tenant_id, subject)
      where subject is not null;
    create table if not exists ba_users (
      id text primary key,
      name text not null,
      email text not null unique,
      email_verified boolean not null,
      image text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      is_anonymous boolean
    );
    create table if not exists ba_sessions (
      id text primary key,
      expires_at timestamptz not null,
      token text not null unique,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null,
      ip_address text,
      user_agent text,
      user_id text not null references ba_users (id) on delete cascade
    );
    create table if not exists ba_accounts (
      id text primary key,
      account_id text not null,
      provider_id text not null,
      issuer text not null,
      user_id text not null references ba_users (id) on delete cascade,
      access_token text,
      refresh_token text,
      id_token text,
      access_token_expires_at timestamptz,
      refresh_token_expires_at timestamptz,
      scope text,
      password text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null
    );
    create table if not exists ba_verifications (
      id text primary key,
      identifier text not null,
      value text not null,
      expires_at timestamptz not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table if not exists ba_wallet_addresses (
      id text primary key,
      user_id text not null references ba_users (id) on delete cascade,
      address text not null,
      chain_id integer not null,
      is_primary boolean not null,
      created_at timestamptz not null
    );
    create table if not exists ba_jwks (
      id text primary key,
      public_key text not null,
      private_key text not null,
      created_at timestamptz not null,
      expires_at timestamptz,
      alg text,
      crv text
    );
    create table if not exists ba_oauth_clients (
      id text primary key,
      client_id text not null unique,
      client_secret text,
      client_discovery_id text,
      disabled boolean,
      skip_consent boolean,
      enable_end_session boolean,
      subject_type text,
      scopes jsonb,
      client_credentials_scopes jsonb,
      user_id text references ba_users (id) on delete cascade,
      created_at timestamptz,
      updated_at timestamptz,
      name text,
      uri text,
      icon text,
      contacts jsonb,
      tos text,
      policy text,
      software_id text,
      software_version text,
      software_statement text,
      redirect_uris jsonb not null,
      post_logout_redirect_uris jsonb,
      backchannel_logout_uri text,
      backchannel_logout_session_required boolean,
      token_endpoint_auth_method text,
      application_type text,
      jwks text,
      jwks_uri text,
      grant_types jsonb,
      response_types jsonb,
      require_p_k_c_e boolean,
      dpop_bound_access_tokens boolean,
      reference_id text,
      metadata jsonb
    );
    create table if not exists ba_oauth_resources (
      id text primary key,
      identifier text not null unique,
      name text not null,
      access_token_ttl integer,
      refresh_token_ttl integer,
      signing_algorithm text,
      signing_key_id text,
      allowed_scopes jsonb,
      custom_claims jsonb,
      dpop_bound_access_tokens_required boolean,
      disabled boolean,
      created_at timestamptz,
      updated_at timestamptz,
      policy_version integer,
      metadata jsonb
    );
    create table if not exists ba_oauth_client_resources (
      id text primary key,
      client_id text not null references ba_oauth_clients (client_id) on delete cascade,
      resource_id text not null references ba_oauth_resources (identifier) on delete cascade,
      metadata jsonb,
      created_at timestamptz,
      unique (client_id, resource_id)
    );
    create table if not exists ba_oauth_refresh_tokens (
      id text primary key,
      token text not null unique,
      client_id text not null references ba_oauth_clients (client_id) on delete cascade,
      session_id text references ba_sessions (id) on delete set null,
      user_id text not null references ba_users (id) on delete cascade,
      reference_id text,
      authorization_code_id text,
      resources jsonb,
      requested_user_info_claims jsonb,
      expires_at timestamptz not null,
      created_at timestamptz not null,
      revoked timestamptz,
      rotated_at timestamptz,
      rotation_replay_response text,
      rotation_replay_expires_at timestamptz,
      auth_time timestamptz,
      confirmation jsonb,
      scopes jsonb not null
    );
    create table if not exists ba_oauth_access_tokens (
      id text primary key,
      token text not null unique,
      client_id text not null references ba_oauth_clients (client_id) on delete cascade,
      session_id text references ba_sessions (id) on delete set null,
      user_id text references ba_users (id) on delete cascade,
      reference_id text,
      authorization_code_id text,
      resources jsonb,
      requested_user_info_claims jsonb,
      refresh_id text references ba_oauth_refresh_tokens (id) on delete cascade,
      expires_at timestamptz not null,
      created_at timestamptz not null,
      revoked timestamptz,
      confirmation jsonb,
      scopes jsonb not null
    );
    create table if not exists ba_oauth_consents (
      id text primary key,
      client_id text not null references ba_oauth_clients (client_id) on delete cascade,
      user_id text references ba_users (id) on delete cascade,
      reference_id text,
      resources jsonb,
      requested_user_info_claims jsonb,
      scopes jsonb not null,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );
    create table if not exists ba_oauth_client_assertions (
      id text primary key,
      expires_at timestamptz not null
    );
    create table if not exists ba_oauth_device_codes (
      id text primary key,
      device_code text not null unique,
      user_code text not null unique,
      user_id text,
      expires_at timestamptz not null,
      status text not null,
      last_polled_at timestamptz,
      polling_interval integer,
      client_id text,
      scope text,
      resources jsonb,
      oauth_client_id text
    );
  `);
}

function isLoopbackPostgres(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function withSearchPath(databaseUrl: string, schema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("options", `-csearch_path=${schema}`);
  return url.toString();
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
