"use client";

import { createAuthClient } from "better-auth/react";
import { siweClient } from "better-auth/client/plugins";
import { anonymousClient } from "better-auth/client/plugins";
import {
  oauthDeviceAuthorizationClient,
  oauthProviderClient,
} from "@better-auth/oauth-provider/client";
import { aomiSiwsClient } from "./siws-client";

export const authClient = createAuthClient({
  plugins: [
    siweClient(),
    aomiSiwsClient(),
    anonymousClient(),
    oauthProviderClient(),
    oauthDeviceAuthorizationClient(),
  ],
});
