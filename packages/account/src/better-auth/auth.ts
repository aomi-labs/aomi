import { nextCookies } from "better-auth/next-js";

import { createAccountAuth, createWalletAuthRequestHandler } from "./core";

export const auth = createAccountAuth(nextCookies());
export const handleWalletAuthRequest = createWalletAuthRequestHandler(auth);
