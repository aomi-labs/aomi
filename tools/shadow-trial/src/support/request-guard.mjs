// Unsigned preparation only. No wallet, network, filesystem, SDK or default run.
import { PREPARED_POLICIES, PreparationReservationBook } from './authorization-policy.mjs';

const ASSET = '0x3600000000000000000000000000000000000000';
const A_URL = 'https://a-identity.xyz/api/x402/gateway/tools/risk_check';
const S_URL = 'https://api-staging.aomi.dev/v1/task/build';
const MAX_BYTES = 32768;
const encoder = new TextEncoder();
const CASES = Object.freeze({
  registered_owner: '{"agentId":"0xd305607510e0db2c95807173c7a05bea53c1ed36","txContext":{"amountUsd":25}}',
  meridian: '{"agentId":"0x4e26Ae66840134Ac5979c56ba2509F3956b93431","txContext":{"amountUsd":1500}}',
  simon: '{"agentId":"0x03f1fb189E461B88f3e8bA7100B29B594E5f98A9","txContext":{"amountUsd":25}}',
});
const fail = code => { throw new Error(code); };
const check = (condition, code) => { if (!condition) fail(code); };
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
function object(value, allowed, required, label) {
  check(value && typeof value === 'object' && !Array.isArray(value), `${label}_OBJECT_REQUIRED`);
  check([null, Object.prototype].includes(Object.getPrototypeOf(value)), `${label}_PLAIN_OBJECT_REQUIRED`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  check(Reflect.ownKeys(descriptors).every(key => typeof key === 'string' && allowed.includes(key)), `${label}_UNKNOWN_FIELD`);
  check(required.every(key => Object.hasOwn(descriptors, key)), `${label}_MISSING_FIELD`);
  const copy = Object.create(null);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    check('value' in descriptor && descriptor.enumerable, `${label}_DATA_REQUIRED`);
    copy[key] = descriptor.value;
  }
  return copy;
}
function dense(value, limit, label) {
  check(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, `${label}_ARRAY_REQUIRED`);
  const descriptors = Object.getOwnPropertyDescriptors(value), length = descriptors.length.value;
  check(Number.isSafeInteger(length) && length > 0 && length <= limit, `${label}_LENGTH`);
  check(Reflect.ownKeys(descriptors).length === length + 1, `${label}_EXTRA_OR_SPARSE`);
  return Array.from({ length }, (_, index) => {
    const d = descriptors[index]; check(d && 'value' in d && d.enumerable, `${label}_DATA_REQUIRED`); return d.value;
  });
}
function address(value) {
  check(typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value), 'INVALID_ADDRESS');
  return value.toLowerCase();
}
function boundedText(value, limit, label) {
  check(typeof value === 'string' && value.length > 0 && value.length <= limit && !value.includes('\0'), `${label}_INVALID`);
  return value;
}
async function digest(text) {
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(text)));
  return '0x' + [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// Canonicalizing only parsed, bounded JSON data does not authorize its contents.
function canonical(value, depth = 0) {
  check(depth <= 12, 'JSON_TOO_DEEP');
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { check(Number.isFinite(value), 'JSON_INVALID_NUMBER'); return JSON.stringify(value); }
  if (typeof value === 'string') { check(value.length <= MAX_BYTES, 'JSON_STRING_TOO_LARGE'); return JSON.stringify(value); }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return '[' + dense(value, 64, 'JSON_ARRAY').map(x => canonical(x, depth + 1)).join(',') + ']';
  }
  check(value && typeof value === 'object', 'JSON_VALUE_REQUIRED');
  const keys = Reflect.ownKeys(value);
  check(keys.length <= 64 && keys.every(key => typeof key === 'string' && key.length <= 128), 'JSON_KEYS_INVALID');
  const copy = object(value, keys, keys, 'JSON');
  return '{' + keys.sort().map(key => JSON.stringify(key) + ':' + canonical(copy[key], depth + 1)).join(',') + '}';
}

