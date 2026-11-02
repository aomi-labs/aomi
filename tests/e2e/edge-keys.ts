/**
 * Development signing keys for the two bearer issuers the browser suites meet.
 * Both public halves are committed topology data; the private halves are the
 * checked-in development keys and secure nothing.
 */

/** The portal's development BFF key; its public half is in packages/account's topology. */
export const bffPrivateKey =
  "-----BEGIN PRIVATE KEY-----\n" +
  "MC4CAQAwBQYDK2VwBCIEIA3YGS2n6pAbisXZxFbDPdncGRxMXI2m4eJN2gNSf+wi\n" +
  "-----END PRIVATE KEY-----";

/**
 * The edge Worker's development key (topology node `aomi-edge`, kid
 * `aomi-edge-dev-1`); its public half is the `default` topology in
 * packages/service-identity/src/topologies.ts and apps/edge/.dev.vars.example carries it.
 */
export const edgePrivateKey =
  "-----BEGIN PRIVATE KEY-----\n" +
  "MC4CAQAwBQYDK2VwBCIEIAJez/5pUy9hG5xNVsHP+4GQ6ZgxHDdzFoZ2GwvkHgx/\n" +
  "-----END PRIVATE KEY-----";

/** kid → issuer for the bearers the fake upstream accepts. */
export const trustedDevIssuers: Record<
  string,
  { issuer: string; privateKey: string }
> = {
  "aomi-bff-dev-1": { issuer: "aomi-bff", privateKey: bffPrivateKey },
  "aomi-edge-dev-1": { issuer: "aomi-edge", privateKey: edgePrivateKey },
};
