import { defineCommand } from "citty";
import { buildCliConfig, getPositionals, globalArgs } from "./shared";

const walletsUseDef = defineCommand({
  meta: {
    name: "use",
    description: "Make a wallet the active one for this session's thread",
  },
  args: {
    ...globalArgs,
    id: {
      type: "positional",
      description: "Wallet id from `aomi wallets` (w_…)",
      required: false,
    },
  },
  async run({ args }) {
    const { walletsUseCommand } = await import("../wallets");
    const ids = getPositionals(args);
    await walletsUseCommand(
      buildCliConfig(args),
      ids.length === 1 ? ids[0] : "",
    );
  },
});

/** Plural `wallets`: the account's wallets. Singular `wallet` stays this process's own signer. */
export const walletsDef = defineCommand({
  meta: {
    name: "wallets",
    description: "Account wallets",
  },
  args: { ...globalArgs },
  subCommands: { use: walletsUseDef },
  async run({ args }) {
    // citty also runs the parent after a matched subcommand.
    if (getPositionals(args)[0] === "use") return;
    const { walletsListCommand } = await import("../wallets");
    await walletsListCommand(buildCliConfig(args));
  },
});
