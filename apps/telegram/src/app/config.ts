export type ParaEnvironment = "BETA" | "PROD";

export const paraEnvironment: ParaEnvironment =
  process.env.NEXT_PUBLIC_PARA_ENVIRONMENT === "PROD" ? "PROD" : "BETA";

export const aomiBffUrl = (
  process.env.NEXT_PUBLIC_AOMI_BFF_URL ?? "https://chat.aomi.dev"
).replace(/\/+$/, "");
