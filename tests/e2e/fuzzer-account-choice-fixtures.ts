// Disposable loopback acceptance environment. Never point at a hosted database.
const databaseUrl = process.env.ACCOUNT_CHOICE_DATABASE_URL;
if (
  !databaseUrl ||
  process.env.AOMI_TEST_DATABASE_DISPOSABLE !== "1" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(new URL(databaseUrl).hostname)
) {
  throw new Error(
    "Require ACCOUNT_CHOICE_DATABASE_URL on loopback and AOMI_TEST_DATABASE_DISPOSABLE=1",
  );
}
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { privateKeyToAccount } from "viem/accounts";
import { buildSiweMessage } from "../../packages/client/src/siwe";
import { fixtureKeys } from "./fixture-wallets";
const require = createRequire(
  new URL("../../packages/account/package.json", import.meta.url),
);
const { Pool } = require("pg");
const db = new Pool({ connectionString: databaseUrl });
const portal = "http://127.0.0.1:3417",
  host = "http://127.0.0.1:3420";
const scopes = [
  "agent:read",
  "agent:write",
  "agent:actions:resolve",
  "offline_access",
];
await db.query(
  `insert into ba_oauth_resources(id,identifier,name,allowed_scopes,signing_algorithm,access_token_ttl,refresh_token_ttl,disabled,created_at,updated_at) values('fuzzer-agent',$1,'Agent',$2,'RS256',300,86400,false,now(),now()) on conflict(identifier) do nothing`,
  [portal + "/v1/agent", JSON.stringify(scopes)],
);
await db.query(
  `insert into ba_oauth_clients(id,client_id,name,disabled,skip_consent,redirect_uris,scopes,grant_types,response_types,token_endpoint_auth_method,application_type,require_p_k_c_e,dpop_bound_access_tokens,metadata,created_at,updated_at) values('fuzzer-local','fuzzer-local','Fuzzer local test',false,false,$1,$2,'["authorization_code","refresh_token"]','["code"]','none','web',true,true,'{"aomi_client_class":"partner_widget"}',now(),now()) on conflict(client_id) do update set redirect_uris=excluded.redirect_uris`,
  [JSON.stringify([host + "/auth/aomi"]), JSON.stringify(scopes)],
);
await db.query(
  `insert into ba_oauth_client_resources(id,client_id,resource_id) values('fuzzer-link','fuzzer-local',$1) on conflict do nothing`,
  [portal + "/v1/agent"],
);
async function post(path: string, body: unknown) {
  return fetch(portal + path, {
    method: "POST",
    headers: { origin: portal, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function login(index: number) {
  const account = privateKeyToAccount(fixtureKeys.evm[index]!);
  const nr = await post("/api/auth/siwe/nonce", {});
  const n = await nr.json();
  if (!nr.ok) throw new Error("nonce " + nr.status + JSON.stringify(n));
  const message = buildSiweMessage({
    address: account.address,
    chainId: 1,
    nonce: n.nonce,
    domain: "127.0.0.1:3417",
    uri: portal,
  });
  const response = await post("/api/auth/siwe/verify", {
    message,
    signature: await account.signMessage({ message }),
  });
  if (!response.ok)
    throw new Error("verify " + response.status + (await response.text()));
  const cookies = response.headers.getSetCookie();
  const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
  const profile = await fetch(portal + "/v1/account", {
    headers: { cookie, origin: portal },
  }).then((r) => r.json());
  if (!profile.user?.id) throw new Error("no canonical account");
  await db.query("update users set username=$1 where id=$2", [
    index === 0 ? "Cecilia (test)" : "Account B (test)",
    profile.user.id,
  ]);
  console.log(index === 0 ? "Cecilia fixture" : "B fixture", profile.user.id);
  return cookies;
}
const accounts = fixtureKeys.evm.map((key) => privateKeyToAccount(key));
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url!, "http://127.0.0.1:3419");
    res.setHeader("Cache-Control", "no-store");
    if (req.headers.origin === host) {
      res.setHeader("Access-Control-Allow-Origin", host);
      res.setHeader("Access-Control-Allow-Headers", "content-type");
    }
    if (req.method === "OPTIONS") {
      res.end();
      return;
    }
    if (url.pathname === "/wallet") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ address: accounts[0]!.address }));
      return;
    }
    if (
      url.pathname === "/sign" &&
      req.method === "POST" &&
      req.headers.origin === host
    ) {
      let data = "";
      for await (const c of req) data += c;
      const { message } = JSON.parse(data);
      if (
        !message.includes("Sign in to Aomi.") ||
        !message.includes("127.0.0.1:3420")
      )
        throw new Error("not local signin");
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          signature: await accounts[0]!.signMessage({ message }),
        }),
      );
      return;
    }
    if (url.pathname === "/portal/a" || url.pathname === "/portal/b") {
      res.setHeader(
        "set-cookie",
        await login(url.pathname.endsWith("/a") ? 0 : 1),
      );
      res.writeHead(302, { location: host + "/account-choice.html" });
      res.end();
      return;
    }
    if (url.pathname === "/portal/logout") {
      res.setHeader("set-cookie", [
        "better-auth.session_token=; Path=/; Max-Age=0",
        "better-auth.session_data=; Path=/; Max-Age=0",
      ]);
      res.writeHead(302, { location: host + "/account-choice.html" });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  } catch (e) {
    console.error(String(e));
    res.writeHead(500);
    res.end("fixture failed");
  }
});
server.listen(3419, "127.0.0.1", () =>
  console.log("Local fixture setup ready"),
);
