import { createRequire } from "node:module";
import type { Page } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";

const portalRequire = createRequire(
  new URL("../../apps/portal/package.json", import.meta.url),
);
const bs58 = portalRequire("bs58").default as {
  decode(value: string): Uint8Array;
  encode(value: Uint8Array): string;
};
const nacl = portalRequire("tweetnacl") as {
  sign: {
    keyPair: {
      fromSeed(value: Uint8Array): {
        publicKey: Uint8Array;
        secretKey: Uint8Array;
      };
      fromSecretKey(value: Uint8Array): {
        publicKey: Uint8Array;
        secretKey: Uint8Array;
      };
    };
    detached(message: Uint8Array, secretKey: Uint8Array): Uint8Array;
  };
};

export const BURN_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ONE_WEI_DISPLAY = "0.000000000000000001";
export type WalletFamily = "evm" | "svm";

export function hostedPortalUrl(): string {
  const raw = process.env.AOMI_HOSTED_E2E_PORTAL_URL;
  if (!raw) throw new Error("AOMI_HOSTED_E2E_PORTAL_URL is required");
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Hosted Portal URL must be an HTTPS origin");
  }
  if (url.hostname !== "chat-staging.aomi.dev")
    throw new Error(
      "Hosted wallet E2E only permits the trusted staging Portal",
    );
  return url.origin;
}

function evmAccount(privateKey = process.env.AOMI_HOSTED_E2E_EVM_PRIVATE_KEY) {
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error(
      "AOMI_HOSTED_E2E_EVM_PRIVATE_KEY must be a disposable 32-byte test key",
    );
  }
  return privateKeyToAccount(privateKey as `0x${string}`);
}

export function hostedEvmAddress(): string {
  return evmAccount().address;
}

function svmAccount(raw = process.env.AOMI_HOSTED_E2E_SVM_SECRET_KEY) {
  if (!raw)
    throw new Error("AOMI_HOSTED_E2E_SVM_SECRET_KEY is required for SIWS");
  const bytes = raw.trim().startsWith("[")
    ? Uint8Array.from(JSON.parse(raw) as number[])
    : bs58.decode(raw);
  if (bytes.length !== 32 && bytes.length !== 64)
    throw new Error("SIWS key must contain 32 seed or 64 secret-key bytes");
  const keyPair =
    bytes.length === 32
      ? nacl.sign.keyPair.fromSeed(bytes)
      : nacl.sign.keyPair.fromSecretKey(bytes);
  return {
    address: bs58.encode(keyPair.publicKey),
    secretKey: keyPair.secretKey,
  };
}

export async function installHostedWallet(
  page: Page,
  family: WalletFamily,
  chainId = 84532,
) {
  const portal = hostedPortalUrl();
  return installBrowserWallet(page, {
    family,
    chainId,
    pageOrigin: portal,
    challengeOrigin: portal,
    evmPrivateKeys:
      family === "evm"
        ? [process.env.AOMI_HOSTED_E2E_EVM_PRIVATE_KEY!]
        : undefined,
    svmSecretKey:
      family === "svm" ? process.env.AOMI_HOSTED_E2E_SVM_SECRET_KEY : undefined,
  });
}

