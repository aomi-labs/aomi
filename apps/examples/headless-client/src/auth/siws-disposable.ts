/** SIWS auth-only smoke using a new, unfunded, in-memory Ed25519 key. */
import { generateKeyPairSync, sign } from "node:crypto";
import {
  Aomi,
  createAccountSessionProvider,
  createSiwsAccountAuthAdapter,
  type SiwsChainId,
} from "@aomi-labs/client";
import { createPortalOriginFetch } from "../shared/portal-origin-fetch";

const baseUrl = process.env.AOMI_BASE_URL?.trim() || "http://localhost:3000";
const chainId = process.env.AOMI_SIWS_CHAIN_ID?.trim() || "solana:mainnet";
if (!["solana:mainnet", "solana:devnet", "solana:testnet"].includes(chainId)) {
  throw new Error("AOMI_SIWS_CHAIN_ID must name a supported Solana cluster");
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const spki = publicKey.export({ format: "der", type: "spki" });
const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
if (!spki.subarray(0, spkiPrefix.length).equals(spkiPrefix)) {
  throw new Error("Unexpected Ed25519 public key encoding");
}
const address = base58Encode(spki.subarray(spkiPrefix.length));
const portalFetch = createPortalOriginFetch(baseUrl);
const accountSession = createAccountSessionProvider({
  baseUrl,
  fetch: portalFetch,
  adapter: createSiwsAccountAuthAdapter({
    getSigner: async () => ({
      address,
      chainId: chainId as SiwsChainId,
      signMessage: async (message) =>
        sign(null, Buffer.from(message, "utf8"), privateKey).toString("base64"),
    }),
  }),
});

try {
  // This invokes the public SIWS challenge and verify endpoints. The resulting
  // WST is then exercised against the Agent read API under the same Origin.
  const bearer = await accountSession();
  if (!bearer) throw new Error("SIWS verification returned no session");
  const aomi = new Aomi({
    baseUrl,
    guest: false,
    getAccountBearer: accountSession,
    fetch: portalFetch,
  });
  const sessions = await aomi.raw.agent.sessions.list({ limit: 1 });
  console.log(`SIWS account sign-in verified for ${address}`);
  console.log(
    `Agent session read succeeded (${sessions.sessions.length} visible)`,
  );
  console.log("No Solana transaction was created or submitted.");
} finally {
  accountSession.dispose();
}

function base58Encode(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let encoded = "";
  while (value > 0n) {
    encoded = alphabet[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded || "1";
}
