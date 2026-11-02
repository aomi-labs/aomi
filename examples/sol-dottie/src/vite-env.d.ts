/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AOMI_API_URL?: string;
  readonly VITE_DOTTIE_APPLICATION_ID?: string;
  readonly VITE_DOTTIE_TELEGRAM_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
