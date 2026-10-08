import { PARA_BRAND_KEY, PARA_SESSION_UID } from "./para-brand";

/** Para auth publishes a synthetic row before wagmi has a real signer. */
export function shouldConnectParaEvmSession(
  authenticated: boolean,
  connections: ReadonlyArray<{ uid: string; stableId: string }>,
): boolean {
  return (
    authenticated &&
    !connections.some(
      (connection) =>
        connection.stableId === PARA_BRAND_KEY &&
        connection.uid !== PARA_SESSION_UID,
    )
  );
}
