#!/usr/bin/env node
// Generate an Ed25519 keypair for the `aomi-edge` topology node.
//
// The private half is stored in 1Password and copied to the EDGE_SERVICE_PRIVATE_KEY
// secret of the matching aomi-labs/release GitHub Environment. Its deploy pushes it
// to the Worker on every deploy. Never run `wrangler secret put` by hand: a value
// set only on the Worker is stored nowhere else and cannot be recovered.
//
// The public half is committed in packages/service-identity/src/topologies.ts and product-mono's
// aomi/bin/{backend,api-server,payment}/service.<env>.toml. Commit it in the
// same change that stores the private half, so the two never drift.
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose";

const env = process.argv[2] ?? "<staging|rc|production>";
const { publicKey, privateKey } = await generateKeyPair("EdDSA", {
  extractable: true,
});
const spki = await exportSPKI(publicKey);
const pkcs8 = await exportPKCS8(privateKey);

process.stdout.write(`# public key (commit this)\n${spki}\n`);
process.stderr.write(
  `# private key (secret; never commit, never wrangler secret put)\n${pkcs8}\n` +
    `# Store it in 1Password and aomi-labs/release's GitHub Environment, then redeploy the edge:\n` +
    `#   gh secret set EDGE_SERVICE_PRIVATE_KEY -e ${env} -R aomi-labs/release   # paste the PEM\n`,
);
