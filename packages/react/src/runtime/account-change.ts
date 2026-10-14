import type { RuntimeAccount } from "../query/display-cache";

/** Everything that decides whose chats this runtime may show. */
export type RuntimeOwner = {
  backendUrl: string;
  appId: string;
  account: RuntimeAccount | null | undefined;
  /** The credential source requests are signed with. */
  authSource: unknown;
};

/**
 * - `keep`: same owner; running turns continue.
 * - `start-over`: another user or backend; every chat and draft is dropped.
 * - `sign-in`: a guest signed in and requests now go out differently; the
 *   guest's chats close but the unsent draft moves to the signed-in chat.
 */
export type AccountChange = "keep" | "start-over" | "sign-in";

export function accountChange(
  previous: RuntimeOwner,
  next: RuntimeOwner,
): AccountChange {
  if (previous.backendUrl !== next.backendUrl || previous.appId !== next.appId)
    return "start-over";
  const previousUser =
    previous.account?.kind === "user" ? previous.account.id : null;
  const nextUser = next.account?.kind === "user" ? next.account.id : null;
  if (previousUser) return previousUser === nextUser ? "keep" : "start-over";
  if (!nextUser) return "keep";
  // A guest whose cookie became this user keeps its running turn, unless the
  // backend sees a different person or the requests are now signed elsewhere.
  const guestBecameSomeoneElse =
    previous.account?.kind === "guest" && previous.account.id !== nextUser;
  return guestBecameSomeoneElse || previous.authSource !== next.authSource
    ? "sign-in"
    : "keep";
}
