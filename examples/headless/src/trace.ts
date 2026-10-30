import { Aomi, wallet } from "@aomi-labs/client";
import { decode } from "@aomi-labs/client/trace";
import { privateKeyToAccount } from "viem/accounts";

const baseUrl = process.env.AOMI_BASE_URL || "https://chat.aomi.dev";
if (!process.env.AOMI_PRIVATE_KEY)
  throw new Error("Set a throwaway AOMI_PRIVATE_KEY");
const account = privateKeyToAccount(
  process.env.AOMI_PRIVATE_KEY as `0x${string}`,
);
const aomi = new Aomi({ baseUrl, auth: wallet(account) });
const turn = aomi.agent
  .thread()
  .send("Use a tool to get the current ETH price in USD.");
for await (const step of turn.steps({ decode })) {
  console.log(
    step.outcome,
    step.title,
    step.chips.map((chip) => chip.label).join(" · "),
  );
}
const { reply, commits } = await turn;
console.log(reply);
for (const commit of commits) commit.close();
