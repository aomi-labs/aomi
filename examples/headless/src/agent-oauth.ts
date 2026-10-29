import { Aomi, oauth } from "@aomi-labs/client";
import { fileGrants } from "@aomi-labs/client/node";

const baseUrl = process.env.AOMI_BASE_URL || "https://chat.aomi.dev";
const aomi = new Aomi({
  baseUrl,
  auth: oauth({
    // Without a clientId, the SDK registers a public device client.
    clientId: process.env.AOMI_OAUTH_CLIENT_ID,
    // Opt in to persistence; otherwise grants stay in memory.
    store: process.env.AOMI_GRANTS_FILE
      ? fileGrants(process.env.AOMI_GRANTS_FILE)
      : undefined,
    onCode: ({ url, code }) => console.log(`Open ${url} and enter ${code}`),
    timeoutMs: 60_000,
  }),
});
await aomi.auth.login();
const { reply, commits } = await aomi.agent
  .thread()
  .send("Say hello in one sentence.");
console.log(reply);
for (const commit of commits) commit.close();
