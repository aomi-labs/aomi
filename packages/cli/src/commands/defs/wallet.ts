import { defineCommand } from "citty";
import { buildCliConfig, globalArgs } from "./shared";

const walletSetDef = defineCommand({
  meta: {
    name: "set",
    description:
      "Persist a signing key and derived wallet address. " +
      "Defaults to EVM (hex key). Pass --solana for a Solana keypair (base58).",
  },
  args: {
    privateKey: {
      type: "positional",
      description:
        "Hex EVM private key (default) or Solana base58 key when --solana is set",
      required: false,
    },
    evm: {
      type: "string",
      description: "EVM hex private key to persist (alternative to positional)",
      alias: ["e"],
    },
    solana: {
      type: "string",
      description: "Solana base58 secret key to persist",
      alias: ["s"],
    },
    cluster: {
      type: "string",
      description:
        'Solana cluster to persist with --solana: "mainnet-beta" (default), ' +
        '"devnet", or "testnet". Also accepts CAIP-2 form "solana:mainnet" etc.',
    },
  },
  async run({ args }) {
    const solanaKey = args.solana as string | undefined;
    if (solanaKey) {
      const { parseSvmCluster } = await import("./shared");
      const { setSvmWalletCommand } = await import("../preferences");
      setSvmWalletCommand(
        solanaKey,
        parseSvmCluster(args.cluster as string | undefined),
      );
      return;
    }
    if (args.cluster) {
      const { fatal } = await import("../../errors");
      fatal("`--cluster` only applies with `--solana`.");
    }

    // --evm flag or positional (backward-compat default = EVM)
    const evmKey = (args.evm as string | undefined) ?? args.privateKey;
    if (!evmKey) {
      const { fatal } = await import("../../errors");
      fatal(
        "Usage:\n" +
          "  aomi wallet set <evm-hex-key>          # EVM (default)\n" +
          "  aomi wallet set --evm <evm-hex-key>    # EVM (explicit)\n" +
          "  aomi wallet set --solana <base58-key>  # Solana",
      );
    }
    const { setWalletCommand } = await import("../preferences");
    setWalletCommand(evmKey!);
  },
});

const walletCurrentDef = defineCommand({
  meta: { name: "current", description: "Show the configured wallet address" },
  args: { ...globalArgs },
  async run({ args }) {
    const { currentWalletCommand } = await import("../control");
    currentWalletCommand(buildCliConfig(args));
  },
});

const walletWhoamiDef = defineCommand({
  meta: {
    name: "whoami",
    description: "Show the authenticated backend account",
  },
  args: { ...globalArgs },
  async run({ args }) {
    const { accountWhoamiCommand } = await import("../account");
    await accountWhoamiCommand(buildCliConfig(args));
  },
});

export const walletDef = defineCommand({
  meta: { name: "wallet", description: "Wallet configuration" },
  subCommands: {
    set: walletSetDef,
    current: walletCurrentDef,
    whoami: walletWhoamiDef,
  },
});
