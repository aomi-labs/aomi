import { AomiClient } from "@aomi-labs/client";
const client = new AomiClient({
  guest: false,
  baseUrl: window.location.origin,
});
const runtime = { account: client.account };
export const useAomiRuntime = () => runtime;
