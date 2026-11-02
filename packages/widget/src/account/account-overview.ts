"use client";

/**
 * One shared /api/account overview for the settings surfaces, held in the
 * runtime's display cache under the signed-in account. The session probe
 * (aomi-session-bridge) seeds it, so opening Settings costs no extra read.
 */

import { useMemo } from "react";
import {
  fetchDisplayQuery,
  useAomiDisplayCache,
  useDisplayQuery,
  type DisplayQuery,
} from "@aomi-labs/react";
import {
  MICROUSD_PER_CREDIT,
  type AomiAccountProfile,
  type CreditBalance,
} from "@aomi-labs/client";
import { useShellTransport, type ShellTransport } from "./transport";

export type AccountProfile = {
  user_id: string;
  public_key?: string;
  verified_email?: string | null;
  tier?: string;
  created_at?: number;
  /** The account's installed apps (`users.applications`). */
  apps?: string[];
  /** Exact installed hosted application rows. */
  application_ids?: number[];
};

/**
 * The `/api/account` reply. Everything beside `user` is optional: a profile
 * restored from disk carries only `user` until the first live read lands.
 */
export type AccountOverview = Partial<Omit<AomiAccountProfile, "user">> & {
  user: AccountProfile;
};

export type CreditAllowance = {
  used: number;
  included: number;
};

export function creditAllowanceFromPosition(
  position: Partial<CreditBalance> | null | undefined,
): CreditAllowance | null {
  if (!position) return null;
  const included = position.included;
  if (
    !included ||
    !Number.isFinite(included.used_microusd) ||
    !Number.isFinite(included.limit_microusd)
  ) {
    return null;
  }
  return {
    used: included.used_microusd / MICROUSD_PER_CREDIT,
    included: included.limit_microusd / MICROUSD_PER_CREDIT,
  };
}

/** The account's profile. With `accountId`, a reply for anyone else is refused. */
export function accountProfileQuery(
  transport: Pick<ShellTransport, "aomi" | "settingsThread">,
  accountId?: string,
): DisplayQuery<AccountOverview> {
  return {
    resource: "profile",
    fetcher: async () => {
      const data: AccountOverview = await transport.aomi.raw.getAccount(
        transport.settingsThread(),
      );
      if (accountId && data.user.user_id !== accountId)
        throw new Error("Account changed while its profile was loading");
      return data;
    },
  };
}

/** Inside a runtime only a signed-in user has a profile; standalone always asks. */
function useProfileQuery() {
  const transport = useShellTransport();
  const cache = useAomiDisplayCache();
  const account = cache?.scope.account;
  const userId = account?.kind === "user" ? account.id : undefined;
  const query = useMemo(
    () => ({
      ...accountProfileQuery(transport, userId),
      enabled: !cache || Boolean(userId),
    }),
    [cache, transport, userId],
  );
  return { cache, query, userId };
}

export function useAccountOverviewStore() {
  const { cache, query, userId } = useProfileQuery();
  return useMemo(() => {
    const key = cache?.key("profile");
    const read = () =>
      key ? cache?.client.getQueryData<AccountOverview>(key) : undefined;
    const write = (data: AccountOverview) => {
      if (key && userId && data.user.user_id === userId)
        cache?.client.setQueryData(key, data);
    };
    return {
      /** Share a profile read elsewhere; null drops it and reads again. */
      seedAccountOverview: (data: AccountOverview | null) => {
        if (!key || !userId) return;
        if (data) write(data);
        else void cache?.client.resetQueries({ queryKey: key, exact: true });
      },
      updateAccountApps: (
        accountUserId: string,
        apps: string[],
        applicationIds?: number[],
      ) => {
        const current = read();
        if (current?.user.user_id !== accountUserId) return;
        write({
          ...current,
          user: {
            ...current.user,
            apps,
            application_ids: applicationIds ?? current.user.application_ids,
          },
        });
      },
      loadOnce: (): Promise<void> =>
        cache && query.enabled
          ? fetchDisplayQuery(cache, query).then(
              () => undefined,
              () => undefined,
            )
          : Promise.resolve(),
    };
  }, [cache, query, userId]);
}

/** The shared profile read itself, for callers that refetch or watch status. */
export function useAccountProfileQuery() {
  return useDisplayQuery(useProfileQuery().query);
}

export function useAccountOverview(): AccountOverview | null {
  return useAccountProfileQuery().data ?? null;
}

/** Whole credits for allowance displays; retain precision in the source data. */
export function formatAllowanceCredits(value: number): string {
  return Math.trunc(value).toLocaleString();
}

/** Shared allowance line for the account menu and Usage surfaces. */
export function formatAllowanceSummary(used: number, included: number): string {
  const remaining = Math.max(0, included - used);
  return `${formatAllowanceCredits(remaining)} left · ${formatAllowanceCredits(used)}/${formatAllowanceCredits(included)} used`;
}

/** The same account plan label in settings and the account summary. */
export function tierLabel(tier?: string): string {
  if (!tier || tier === "free") return "Free";
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}
