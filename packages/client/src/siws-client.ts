import type {
  BetterAuthClientPlugin,
  BetterFetchOption,
  BetterFetchResponse,
} from "better-auth/client";

export type SiwsChainId = "solana:mainnet" | "solana:devnet" | "solana:testnet";
export interface SiwsNonceRequest {
  walletAddress: string;
  chainId?: SiwsChainId;
  intent?: "sign-in" | "link";
}
export interface SiwsNonceResponse {
  nonce: string;
  domain: string;
  uri: string;
}
export interface SiwsVerifyRequest extends SiwsNonceRequest {
  message: string;
  signature: string;
  walletApp?: string;
}
export type SiwsVerifyResponse = {
  success: true;
  user: { id: string; walletAddress: string; chainId: SiwsChainId };
} & ({ token: string; user_id: string } | { status: "noop" | "linked" });

type AuthFetch = Parameters<
  NonNullable<BetterAuthClientPlugin["getActions"]>
>[0];

type SiwsError = { code?: string; message?: string };
type SiwsFetchOptions<Body, Response> = BetterFetchOption<
  Partial<Body>,
  Record<string, unknown>,
  undefined,
  Response
>;

// Match BetterAuth's route proxy: embedded options override the second argument,
// and fetchOptions belongs to the transport, never the JSON request body.
function siwsAction<Body extends object, Response>(
  $fetch: AuthFetch,
  path: string,
) {
  return <Options extends SiwsFetchOptions<Body, Response> = {}>(
    request: Body & { fetchOptions?: Options },
    fetchOptions?: Options,
  ): Promise<
    BetterFetchResponse<
      Response,
      SiwsError,
      Options["throw"] extends true ? true : false
    >
  > => {
    const { fetchOptions: embeddedOptions, ...body } = request;
    const options = { ...fetchOptions, ...embeddedOptions };
    return $fetch<Response, SiwsError>(path, {
      ...options,
      method: "POST",
      body: { ...body, ...options.body },
    }) as Promise<
      BetterFetchResponse<
        Response,
        SiwsError,
        Options["throw"] extends true ? true : false
      >
    >;
  };
}

export function aomiSiwsClient() {
  return {
    id: "aomi-siws",
    pathMethods: { "/siws/nonce": "POST", "/siws/verify": "POST" },
    getActions: ($fetch: AuthFetch) => ({
      siws: {
        nonce: siwsAction<SiwsNonceRequest, SiwsNonceResponse>(
          $fetch,
          "/siws/nonce",
        ),
        verify: siwsAction<SiwsVerifyRequest, SiwsVerifyResponse>(
          $fetch,
          "/siws/verify",
        ),
      },
    }),
  } as const satisfies BetterAuthClientPlugin;
}
