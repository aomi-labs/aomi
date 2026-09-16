import { describe, expect, it } from "vitest";
import { recoverAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  parseEvmPrivateKey,
  signEvmRawHash,
} from "../../src/cli/evm-signer";

describe("EVM sign-at-edge signer", () => {
  it("signs a raw hash so it recovers to the signer (round-trip)", async () => {
    const pk = generatePrivateKey();
    const address = privateKeyToAccount(pk).address;
    const hash = `0x${"ab".repeat(32)}`;

    const { signer, signature } = await signEvmRawHash(hash, pk);

    expect(signer).toBe(address);
    const recovered = await recoverAddress({
      hash: hash as `0x${string}`,
      signature: signature as `0x${string}`,
    });
    expect(recovered.toLowerCase()).toBe(address.toLowerCase());
  });

  it("agrees with the backend verify_edge_signature vector", async () => {
    // The exact (hash, sig, address) the Rust `verify_edge_signature` test
    // asserts on (auth/auto_sign.rs). Recovering it here proves a CLI-produced
    // signature and the kernel's verification are byte-for-byte compatible.
    const hash =
      "0xe294650284379f572c6f3bdd06cbda86c18768aa3bd466487acca985754b1299";
    const sig =
      "0xbe37496e77592a12f173d1d20289c179d2b33b52b54a8a0c385ba02fc07b33522453db8466d993612678e82c1f0a4124a6e54f3eae42006f416b42813b6f76c21c";

    const recovered = await recoverAddress({ hash, signature: sig });
    expect(recovered.toLowerCase()).toBe(
      "0x7ddc29a55b0e68b1488bda3f6ca1282bff022622",
    );
  });

  it("rejects a malformed key or payload", async () => {
    expect(() => parseEvmPrivateKey("nope")).toThrow();
    await expect(signEvmRawHash("0x1234", generatePrivateKey())).rejects.toThrow();
  });
});
