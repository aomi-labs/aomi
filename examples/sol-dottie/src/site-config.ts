// Public, non-secret settings for the deployed site. A Vite env var of the same
// name (from .env.local or the deploy) overrides each one.
const env = import.meta.env;

/** Hosted Sol Dottie App. Empty ships the sample-data concept desk. */
export const DOTTIE_APPLICATION_ID =
  env.VITE_DOTTIE_APPLICATION_ID?.trim() || "";

/** Aomi backend. Undefined means the widget default, https://chat.aomi.dev. */
export const AOMI_API_URL = env.VITE_AOMI_API_URL?.trim() || undefined;

/** Dottie's Telegram bot, e.g. https://t.me/<bot_username>. */
export const DOTTIE_TELEGRAM_URL = env.VITE_DOTTIE_TELEGRAM_URL?.trim() || "";
