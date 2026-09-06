export {
  createDefaultProviderCredentialVerifiers,
  isVerifiedProviderTokenCredential,
  providerSessionUserSeed,
  toVerifiedProviderIdentity,
  verifyProviderCredential,
  type ProviderCredentialVerifier,
  type ProviderCredentialVerifierRegistry,
  type ProviderTokenCredential,
  type VerifiedProviderCredential,
  type VerifiedProviderToken,
  type VerifiedProviderTokenCredential,
  type VerifyProviderCredentialOptions,
} from "./account-credentials";

export {
  getWidgetProvider,
  registerWidgetProvider,
  widgetCredentialWireSchema,
  type VerifiedProviderIdentity,
  type WidgetCredentialWire,
  type WidgetProviderDescriptor,
  type WidgetProviderPolicy,
} from "./descriptor";

import { getWidgetProvider, registerWidgetProvider } from "./descriptor";
import { paraWidgetDescriptor } from "./para";
import { privyWidgetDescriptor } from "./privy";

registerWidgetProvider(paraWidgetDescriptor);
registerWidgetProvider(privyWidgetDescriptor);

export function nativeProviderResolutionPolicy(
  provider: string,
): import("./descriptor").WidgetProviderPolicy {
  return {
    subjectIsEnvironmentGlobal:
      getWidgetProvider(provider)?.policy.subjectIsEnvironmentGlobal ?? false,
    widgetEnabled: false,
  };
}

export { createDefaultWalletAttesters } from "./default-wallet-attesters";

export { listPrivyWalletsForUser, verifyPrivyToken } from "./privy";

export {
  createParaWidgetDescriptor,
  listParaWalletsForUser,
  paraWidgetDescriptor,
  verifyParaJwt,
  verifyParaWidgetCredential,
} from "./para";

export { privyWidgetDescriptor } from "./privy";

export {
  validWalletAddress,
  type AttestedWallet,
  type AttestedWalletProvider,
  type WalletAttestationLogger,
  type WalletAttester,
  type WalletAttesterRegistry,
} from "./wallet-attestation";
