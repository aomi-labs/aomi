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
 *  does not recognize, and because that throw happens during render it takes
 *  down the prerender of every route — turning a one-line env mistake into a
 *  failed build rather than the readable "not configured" card this app already
 *  knows how to show. The common mistakes here are real: the Vercel CLI marks
 *  vars sensitive by default when added non-interactively, and a sensitive
 *  `NEXT_PUBLIC_*` reaches the bundle as `""`; a pasted value can carry a quote
 *  or a trailing newline. All of them land here instead of in a stack trace. */
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