export async function installBrowserWallet(
  page: Page,
  options: {
    family: WalletFamily;
    pageOrigin: string;
    challengeOrigin: string;
    chainId?: number;
    evmPrivateKeys?: string[];
    svmSecretKey?: string;
    rejectSignatures?: boolean;
  },
) {
  const family = options.family;
  const chainId = options.chainId ?? 84532;
  const accounts =
    family === "evm"
      ? (options.evmPrivateKeys ?? []).map((key) => evmAccount(key))
      : [svmAccount(options.svmSecretKey)];
  if (accounts.length === 0) throw new Error("Wallet fixture has no accounts");
  const address = accounts[0].address;
  const blocked: string[] = [];
  let signatures = 0;

  await page.exposeBinding(
    "__aomiHostedWallet",
    async (
      { frame },
      request: {
        kind: "evm-sign" | "svm-sign" | "blocked";
        message?: string;
        method?: string;
      },
    ) => {
      if (frame.url() && new URL(frame.url()).origin !== options.pageOrigin) {
        throw new Error("Wallet request came from another origin");
      }
      if (request.kind === "blocked") {
        blocked.push(request.method ?? "unknown execution");
        throw new Error(
          "Transaction signing and broadcasting are forbidden in hosted wallet E2E",
        );
      }
      const message = request.message ?? "";
      if (options.rejectSignatures) {
        throw new Error("User rejected the wallet signature");
      }
      const challengeHost = new URL(options.challengeOrigin).host;
      if (
        (!message.startsWith(
          `${challengeHost} wants you to sign in with your `,
        ) &&
          !message.startsWith(
            `${challengeHost} wants to link this wallet to your Aomi account:`,
          )) ||
        !message.includes(`URI: ${options.challengeOrigin}`) ||
        !message.includes("Nonce:")
      ) {
        throw new Error("Only this Portal's sign-in challenge may be signed");
      }
      signatures++;
      if (family === "evm" && request.kind === "evm-sign") {
        const signer = accounts.find((candidate) =>
          message.toLowerCase().includes(candidate.address.toLowerCase()),
        );
        if (!signer) throw new Error("Sign-in challenge address mismatch");
        return (signer as ReturnType<typeof evmAccount>).signMessage({
          message,
        });
      }
      if (family === "svm" && request.kind === "svm-sign") {
        if (!message.includes(address))
          throw new Error("Sign-in challenge address mismatch");
        return Array.from(
          nacl.sign.detached(
            new TextEncoder().encode(message),
            (accounts[0] as ReturnType<typeof svmAccount>).secretKey,
          ),
        );
      }
      throw new Error("Wallet family and signature request disagree");
    },
  );

  await page.addInitScript(
    ({ family, addresses, chainId }) => {
      type WalletBridge = (request: {
        kind: string;
        message?: string;
        method?: string;
      }) => Promise<unknown>;
      const bridge = (window as unknown as { __aomiHostedWallet: WalletBridge })
        .__aomiHostedWallet;
      if (family === "evm") {
        const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
        let connected = false;
        let activeIndex = 0;
        const activeAddress = () => addresses[activeIndex];
        const emit = (name: string, value: unknown) =>
          listeners.get(name)?.forEach((listener) => listener(value));
        const provider = {
          isMetaMask: true,
          isConnected: () => connected,
          on(name: string, listener: (...args: unknown[]) => void) {
            const set = listeners.get(name) ?? new Set();
            set.add(listener);
            listeners.set(name, set);
            return provider;
          },
          removeListener(name: string, listener: (...args: unknown[]) => void) {
            listeners.get(name)?.delete(listener);
            return provider;
          },
          async request({
            method,
            params,
          }: {
            method: string;
            params?: unknown[];
          }) {
            if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
            if (method === "net_version") return String(chainId);
            if (method === "eth_accounts")
              return connected ? [activeAddress()] : [];
            if (method === "eth_requestAccounts") {
              connected = true;
              emit("connect", { chainId: `0x${chainId.toString(16)}` });
              emit("accountsChanged", [activeAddress()]);
              return [activeAddress()];
            }
            if (
              method === "wallet_requestPermissions" ||
              method === "wallet_getPermissions"
            )
              return [{ parentCapability: "eth_accounts", caveats: [] }];
            if (method === "wallet_getCapabilities") return {};
            if (method === "wallet_switchEthereumChain") {
              if (
                (params?.[0] as { chainId?: string })?.chainId !==
                `0x${chainId.toString(16)}`
              )
                throw new Error("Test wallet is pinned to its staging chain");
              return null;
            }
            if (method === "personal_sign") {
              const raw = String(params?.[0] ?? "");
              const bytes = raw.startsWith("0x")
                ? Uint8Array.from(
                    raw
                      .slice(2)
                      .match(/../g)
                      ?.map((byte) => parseInt(byte, 16)) ?? [],
                  )
                : new TextEncoder().encode(raw);
              return bridge({
                kind: "evm-sign",
                message: new TextDecoder().decode(bytes),
              });
            }
            return bridge({ kind: "blocked", method });
          },
        };
        Object.defineProperty(window, "ethereum", {
          configurable: true,
          value: provider,
        });
        Object.defineProperty(window, "__aomiWalletFixtureSwitch", {
          configurable: true,
          value: (index: number) => {
            if (
              !Number.isInteger(index) ||
              index < 0 ||
              index >= addresses.length
            )
              throw new Error("Wallet fixture account index is out of range");
            activeIndex = index;
            connected = true;
            emit("accountsChanged", [activeAddress()]);
          },
        });
        const announce = () =>
          window.dispatchEvent(
            new CustomEvent("eip6963:announceProvider", {
              detail: {
                info: {
                  uuid: "a0b1c2d3-e4f5-4678-9000-000000000001",
                  name: "MetaMask",
                  icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
                  rdns: "io.metamask",
                },
                provider,
              },
            }),
          );
        window.addEventListener("eip6963:requestProvider", announce);
        announce();
        return;
      }

      const address = addresses[0];
      const publicKey = Uint8Array.from(addressBytes(address));
      const account = Object.freeze({
        address,
        publicKey,
        chains: ["solana:devnet", "solana:mainnet", "solana:testnet"],
        features: ["solana:signMessage", "solana:signTransaction"],
      });
      const listeners = new Set<(event: { accounts: unknown[] }) => void>();
      const wallet = {
        version: "1.0.0",
        name: "Phantom",
        icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
        chains: account.chains,
        accounts: [] as (typeof account)[],
        features: {
          "standard:connect": {
            version: "1.0.0",
            connect: async () => {
              wallet.accounts = [account];
              listeners.forEach((listener) =>
                listener({ accounts: wallet.accounts }),
              );
              return { accounts: wallet.accounts };
            },
          },
          "standard:disconnect": {
            version: "1.0.0",
            disconnect: async () => {
              wallet.accounts = [];
              listeners.forEach((listener) => listener({ accounts: [] }));
            },
          },
          "standard:events": {
            version: "1.0.0",
            on: (
              _event: string,
              listener: (event: { accounts: unknown[] }) => void,
            ) => {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
          },
          "solana:signMessage": {
            version: "1.0.0",
            signMessage: async (...inputs: Array<{ message: Uint8Array }>) =>
              Promise.all(
                inputs.map(async (input) => ({
                  signedMessage: input.message,
                  signature: Uint8Array.from(
                    (await bridge({
                      kind: "svm-sign",
                      message: new TextDecoder().decode(input.message),
                    })) as number[],
                  ),
                })),
              ),
          },
          "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: ["legacy", 0],
            signTransaction: async () =>
              bridge({ kind: "blocked", method: "solana:signTransaction" }),
          },
        },
      };
      window.addEventListener("wallet-standard:app-ready", ((
        event: CustomEvent<{ register: (...wallets: unknown[]) => void }>,
      ) => {
        event.detail.register(wallet);
      }) as EventListener);
      // Wallet Standard also supports the app loading before the wallet.
      window.dispatchEvent(
        new CustomEvent("wallet-standard:register-wallet", {
          detail: (api: { register: (...wallets: unknown[]) => void }) =>
            api.register(wallet),
        }),
      );

      function addressBytes(value: string): number[] {
        const alphabet =
          "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
        let number = 0n;
        for (const digit of value)
          number = number * 58n + BigInt(alphabet.indexOf(digit));
        const out = Array.from({ length: 32 }, () => 0);
        for (let i = 31; i >= 0; i--) {
          out[i] = Number(number & 255n);
          number >>= 8n;
        }
        return out;
      }
    },
    { family, addresses: accounts.map((account) => account.address), chainId },
  );

  return {
    address,
    addresses: accounts.map((account) => account.address),
    blocked,
    switchAccount: async (index: number) => {
      await page.evaluate((nextIndex) => {
        (
          window as unknown as {
            __aomiWalletFixtureSwitch?: (value: number) => void;
          }
        ).__aomiWalletFixtureSwitch?.(nextIndex);
      }, index);
    },
    get signatureCount() {
      return signatures;
    },
  };
}
