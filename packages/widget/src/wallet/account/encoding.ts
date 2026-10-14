/** Encode a UTF-8 string to base64 (used for Solana `signMessage` payloads). */
export function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Encode a hex string (with or without a leading `0x`) to base64. Used for
 * Para's `signMessage`, which takes the message digest as a base64 payload.
 */
export function hexToBase64(hex: string): string {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  let binary = "";
  for (let index = 0; index < normalized.length; index += 2) {
    binary += String.fromCharCode(
      parseInt(normalized.slice(index, index + 2), 16),
    );
  }
  return btoa(binary);
}
