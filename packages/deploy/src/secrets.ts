import type { SecretSlot } from "./types";

export type { SecretSlot };

/** Slots configured by the app Builder rather than each chat user. */
export function builderSecretSlots(
  slots: SecretSlot[] | undefined,
): SecretSlot[] {
  return (slots ?? []).filter((slot) => slot.user_own !== true);
}

/**
 * The required slots that have no value in the vault yet.
 *
 * `configuredKeys` are vault key NAMES (values are never readable). Matching is
 * case-sensitive because environment variable names are.
 */
export function missingRequiredSecrets(
  slots: SecretSlot[] | undefined,
  configuredKeys: string[],
): SecretSlot[] {
  const configured = new Set(configuredKeys);
  return builderSecretSlots(slots).filter(
    (slot) => slot.required && !configured.has(slot.name),
  );
}
