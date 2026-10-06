import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const ORIGINAL_ENV = { ...process.env };

const EVM_ADDRESS = "0x5D907BEa404e6F821d467314a9cA07663CF64c9B";
const SVM_KP = Keypair.generate();
const SVM_ADDRESS = SVM_KP.publicKey.toBase58();
const SVM_SECRET = bs58.encode(SVM_KP.secretKey);

describe("wallet current / wallet set contracts", () => {
  let stateDir: string;
  let logged: string[];

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    stateDir = mkdtempSync(join(tmpdir(), "aomi-cli-wallet-"));
    process.env.AOMI_STATE_DIR = stateDir;
    logged = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      logged.push(String(line));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
    rmSync(stateDir, { recursive: true, force: true });
  });

  async function writeSessionState(
    state: Record<string, unknown>,
  ): Promise<void> {
    const { SESSIONS_DIR } = await import("../../src/cli/state");
    mkdirSync(SESSIONS_DIR, { recursive: true });
    writeFileSync(
      join(SESSIONS_DIR, "session-1.json"),
      JSON.stringify({ sessionId: "test", localId: 1, ...state }, null, 2),
    );
    writeFileSync(join(stateDir, "active-session.txt"), "1");
  }

  function lastJson(): unknown {
    const raw = logged.find((line) => line.trimStart().startsWith("{"));
    expect(raw).toBeDefined();
    return JSON.parse(raw!);
  }

  it("emits {active:false, wallets:[]} with no session", async () => {
    const { currentWalletCommand } = await import(
      "../../src/cli/commands/control"
    );
    currentWalletCommand({ json: true, secrets: {} });
    expect(lastJson()).toEqual({ active: false, wallets: [] });
  });

  it("emits an empty wallet list for a session with no wallets", async () => {
    await writeSessionState({ baseUrl: "https://api.aomi.dev" });
    const { currentWalletCommand } = await import(
      "../../src/cli/commands/control"
    );
    currentWalletCommand({ json: true, secrets: {} });
    expect(lastJson()).toEqual({ active: true, wallets: [] });
  });

  it("emits the exact EVM-only shape", async () => {
    await writeSessionState({
      baseUrl: "https://api.aomi.dev",
      publicKey: EVM_ADDRESS,
      privateKey: "0xdeadbeef",
      chainId: 1,
    });
    const { currentWalletCommand } = await import(
      "../../src/cli/commands/control"
    );
    currentWalletCommand({ json: true, secrets: {} });
    expect(lastJson()).toEqual({
      active: true,
      wallets: [
        {
          family: "evm",
          address: EVM_ADDRESS,
          chainId: 1,
          hasSavedSigner: true,
        },
      ],
    });
  });

  it("emits the exact SVM-only shape with the canonical family name", async () => {
    await writeSessionState({
      baseUrl: "https://api.aomi.dev",
      svmPublicKey: SVM_ADDRESS,
      svmPrivateKey: SVM_SECRET,
      svmCluster: "solana:devnet",
    });
    const { currentWalletCommand } = await import(
      "../../src/cli/commands/control"
    );
    currentWalletCommand({ json: true, secrets: {} });
    expect(lastJson()).toEqual({
      active: true,
      wallets: [
        {
          family: "svm",
          address: SVM_ADDRESS,
          cluster: "solana:devnet",
          hasSavedSigner: true,
        },
      ],
    });
  });

  it("emits both families, EVM first", async () => {
    await writeSessionState({
      baseUrl: "https://api.aomi.dev",
      publicKey: EVM_ADDRESS,
      chainId: 8453,
      svmPublicKey: SVM_ADDRESS,
      svmCluster: "solana:mainnet",
    });
    const { currentWalletCommand } = await import(
      "../../src/cli/commands/control"
    );
    currentWalletCommand({ json: true, secrets: {} });
    expect(lastJson()).toEqual({
      active: true,
      wallets: [
        {
          family: "evm",
          address: EVM_ADDRESS,
          chainId: 8453,
          hasSavedSigner: false,
        },
        {
          family: "svm",
          address: SVM_ADDRESS,
          cluster: "solana:mainnet",
          hasSavedSigner: false,
        },
      ],
    });
  });

  it("wallet set --solana persists mainnet by default and prints the cluster", async () => {
    const { setSvmWalletCommand } = await import(
      "../../src/cli/commands/preferences"
    );
    const { CliSession } = await import("../../src/cli/cli-session");

    setSvmWalletCommand(SVM_SECRET);

    expect(CliSession.load()?.svmCluster).toBe("solana:mainnet");
    expect(
      logged.some((line) =>
        line.includes(`Solana wallet set to ${SVM_ADDRESS} (cluster solana:mainnet)`),
      ),
    ).toBe(true);
  });

  it("wallet set --solana --cluster devnet persists devnet and a re-set preserves it", async () => {
    const { setSvmWalletCommand } = await import(
      "../../src/cli/commands/preferences"
    );
    const { CliSession } = await import("../../src/cli/cli-session");

    setSvmWalletCommand(SVM_SECRET, "solana:devnet");
    expect(CliSession.load()?.svmCluster).toBe("solana:devnet");

    // Re-setting the key without a cluster keeps the previous choice.
    setSvmWalletCommand(SVM_SECRET);
    expect(CliSession.load()?.svmCluster).toBe("solana:devnet");
  });
});
