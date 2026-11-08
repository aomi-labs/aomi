// Origin-local storage for the browser TaskClient. No network or wallet access.
// Initialization/reopen are explicit. There is no reset, delete, release or
// replacement API. Private Task proofs/capabilities stay in this origin's IDB.
const MAIN_DB = 'aomi-shadow-task-journal-v1';
const PAYER = '0x12216f1365b9af24015baa158cc9e0d2354088a8';
const check = (value, code) => { if (!value) throw Error(code); };
const reqResult = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(Error('JOURNAL_REQUEST_FAILED'));
});
const clone = value => structuredClone(value);
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const plainObject = value => value !== null && typeof value === 'object' &&
  Object.getPrototypeOf(value) === Object.prototype;
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { check(Number.isFinite(value), 'JOURNAL_STATE_NOT_JSON'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  check(plainObject(value), 'JOURNAL_STATE_NOT_JSON');
  return `{${Object.keys(value).sort().filter(key => value[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
function validState(value) {
  check(plainObject(value) && value.version === 2 && plainObject(value.policy) &&
    plainObject(value.request), 'JOURNAL_STATE_OBJECT_VERSION_POLICY_REQUEST_REQUIRED');
  return value;
}
function reservationRow(entry) {
  const row = clone(entry);
  check(plainObject(row) && Object.keys(row).sort().join(',') === 'amountMicro,attemptHash,chainId,nonceHash,payer,requestDigest', 'JOURNAL_RESERVATION_FIELDS');
  check(row.amountMicro === '10000' && row.chainId === 5042002 && row.payer === PAYER &&
    [row.attemptHash, row.nonceHash, row.requestDigest].every(v => /^[a-f0-9]{64}$/.test(v)), 'JOURNAL_RESERVATION_POLICY');
  return row;
}
function done(tx) {
  const promise = new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(Error('JOURNAL_TRANSACTION_FAILED'));
  });
  promise.catch(() => {}); // caller awaits the same promise after request errors
  return promise;
}
export async function openBrowserJournal({ mode, expectedJournalId, fixtureDatabaseName } = {}) {
  check(['initialize', 'reopen', 'fixture-initialize', 'fixture-reopen'].includes(mode), 'JOURNAL_EXPLICIT_MODE_REQUIRED');
  const fixture = mode.startsWith('fixture-'), initialize = mode.endsWith('initialize');
  check(fixture ? typeof fixtureDatabaseName === 'string' && fixtureDatabaseName.startsWith('shadow-offline-fixture-') && idPattern.test(fixtureDatabaseName.slice(23)) : fixtureDatabaseName === undefined,
    'JOURNAL_DATABASE_OVERRIDE_FORBIDDEN');
  check(initialize ? expectedJournalId === undefined : idPattern.test(expectedJournalId ?? ''), 'JOURNAL_ID_REQUIRED');
  check(globalThis.isSecureContext && globalThis.indexedDB && globalThis.navigator?.locks, 'JOURNAL_SECURE_IDB_AND_WEB_LOCKS_REQUIRED');
  const dbName = fixture ? fixtureDatabaseName : MAIN_DB;
  const opening = indexedDB.open(dbName, 1);
  opening.onupgradeneeded = () => {
    if (!initialize) { opening.transaction.abort(); return; }
    for (const store of ['meta', 'state', 'reservation']) opening.result.createObjectStore(store);
  };
  const db = await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) { value?.close(); return; }
      settled = true; clearTimeout(timer); error ? reject(Error(error)) : resolve(value);
    };
    const timer = setTimeout(() => finish('JOURNAL_OPEN_TIMEOUT_NO_REPLACEMENT'), 10000);
    opening.onblocked = () => finish('JOURNAL_OPEN_BLOCKED_NO_REPLACEMENT');
    opening.onerror = () => finish(initialize ? 'JOURNAL_OPEN_FAILED' : 'JOURNAL_REOPEN_FAILED_NO_REPLACEMENT');
    opening.onsuccess = () => finish(null, opening.result);
  });
  let active = false, closed = false, uncertain = false;
  /** @type {string} */
  let journalId;
  db.onversionchange = () => { closed = true; db.close(); };
  db.onclose = () => { closed = true; uncertain = true; };
  async function withLock(work) {
    check(!closed && !uncertain && !active, 'JOURNAL_CLOSED_BUSY_OR_UNCERTAIN');
    return navigator.locks.request(dbName, { mode: 'exclusive', ifAvailable: true }, async lock => {
      check(lock, 'JOURNAL_IN_USE');
      check(!closed && !uncertain && !active, 'JOURNAL_CLOSED_BUSY_OR_UNCERTAIN');
      active = true;
      try { return await work(); } finally { active = false; }
    });
  }
  async function transaction(stores, write, work) {
    check(active && !closed && !uncertain, 'JOURNAL_LOCK_REQUIRED');
    let tx;
    try {
      tx = db.transaction(stores, write ? 'readwrite' : 'readonly', write ? { durability: 'strict' } : undefined);
      if (write) check(tx.durability === 'strict', 'JOURNAL_STRICT_DURABILITY_REQUIRED');
      const completion = done(tx);
      try { const value = await work(tx); await completion; return value; }
      catch (e) { try { tx.abort(); } catch {} await completion.catch(() => {}); throw e; }
    } catch (e) {
      if (write) uncertain = true;
      throw Error(typeof e?.message === 'string' && e.message.startsWith('JOURNAL_') ? e.message : 'JOURNAL_STORAGE_UNCERTAIN');
    }
  }
  try {
    await withLock(() => transaction(initialize ? ['meta', 'state', 'reservation'] : ['meta'], initialize, async tx => {
      const store = tx.objectStore('meta'), existing = await reqResult(store.get('root'));
      if (initialize) {
        check(existing === undefined, 'JOURNAL_ALREADY_EXISTS_NO_RESET');
        check(await reqResult(store.count()) === 0 &&
          await reqResult(tx.objectStore('state').count()) === 0 &&
          await reqResult(tx.objectStore('reservation').count()) === 0,
          'JOURNAL_ORPHAN_RECORDS_NO_REPLACEMENT');
        journalId = crypto.randomUUID();
        await reqResult(store.add({ schema: 1, journalId, fixture, payer: PAYER, chainId: 5042002,
          stateWritten: false, jobIdentityHash: null, proofSubmission: { proofHash: null, count: 0 } }, 'root'));
      } else {
        check(existing && existing.schema === 1 && existing.journalId === expectedJournalId && existing.fixture === fixture && existing.payer === PAYER && existing.chainId === 5042002, 'JOURNAL_IDENTITY_MISMATCH');
        journalId = existing.journalId;
      }
    }));
  } catch (e) { db.close(); throw e; }
  const metaFrom = async tx => {
    const meta = await reqResult(tx.objectStore('meta').get('root'));
    check(meta?.schema === 1 && meta.journalId === journalId && meta.fixture === fixture && meta.payer === PAYER && meta.chainId === 5042002, 'JOURNAL_IDENTITY_MISMATCH');
    return meta;
  };
  async function load() {
    return transaction(['meta', 'state'], false, async tx => {
      const meta = await metaFrom(tx), state = await reqResult(tx.objectStore('state').get('root'));
      check(!meta.stateWritten || state !== undefined, 'JOURNAL_STATE_MISSING_NO_REPLACEMENT');
      check(meta.stateWritten || state === undefined, 'JOURNAL_STATE_WITHOUT_MARKER');
      return state === undefined ? null : clone(validState(state));
    });
  }
  async function exists() { return (await load()) !== null; }
  async function save(value) {
    let snapshot, encoded;
    try { snapshot = validState(clone(value)); encoded = canonical(snapshot); }
    catch (e) { throw Error(e?.message?.startsWith('JOURNAL_') ? e.message : 'JOURNAL_STATE_NOT_JSON'); }
    check(new TextEncoder().encode(encoded).length <= 6 * 1024 * 1024, 'JOURNAL_STATE_TOO_LARGE');
    return transaction(['meta', 'state'], true, async tx => {
      const meta = await metaFrom(tx);
      const previous = await reqResult(tx.objectStore('state').get('root'));
      check(meta.stateWritten ? previous !== undefined : previous === undefined,
        'JOURNAL_STATE_MISSING_OR_UNMARKED_NO_REPLACEMENT');
      if (previous !== undefined) {
        validState(previous);
        check(canonical(previous.policy) === canonical(snapshot.policy) &&
          canonical(previous.request) === canonical(snapshot.request), 'JOURNAL_POLICY_OR_REQUEST_REPLACEMENT_FORBIDDEN');
        for (const kind of ['preparation', 'retrieval']) {
          check(previous[kind]?.id === snapshot[kind]?.id, 'JOURNAL_PAYMENT_ID_REPLACEMENT_FORBIDDEN');
        }
      }
      await reqResult(tx.objectStore('state').put(snapshot, 'root'));
      await reqResult(tx.objectStore('meta').put({ ...meta, stateWritten: true }, 'root'));
    });
  }
  async function reserveUnsigned(entry) {
    const row = reservationRow(entry);
    return transaction(['meta', 'state', 'reservation'], true, async tx => {
      const meta = await metaFrom(tx);
      const state = await reqResult(tx.objectStore('state').get('root'));
      check(meta.stateWritten && state !== undefined, 'JOURNAL_TASK_STATE_REQUIRED');
      validState(state);
      const store = tx.objectStore('reservation');
      check(await reqResult(store.get('root')) === undefined, 'JOURNAL_ALREADY_RESERVED_NO_REPLACEMENT');
      await reqResult(store.add(row, 'root'));
      return Object.freeze({ reserved: true, amountMicro: row.amountMicro, requestDigest: row.requestDigest });
    });
  }
  async function assertReservation(entry) {
    const expected = reservationRow(entry);
    return transaction(['meta', 'state', 'reservation'], false, async tx => {
      const meta = await metaFrom(tx);
      const state = await reqResult(tx.objectStore('state').get('root'));
      check(meta.stateWritten && state !== undefined, 'JOURNAL_TASK_STATE_REQUIRED');
      validState(state);
      const existing = await reqResult(tx.objectStore('reservation').get('root'));
      check(existing !== undefined && canonical(reservationRow(existing)) === canonical(expected),
        'JOURNAL_RESERVATION_MISSING_OR_MISMATCH');
      return Object.freeze({ reserved: true, amountMicro: expected.amountMicro, requestDigest: expected.requestDigest });
    });
  }
  async function recordProofSubmission(entry) {
    const row = clone(entry);
    check(plainObject(row) && Object.keys(row).sort().join(',') === 'nonceHash,proofHash,requestDigest' &&
      Object.values(row).every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)),
      'JOURNAL_SUBMISSION_FIELDS');
    return transaction(['meta', 'state', 'reservation'], true, async tx => {
      const meta = await metaFrom(tx);
      const state = await reqResult(tx.objectStore('state').get('root'));
      check(meta.stateWritten && state !== undefined, 'JOURNAL_TASK_STATE_REQUIRED'); validState(state);
      const existing = await reqResult(tx.objectStore('reservation').get('root'));
      check(existing !== undefined, 'JOURNAL_RESERVATION_MISSING_OR_MISMATCH');
      const reserved = reservationRow(existing);
      check(reserved.requestDigest === row.requestDigest && reserved.nonceHash === row.nonceHash,
        'JOURNAL_RESERVATION_MISSING_OR_MISMATCH');
      const counter = meta.proofSubmission;
      check(plainObject(counter) && Number.isInteger(counter.count) && counter.count >= 0 && counter.count <= 2 &&
        (counter.count === 0 ? counter.proofHash === null : /^[a-f0-9]{64}$/.test(counter.proofHash)),
        'JOURNAL_SUBMISSION_COUNTER_MISSING_OR_INVALID_NO_RESET');
      check(counter.proofHash === null || counter.proofHash === row.proofHash,
        'JOURNAL_PROOF_REPLACEMENT_FORBIDDEN');
      check(counter.count < 2, 'JOURNAL_SUBMISSION_LIMIT_REACHED');
      const count = counter.count + 1;
      await reqResult(tx.objectStore('meta').put({ ...meta, proofSubmission: { proofHash: row.proofHash, count } }, 'root'));
      return Object.freeze({ submissions: count });
    });
  }
  async function recordJobIdentity(entry) {
    const row = clone(entry);
    check(plainObject(row) && Object.keys(row).sort().join(',') === 'jobIdentityHash,proofHash' &&
      Object.values(row).every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)),
      'JOURNAL_JOB_IDENTITY_FIELDS');
    return transaction(['meta', 'state'], true, async tx => {
      const meta = await metaFrom(tx), state = await reqResult(tx.objectStore('state').get('root'));
      check(meta.stateWritten && state !== undefined, 'JOURNAL_TASK_STATE_REQUIRED'); validState(state);
      const counter = meta.proofSubmission;
      check(plainObject(counter) && Number.isInteger(counter.count) && counter.count >= 1 && counter.count <= 2 && counter.proofHash === row.proofHash,
        'JOURNAL_JOB_PROOF_NOT_SUBMITTED');
      check(Object.hasOwn(meta, 'jobIdentityHash') && (meta.jobIdentityHash === null ||
        (typeof meta.jobIdentityHash === 'string' && /^[a-f0-9]{64}$/.test(meta.jobIdentityHash))),
        'JOURNAL_JOB_IDENTITY_MISSING_OR_INVALID_NO_RESET');
      const matched = meta.jobIdentityHash !== null;
      check(!matched || meta.jobIdentityHash === row.jobIdentityHash, 'JOURNAL_JOB_IDENTITY_CHANGED');
      if (!matched) await reqResult(tx.objectStore('meta').put({ ...meta, jobIdentityHash: row.jobIdentityHash }, 'root'));
      return Object.freeze({ matched });
    });
  }
  async function assertJobIdentity(entry) {
    const row = clone(entry);
    check(plainObject(row) && Object.keys(row).sort().join(',') === 'jobIdentityHash,proofHash' &&
      Object.values(row).every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)),
      'JOURNAL_JOB_IDENTITY_FIELDS');
    return transaction(['meta', 'state'], false, async tx => {
      const meta = await metaFrom(tx), state = await reqResult(tx.objectStore('state').get('root'));
      check(meta.stateWritten && state !== undefined, 'JOURNAL_TASK_STATE_REQUIRED'); validState(state);
      const counter = meta.proofSubmission;
      check(plainObject(counter) && Number.isInteger(counter.count) && counter.count >= 1 && counter.count <= 2 && counter.proofHash === row.proofHash,
        'JOURNAL_JOB_PROOF_NOT_SUBMITTED');
      check(typeof meta.jobIdentityHash === 'string' && /^[a-f0-9]{64}$/.test(meta.jobIdentityHash),
        'JOURNAL_JOB_IDENTITY_MISSING_OR_INVALID_NO_RESET');
      check(meta.jobIdentityHash === row.jobIdentityHash, 'JOURNAL_JOB_IDENTITY_CHANGED');
      return Object.freeze({ matched: true });
    });
  }
  async function inspectSummary() {
    return withLock(() => transaction(['meta', 'reservation'], false, async tx => {
      const meta = await metaFrom(tx), reserved = await reqResult(tx.objectStore('reservation').get('root'));
      return Object.freeze({ journalId, fixture, initialized: true, stateWritten: meta.stateWritten, reserved: reserved !== undefined,
        reservedMicro: reserved?.amountMicro ?? '0', proofSubmissions: meta.proofSubmission?.count ?? null, payer: PAYER, chainId: 5042002 });
    }));
  }
  function close() { check(!active, 'JOURNAL_BUSY'); closed = true; db.close(); }
  return Object.freeze({ journalId, fixture, withLock, load, save, exists, reserveUnsigned, assertReservation, recordProofSubmission, recordJobIdentity, assertJobIdentity, inspectSummary, close });
}
