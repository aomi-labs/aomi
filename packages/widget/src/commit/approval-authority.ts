import { createContext, useContext } from "react";

/**
 * Whether this surface acts as the owner's own Aomi session: it may approve a
 * parked agent-wallet commit and create agent wallets. Only a portal or CLI
 * login can; an embed on a partner site links to the sign page instead.
 */
export const ApprovalAuthorityContext = createContext(true);

export function useApprovalAuthority(): boolean {
  return useContext(ApprovalAuthorityContext);
}
