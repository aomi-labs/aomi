export type SiweMessageInput = {
  address: string;
  chainId: number;
  nonce: string;
  domain: string;
  uri: string;
  issuedAt?: Date;
  expirationTime?: Date;
};

/** One sign-in payload for browser wallets, widget challenges and the CLI. */
export function buildSiweMessage(input: SiweMessageInput): string {
  const expiry = input.expirationTime
    ? `\nExpiration Time: ${input.expirationTime.toISOString()}`
    : "";
  return `${input.domain} wants you to sign in with your Ethereum account:
${input.address}

Sign in to Aomi.

URI: ${input.uri}
Version: 1
Chain ID: ${input.chainId}
Nonce: ${input.nonce}
Issued At: ${(input.issuedAt ?? new Date()).toISOString()}${expiry}`;
}

/** Linking is an explicit account mutation, with a distinct signed intent. */
export function buildWalletLinkMessage(input: SiweMessageInput): string {
  return `${input.domain} wants to link this wallet to your Aomi account:
${input.address}

Only sign this message if you want this wallet attached to the current Aomi account.

URI: ${input.uri}
Version: 1
Chain ID: ${input.chainId}
Nonce: ${input.nonce}
Issued At: ${(input.issuedAt ?? new Date()).toISOString()}`;
}