function offerFor(policy, url, supplied) {
  const required = ['scheme', 'network', 'asset', 'amount', 'payTo', 'maxTimeoutSeconds', 'extra'];
  const offer = object(supplied, [...required, 'resource'], required, 'OFFER');
  check(offer.scheme === 'exact' && offer.network === `eip155:${policy.chainId}`, 'OFFER_RAIL_CHANGED');
  check(address(offer.asset) === ASSET && address(offer.payTo) === policy.payee, 'OFFER_ASSET_OR_PAYEE_CHANGED');
  check(offer.amount === policy.amountMicro.toString(), 'OFFER_AMOUNT_CHANGED');
  const expectedTimeout = policy.id === 'shadow' ? 300 : 3600;
  check(offer.maxTimeoutSeconds === expectedTimeout, 'OFFER_TIMEOUT_CHANGED');
  if (Object.hasOwn(offer, 'resource')) check(offer.resource === url, 'OFFER_RESOURCE_CHANGED');
  const baseExtra = ['name', 'version', 'verifyingContract', 'minValiditySeconds'];
  const extra = object(offer.extra, [...baseExtra, 'assets', 'registryWallet', 'domainVerified', 'provenAt'], baseExtra, 'EXTRA');
  check(extra.name === 'GatewayWalletBatched' && extra.version === '1', 'OFFER_DOMAIN_CHANGED');
  check(address(extra.verifyingContract) === policy.gateway, 'OFFER_GATEWAY_CHANGED');
  check(extra.minValiditySeconds === 604800, 'OFFER_MINIMUM_VALIDITY_CHANGED');
  if (Object.hasOwn(extra, 'assets')) {
    const assets = dense(extra.assets, 1, 'ASSETS');
    const asset = object(assets[0], ['symbol', 'address', 'decimals'], ['symbol', 'address', 'decimals'], 'ASSET');
    check(asset.symbol === 'USDC' && address(asset.address) === ASSET && asset.decimals === 6, 'OFFER_ASSET_METADATA_CHANGED');
  }
  if (Object.hasOwn(extra, 'registryWallet')) check(address(extra.registryWallet) === policy.gateway, 'OFFER_REGISTRY_CHANGED');
  if (Object.hasOwn(extra, 'domainVerified')) check(extra.domainVerified === true, 'OFFER_DOMAIN_UNVERIFIED');
  if (Object.hasOwn(extra, 'provenAt')) {
    check(typeof extra.provenAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(extra.provenAt), 'OFFER_PROVEN_AT_INVALID');
  }
  // Only these inspected payment fields reach a future SDK. Informational
  // provider metadata is not a source of authority or a live registry check.
  return freeze({ scheme: 'exact', network: `eip155:${policy.chainId}`, asset: ASSET,
    amount: policy.amountMicro.toString(), payTo: policy.payee, maxTimeoutSeconds: expectedTimeout,
    extra: { name: 'GatewayWalletBatched', version: '1', verifyingContract: policy.gateway, minValiditySeconds: 604800 } });
}

