"use client";

import { createAuthClient } from "better-auth/react";
import { siweClient } from "better-auth/client/plugins";
import { anonymousClient } from "better-auth/client/plugins";
import {
  oauthDeviceAuthorizationClient,
  oauthProviderClient,
} from "@better-auth/oauth-provider/client";
import { aomiSiwsClient } from "./siws-client";

/** Plugin tuple used by the shared browser authentication client. */
export type AomiAuthPlugins = [
  ReturnType<typeof siweClient>,
  ReturnType<typeof aomiSiwsClient>,
  ReturnType<typeof anonymousClient>,
  ReturnType<typeof oauthProviderClient>,
  ReturnType<typeof oauthDeviceAuthorizationClient>,
];
export type AomiBrowserAuthClient = ReturnType<
  typeof createAuthClient<{ plugins: AomiAuthPlugins }>
>;
export const authClient: AomiBrowserAuthClient = createAuthClient<{
  plugins: AomiAuthPlugins;
}>({
  plugins: [
    siweClient(),
    aomiSiwsClient(),
    anonymousClient(),
    oauthProviderClient(),
    oauthDeviceAuthorizationClient(),
  ],
});

export { aomiSiwsClient } from "./siws-client";
export type {
  SiwsChainId,
  SiwsNonceRequest,
  SiwsNonceResponse,
  SiwsVerifyRequest,
  SiwsVerifyResponse,
} from "./siws-client";
