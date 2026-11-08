// Browser-only byte/verification helpers. No network, wallet or private key.
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export const utf8 = value => encoder.encode(value);
export const text = value => decoder.decode(value);
export async function hash(value) {
  const bytes = typeof value === 'string' ? utf8(value) : value;
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))]
    .map(n => n.toString(16).padStart(2, '0')).join('');
}
export function toBase64(value) {
  let binary = '';
  for (let i = 0; i < value.length; i += 32768)
    binary += String.fromCharCode(...value.subarray(i, i + 32768));
  return btoa(binary);
}
export function fromBase64(value) {
  if (typeof value !== 'string' || value.length > 6 * 1024 * 1024 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new Error('Invalid bounded base64');
  const decoded = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (toBase64(decoded) !== value) throw new Error('Noncanonical base64');
  return decoded;
}
export function fromBase64Url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1)
    throw new Error('Invalid base64url');
  return fromBase64(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4));
}
export function concatBytes(chunks) {
  const total = chunks.reduce((sum, v) => sum + v.byteLength, 0);
  const out = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}
export async function verifyEd25519(jwk, message, signature) {
  if (Object.hasOwn(jwk, 'd')) throw new Error('Public verification key required');
  const key = await globalThis.crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['verify']);
  return globalThis.crypto.subtle.verify({ name: 'Ed25519' }, key, signature, message);
}
