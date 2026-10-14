import type {
  AuthConfig,
  AuthMethodId,
  ProvidersConfig,
  WidgetAuthConfig,
} from "@/wallet/config/types";

export type PrivyAuthOptions = {
  /** Privy public app ID. */
  appId: string;
  appName?: string;
  appLogoUrl?: string;
  methods?: readonly AuthMethodId[];
  /** @deprecated Ignored; Privy sessions are always exchanged as PROD. Removed in @aomi-labs/widget 4.0. */
  environment?: string;
};

export type ParaAuthOptions = {
  /** Para public project key. */
  apiKey: string;
  /** Para environment of the key. Defaults to PROD. */
  environment?: "PROD" | "BETA";
  methods?: readonly AuthMethodId[];
  appName?: string;
  appDescription?: string;
  appUrl?: string;
  disableWorkers?: boolean;
};

/** @deprecated Use AomiWidgetAuth with `type`. Removed in @aomi-labs/widget 4.0. */
export type CrossOriginWidgetAuth =
  | { kind: "browser_wallet" }
  | {
      kind: "embedded_wallet";
      provider: "para";
      environment: string;
      /** Para public project key, passed explicitly by the host. */
      apiKey?: string;
    }
  | {
      kind: "embedded_wallet";
      provider: "privy";
      environment?: string;
      /** Privy public app ID. Same contract as Para's `apiKey`. */
      appId?: string;
    };

type WidgetAuthChoice =
  | { type: "browser_wallet" }
  | ({ type: "privy" } & PrivyAuthOptions)
  | ({ type: "para" } & ParaAuthOptions);

export type AomiWidgetAuth = WidgetAuthChoice | CrossOriginWidgetAuth;

/** Sign in with Privy. The widget loads the Privy SDK only when this is used. */
export function privyAuth(options: PrivyAuthOptions): AomiWidgetAuth {
  return { type: "privy", ...options };
}

/** Sign in with Para. The widget loads the Para SDK only when this is used. */
export function paraAuth(options: ParaAuthOptions): AomiWidgetAuth {
  return { type: "para", ...options };
}

export type ResolvedWidgetAuth = {
  auth: AuthConfig;
  providers?: ProvidersConfig;
  widgetAuth: WidgetAuthConfig;
};

/** Turn the public auth prop into wallet-kit config, or explain what is wrong. */
export function resolveWidgetAuth(
  input: AomiWidgetAuth | undefined,
): ResolvedWidgetAuth | { error: string } {
  const auth: WidgetAuthChoice | undefined =
    input && "kind" in input ? fromLegacyAuth(input) : input;
  if (!auth || auth.type === "browser_wallet")
    return { auth: false, widgetAuth: { mode: "wallet" } };
  if (auth.type === "privy") {
    if (!auth.appId?.trim())
      return {
        error:
          'auth type "privy" needs appId: pass your public Privy app ID, e.g. privyAuth({ appId: "…" }).',
      };
    return {
      auth: { provider: "privy", methods: auth.methods },
      providers: {
        privy: {
          appId: auth.appId,
          appName: auth.appName,
          appLogoUrl: auth.appLogoUrl,
        },
      },
      // Privy's exchange accepts only PROD.
      widgetAuth: { mode: "provider", provider: "privy", environment: "PROD" },
    };
  }
  if (auth.type === "para") {
    if (!auth.apiKey?.trim())
      return {
        error:
          'auth type "para" needs apiKey: pass your public Para project key, e.g. paraAuth({ apiKey: "…" }).',
      };
    const environment = auth.environment === "BETA" ? "BETA" : "PROD";
    return {
      auth: { provider: "para", methods: auth.methods },
      providers: {
        para: {
          apiKey: auth.apiKey,
          environment,
          appName: auth.appName,
          appDescription: auth.appDescription,
          appUrl: auth.appUrl,
          disableWorkers: auth.disableWorkers,
        },
      },
      widgetAuth: { mode: "provider", provider: "para", environment },
    };
  }
  return {
    error: `Unknown auth type "${(auth as { type?: unknown }).type}". Use "browser_wallet", privyAuth(…) or paraAuth(…).`,
  };
}

function fromLegacyAuth(auth: CrossOriginWidgetAuth): WidgetAuthChoice {
  if (auth.kind === "browser_wallet") return { type: "browser_wallet" };
  if (auth.provider === "privy")
    return { type: "privy", appId: auth.appId ?? "" };
  return {
    type: "para",
    apiKey: auth.apiKey ?? "",
    environment: auth.environment.toUpperCase() === "PROD" ? "PROD" : "BETA",
  };
}