async function makeGuard(policyId, slotId, bodyUtf8, caseBoundary) {
  const policy = PREPARED_POLICIES[policyId], url = policyId === 'shadow' ? S_URL : A_URL;
  check(policy.slots.includes(slotId), 'UNREVIEWED_CASE');
  check(encoder.encode(bodyUtf8).length <= MAX_BYTES, 'BODY_TOO_LARGE');
  const descriptor = freeze({ method: 'POST', url, contentType: 'application/json', bodyUtf8 });
  const requestDigest = await digest('aomi-pilot-request-v1\0POST\0' + url + '\0application/json\0' + bodyUtf8);
  const bodySha256 = await digest(bodyUtf8);
  function validateDescriptor(input) {
    const d = object(input, ['method', 'url', 'contentType', 'bodyUtf8'], ['method', 'url', 'contentType', 'bodyUtf8'], 'REQUEST');
    check(Object.keys(descriptor).every(key => d[key] === descriptor[key]), 'REQUEST_BYTES_OR_ROUTE_CHANGED');
    return freeze({ authority: 'none', requestDigest, bodySha256, descriptor });
  }
  function validateOffer(offer) { return offerFor(policy, url, offer); }
  function validateChallenge(headerObject, bodyObject) {
    const h = canonical(headerObject), b = canonical(bodyObject);
    check(encoder.encode(h).length <= MAX_BYTES && encoder.encode(b).length <= MAX_BYTES, 'CHALLENGE_TOO_LARGE');
    check(h === b, 'HEADER_BODY_CHALLENGE_MISMATCH');
    const p = object(headerObject, ['x402Version', 'resource', 'accepts', 'error', 'tool'], ['x402Version', 'resource', 'accepts'], 'CHALLENGE');
    check(p.x402Version === 2, 'CHALLENGE_VERSION_CHANGED');
    const resource = object(p.resource, ['url', 'mimeType', 'description'], ['url', 'mimeType'], 'RESOURCE');
    check(resource.url === url && resource.mimeType === 'application/json', 'CHALLENGE_RESOURCE_CHANGED');
    if (Object.hasOwn(resource, 'description')) boundedText(resource.description, 8192, 'DESCRIPTION');
    const offers = dense(p.accepts, policyId === 'shadow' ? 1 : 8, 'OFFERS');
    const matching = offers.filter(offer => offer && offer.network === `eip155:${policy.chainId}`);
    check(matching.length === 1, 'EXPECTED_NETWORK_OFFER_NOT_UNIQUE');
    return validateOffer(matching[0]);
  }
  async function inspectFetchRequest(input, init, phase = 'unsigned') {
    check(phase === 'unsigned' || phase === 'proof-present', 'TRANSPORT_PHASE_INVALID');
    const req = new Request(input, init);
    check(req.redirect === 'error' && req.credentials === 'omit', 'TRANSPORT_REDIRECT_OR_CREDENTIALS_UNSAFE');
    const allowedHeaders = phase === 'unsigned' ? ['content-type'] : ['content-type', 'payment-signature'];
    check([...req.headers.keys()].every(key => allowedHeaders.includes(key)), 'TRANSPORT_EXTRA_HEADER');
    check(phase !== 'proof-present' || !!req.headers.get('payment-signature'), 'TRANSPORT_PAYMENT_HEADER_REQUIRED');
    const bytes = await req.clone().arrayBuffer();
    check(bytes.byteLength <= MAX_BYTES, 'TRANSPORT_BODY_TOO_LARGE');
    let body;
    try { body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { fail('TRANSPORT_BODY_INVALID_UTF8'); }
    validateDescriptor({ method: req.method, url: req.url, contentType: req.headers.get('content-type'), bodyUtf8: body });
    return freeze({ authority: 'none', requestDigest, bodySha256, policyId, slotId });
  }
  function reserveUnsigned({ offer, typedData, generatedAtSeconds, nowSeconds, attemptId, reviewReference, book }) {
    validateOffer(offer);
    check(book instanceof PreparationReservationBook, 'EXISTING_RESERVATION_BOOK_REQUIRED');
    // Derived digest cannot be replaced by an opaque caller-provided label.
    return PreparationReservationBook.prototype.reserve.call(book, { validation: { review: { reference: reviewReference, authority: 'none', expectedPolicy: policy },
      typedData, generatedAtSeconds, nowSeconds }, slotId, attemptId, requestDigest });
  }
  return freeze({ authority: 'none', policyId, slotId, descriptor, requestDigest, bodySha256, caseBoundary,
    validateDescriptor, validateOffer, validateChallenge, inspectFetchRequest, reserveUnsigned });
}

export function createAIdentityRequestGuard(slotId) {
  check(typeof slotId === 'string' && Object.hasOwn(CASES, slotId), 'UNREVIEWED_A_IDENTITY_CASE');
  return makeGuard('a_identity', slotId, CASES[slotId], 'Assessment inputs only; current server semantics and live trial remain unverified.');
}

export function createShadowRequestGuard(caseInput) {
  const c = object(caseInput, ['sender', 'token', 'spender', 'reviewReference'], ['sender', 'token', 'spender', 'reviewReference'], 'SHADOW_CASE');
  const sender = address(c.sender), token = address(c.token), spender = address(c.spender);
  check([sender, token, spender].every(value => value !== '0x' + '0'.repeat(40)), 'SHADOW_ZERO_ADDRESS');
  boundedText(c.reviewReference, 256, 'CASE_REFERENCE');
  const body = JSON.stringify({
    executionKind: 'eoa_transactions', transactionSafetyMode: 'guarded_only',
    intent: `Prepare and simulate exactly one ERC-20 allowance revocation on Arc Testnet: call approve(${spender}, 0) on ${token} from ${sender}. Do not transfer funds, increase any approval, create any other call, sign, or broadcast. The task must have zero outgoing USDC. Return the unsigned result for review.`,
    chainId: 5042002, sender, payer: PREPARED_POLICIES.shadow.payer,
    // Pinned server prepare.rs rejects explicit calls in EOA mode. The planner
    // receives this exact intent; the returned action still needs strict review.
    constraints: { maxOutgoingUsdcWei: '0', allowedTargets: [token] },
  });
  return makeGuard('shadow', 'allowance_revocation', body,
    `EOA planning request for exactly one revocation; returned action requires semantic verification. Reference ${c.reviewReference} does not prove positive starting allowance or grant trial authority.`);
}
