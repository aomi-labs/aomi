const RELOAD_KEY = "aomi:portal:client-recovery";
const RELOAD_COOLDOWN_MS = 60_000;

const recoverableMessages = [
  /chunkloaderror/i,
  /loading chunk [\s\S]* failed/i,
  /failed to fetch dynamically imported module/i,
  /importing a module script failed/i,
  /unable to preload css/i,
  /(^|: )load failed$/i,
];

export function isRecoverableClientError(error: Error): boolean {
  const message = `${error.name}: ${error.message}`;
  return recoverableMessages.some((pattern) => pattern.test(message));
}

export function claimClientReload(
  storage: Pick<Storage, "getItem" | "setItem">,
  now = Date.now(),
): boolean {
  try {
    const stored = storage.getItem(RELOAD_KEY);
    const previous = stored === null ? Number.NaN : Number(stored);
    if (Number.isFinite(previous) && now - previous < RELOAD_COOLDOWN_MS) {
      return false;
    }
    storage.setItem(RELOAD_KEY, String(now));
    return true;
  } catch {
    // Safari can deny storage access in constrained/private contexts. A
    // reload without a marker could loop forever, so leave recovery manual.
    return false;
  }
}
