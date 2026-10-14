import "@tanstack/react-start/server-only";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import {
  createAccountAuth,
  createWalletAuthRequestHandler,
} from "@aomi-labs/account/better-auth/core";
export const auth = createAccountAuth(tanstackStartCookies());
export const handleWalletAuthRequest = createWalletAuthRequestHandler(auth);
