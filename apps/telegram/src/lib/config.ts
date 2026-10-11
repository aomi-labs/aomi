/** Trimmed env value, treating a blank var as unset. A var created empty in the
 *  Vercel dashboard is a string, not `undefined`, so `??` would hand the app
 *  `""` instead of falling through to the default. */
function configured(value: string | undefined, fallback = ""): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

/** Privy app ids are cuid2-shaped: lowercase alphanumeric, ~25 characters.
 *
 *  Checking the shape is not pedantry. `PrivyProvider` *throws* on an id it
 *  does not recognize. Keep a missing or malformed build-time public value on
 *  the readable configuration card instead of letting wallet initialization
 *  fail. Pasted quotes and trailing whitespace must not become a provider id. */
function validAppId(value: string): string {
  return /^[a-z0-9]{20,32}$/.test(value) ? value : "";
}

export const privyAppId = validAppId(
  configured(process.env.NEXT_PUBLIC_PRIVY_APP_ID),
);

export const aomiBffUrl = configured(
  process.env.NEXT_PUBLIC_AOMI_BFF_URL,
  "https://chat.aomi.dev",
).replace(/\/+$/, "");
