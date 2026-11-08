// INERT PREPARATION ONLY. No imports, I/O, signer, payment or default execution.
const PAYER = '0x12216f1365b9af24015baa158cc9e0d2354088a8';
const UINT256_MAX = (1n << 256n) - 1n;
const WINDOW_SECONDS = 604900n;
const BACKDATE_SECONDS = 600n;
const MAX_GENERATION_AGE_SECONDS = 30;
const FIELDS = [
  ['from', 'address'], ['to', 'address'], ['value', 'uint256'],
  ['validAfter', 'uint256'], ['validBefore', 'uint256'], ['nonce', 'bytes32'],
];

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

export const PREPARED_POLICIES = freeze({
  a_identity: {
    id: 'a_identity', payer: PAYER, chainId: 5042,
    payee: '0xd305607510e0db2c95807173c7a05bea53c1ed36',
    gateway: '0x77777777dcc4d5a8b6e418fd04d8997ef11000ee',
    amountMicro: 5000n, totalMicro: 15000n,
    slots: ['registered_owner', 'meridian', 'simon'],
  },
  shadow: {
    id: 'shadow', payer: PAYER, chainId: 5042002,
    payee: '0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0',
    gateway: '0x0077777d7eba4688bdef3e311b846f25870a19b9',
    amountMicro: 10000n, totalMicro: 10000n,
    slots: ['allowance_revocation'],
  },
});

function requireThat(condition, reason) {
  if (!condition) throw new Error(reason);
}

