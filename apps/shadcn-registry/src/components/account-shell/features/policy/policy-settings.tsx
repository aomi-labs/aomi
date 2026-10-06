"use client";

import { SigningSettings } from "../account/provider-policy-settings";
import { OnchainPolicySettings } from "./onchain-policy-settings";

/**
 * Per-wallet signing, then Swig on-chain limits. The Swig section decides its
 * own visibility from the backend's provider flag, so deployments with the
 * lane off see only the signing rows.
 */
export function PolicySettings() {
  return (
    <>
      <SigningSettings />
      <OnchainPolicySettings />
    </>
  );
}
