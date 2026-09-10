/** Trimmed env value, treating a blank var as unset. A var created empty in the
 *  Vercel dashboard is a string, not `undefined`, so `??` would hand the app
 *  `""` instead of falling through to the default. */
function configured(value: string | undefined, fallback = ""): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

export const privyAppId = configured(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

export const aomiBffUrl = configured(
  process.env.NEXT_PUBLIC_AOMI_BFF_URL,
  "https://chat.aomi.dev",
).replace(/\/+$/, "");
