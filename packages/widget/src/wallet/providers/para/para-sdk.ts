import type * as ParaReact from "@getpara/react-sdk";
import type * as ParaWagmi from "@getpara/wagmi-v2-connector";

/**
 * Para's SDK modules, handed in by whoever loaded them. The island code only
 * imports Para types, so bundlers never need Para for hosts that do not use
 * it; the lazy loader or the eager provider entry supplies the modules.
 */
export type ParaSdk = {
  react: typeof ParaReact;
  wagmi: typeof ParaWagmi;
};

let sdk: ParaSdk | undefined;

export function setParaSdk(next: ParaSdk): void {
  sdk = next;
}

export function paraSdk(): ParaSdk {
  if (!sdk) throw new Error("[aomi] Para rendered before its SDK loaded.");
  return sdk;
}