// Inspect own data descriptors, not getters; reject hidden/symbol/extra keys.
function record(value, keys, label) {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: object required`);
  const prototype = Object.getPrototypeOf(value);
  requireThat(prototype === Object.prototype || prototype === null, `${label}: plain object required`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  requireThat(ownKeys.length === keys.length && ownKeys.every(key => typeof key === 'string' && keys.includes(key)), `${label}: exact keys required`);
  const output = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    requireThat(descriptor && 'value' in descriptor && descriptor.enumerable, `${label}.${key}: enumerable data required`);
    output[key] = descriptor.value;
  }
  return output;
}

function array(value, length, label) {
  requireThat(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, `${label}: array required`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expected = ['length', ...Array.from({ length }, (_, index) => String(index))];
  requireThat(Reflect.ownKeys(descriptors).length === expected.length && expected.every(key => Object.hasOwn(descriptors, key)), `${label}: exact dense array required`);
  requireThat(descriptors.length.value === length, `${label}: exact length required`);
  return Array.from({ length }, (_, index) => {
    const descriptor = descriptors[String(index)];
    requireThat('value' in descriptor && descriptor.enumerable, `${label}: data elements required`);
    return descriptor.value;
  });
}

function hex(value, bytes, label) {
  requireThat(typeof value === 'string' && new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value), `${label}: exact hex required`);
  return value.toLowerCase();
}

function uint(value, label) {
  requireThat(typeof value === 'bigint' && value >= 0n && value <= UINT256_MAX, `${label}: uint256 bigint required`);
  return value;
}

function identifier(value, label) {
  requireThat(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(value), `${label}: bounded identifier required`);
  return value;
}

function reviewedPolicy(review) {
  const data = record(review, ['reference', 'authority', 'expectedPolicy'], 'review');
  identifier(data.reference, 'review.reference');
  requireThat(data.authority === 'none', 'review: preparation is not authority');
  const keys = ['id', 'payer', 'chainId', 'payee', 'gateway', 'amountMicro', 'totalMicro', 'slots'];
  const expected = record(data.expectedPolicy, keys, 'expectedPolicy');
  requireThat(typeof expected.id === 'string' && Object.hasOwn(PREPARED_POLICIES, expected.id), 'expectedPolicy: unknown pilot');
  const pinned = PREPARED_POLICIES[expected.id];
  for (const key of keys.filter(key => key !== 'slots')) {
    requireThat(expected[key] === pinned[key], `expectedPolicy.${key}: pinned value required`);
  }
  const slots = array(expected.slots, pinned.slots.length, 'expectedPolicy.slots');
  requireThat(slots.every((slot, index) => slot === pinned.slots[index]), 'expectedPolicy.slots: pinned cases required');
  return { policy: pinned, reference: data.reference };
}

/** Validate ONLY the unsigned SDK v1 typed-data shape. Caller supplies trusted clock.
 * No offer/asset/body validation, cryptographic signature check, or authority check.
 */
export function validateAuthorization(input) {
  const params = record(input, ['review', 'typedData', 'generatedAtSeconds', 'nowSeconds'], 'input');
  const { policy, reference } = reviewedPolicy(params.review);
  for (const key of ['generatedAtSeconds', 'nowSeconds']) {
    requireThat(Number.isSafeInteger(params[key]) && params[key] >= 600, `${key}: safe integer seconds required`);
  }
  const age = params.nowSeconds - params.generatedAtSeconds;
  requireThat(age >= 0 && age <= MAX_GENERATION_AGE_SECONDS, 'generation time: future or stale');
  const typed = record(params.typedData, ['domain', 'types', 'primaryType', 'message'], 'typedData');
  const domain = record(typed.domain, ['name', 'version', 'chainId', 'verifyingContract'], 'domain');
  requireThat(domain.name === 'GatewayWalletBatched' && domain.version === '1', 'domain: exact v1 name/version required');
  requireThat(Number.isSafeInteger(domain.chainId) && domain.chainId === policy.chainId, 'domain.chainId: wrong network');
  requireThat(hex(domain.verifyingContract, 20, 'domain.verifyingContract') === policy.gateway, 'domain.verifyingContract: wrong Gateway');
  requireThat(typed.primaryType === 'TransferWithAuthorization', 'primaryType: wrong value');
  const types = record(typed.types, ['TransferWithAuthorization'], 'types');
  const fields = array(types.TransferWithAuthorization, FIELDS.length, 'types.TransferWithAuthorization');
  fields.forEach((field, index) => {
    const item = record(field, ['name', 'type'], `type field ${index}`);
    requireThat(item.name === FIELDS[index][0] && item.type === FIELDS[index][1], `type field ${index}: wrong name/type/order`);
  });
  const message = record(typed.message, FIELDS.map(([name]) => name), 'message');
  const from = hex(message.from, 20, 'message.from');
  const to = hex(message.to, 20, 'message.to');
  requireThat(from === policy.payer && to === policy.payee, 'message: wrong payer/payee');
  const value = uint(message.value, 'message.value');
  const validAfter = uint(message.validAfter, 'message.validAfter');
  const validBefore = uint(message.validBefore, 'message.validBefore');
  requireThat(value === policy.amountMicro, 'message.value: exact proposed charge required');
  const generatedAt = BigInt(params.generatedAtSeconds);
  requireThat(validAfter === generatedAt - BACKDATE_SECONDS, 'message.validAfter: wrong backdate');
  requireThat(validBefore === generatedAt + WINDOW_SECONDS, 'message.validBefore: wrong or extended lifetime');
  const nonce = hex(message.nonce, 32, 'message.nonce');
  return freeze({
    authority: 'none', result: 'offline-policy-match-only', policyId: policy.id,
    reviewReference: reference,
    typedData: {
      domain: { name: domain.name, version: domain.version, chainId: policy.chainId, verifyingContract: policy.gateway },
      types: { TransferWithAuthorization: FIELDS.map(([name, type]) => ({ name, type })) },
      primaryType: 'TransferWithAuthorization', message: { from, to, value, validAfter, validBefore, nonce },
    },
  });
}

/** Process-local, irreversible OFFLINE reservations. Not durable payment accounting.
 * New instances reset state. Caller-supplied requestDigest does not prove body binding.
 */
export class PreparationReservationBook {
  #slots = new Set();
  #attempts = new Set();
  #requests = new Set();
  #nonces = new Set();
  #totals = { a_identity: 0n, shadow: 0n };

  reserve(input) {
    const item = record(input, ['validation', 'slotId', 'attemptId', 'requestDigest'], 'reservation');
    const checked = validateAuthorization(item.validation);
    const policy = PREPARED_POLICIES[checked.policyId];
    identifier(item.attemptId, 'attemptId');
    requireThat(policy.slots.includes(item.slotId), 'slotId: unknown case');
    const requestDigest = hex(item.requestDigest, 32, 'requestDigest');
    const nonce = checked.typedData.message.nonce;
    const slotKey = `${policy.id}:${item.slotId}`;
    requireThat(!this.#slots.has(slotKey), 'slotId: duplicate or replacement attempt');
    requireThat(!this.#attempts.has(item.attemptId), 'attemptId: already reserved');
    requireThat(!this.#requests.has(requestDigest), 'requestDigest: already reserved');
    requireThat(!this.#nonces.has(nonce), 'nonce: already reserved');
    const nextTotal = this.#totals[policy.id] + checked.typedData.message.value;
    requireThat(nextTotal <= policy.totalMicro, 'budget: exhausted');
    // Commit all checks synchronously. No release, replacement, reset or import API.
    this.#slots.add(slotKey);
    this.#attempts.add(item.attemptId);
    this.#requests.add(requestDigest);
    this.#nonces.add(nonce);
    this.#totals[policy.id] = nextTotal;
    return freeze({ ...checked, slotId: item.slotId, attemptId: item.attemptId, requestDigest, reservedTotalMicro: nextTotal });
  }

  snapshot() {
    return freeze({ authority: 'none', scope: 'this-instance-only', totalsMicro: { ...this.#totals }, slots: [...this.#slots] });
  }
}
