/** Only the user's control plane can select safety policy. */
export function transactionSafetyScope(
  method: string,
  pathname: string,
): string | null {
  if (
    pathname !== "/v1/account/transaction-safety" &&
    !/^\/v1\/account\/transaction-safety\/threads\/[^/]+$/.test(pathname)
  )
    return null;
  if (method === "GET") return "account:transaction-safety:read";
  return method === "PUT" ? "account:transaction-safety:write" : null;
}
