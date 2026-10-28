#!/usr/bin/env node
// Generate an Ed25519 keypair for the `aomi-edge` topology node. Paste the
// public key into src/topology-data.ts and product-mono's
// aomi/bin/{backend,api-server,payment}/service.<env>.toml; store the private
// key with `wrangler secret put EDGE_SERVICE_PRIVATE_KEY --name aomi-edge-<env>`.
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose";

const { publicKey, privateKey } = await generateKeyPair("EdDSA", {
  extractable: true,
});
const spki = await exportSPKI(publicKey);
const pkcs8 = await exportPKCS8(privateKey);

process.stdout.write(`# public key (commit this)\n${spki}\n`);
process.stderr.write(
  `# private key (secret; never commit)\n${pkcs8}\n` +
    `# wrangler secret put EDGE_SERVICE_PRIVATE_KEY --name aomi-edge-staging   # then paste the PEM\n`,
);
