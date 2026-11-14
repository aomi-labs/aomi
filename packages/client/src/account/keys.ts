import type {
  AomiIngestSecretsResponse,
  AomiListSecretsResponse,
} from "../types";

/** A JSON account request; a failure throws `AccountGraphApiError`. */
export type AccountRequest = <T>(path: string, init: RequestInit) => Promise<T>;

/** Whose vault: the client that owns it and the thread it is used from. */
export type AccountKeyScope = { thread: string; clientId?: string };

/**
 * One client's secrets vault: your own provider keys (`BYOK:<provider>`) and
 * values the agent's tools use by `$SECRET:<name>` handle. Values never come
 * back, only names and handles.
 */
export class AccountKeysTransport {
  constructor(private readonly request: AccountRequest) {}

  /** The stored names. */
  async list(scope: AccountKeyScope): Promise<string[]> {
    const response = await this.send<AomiListSecretsResponse>("GET", scope);
    return response.names ?? Object.values(response.by_app ?? {}).flat();
  }

  /** Store `secrets` by name; resolves to each one's handle. */
  async set(
    secrets: Record<string, string>,
    scope: AccountKeyScope,
  ): Promise<Record<string, string>> {
    const { handles } = await this.send<AomiIngestSecretsResponse>(
      "POST",
      scope,
      "",
      { client_id: scope.clientId, secrets },
    );
    return handles;
  }

  /** Remove one name; resolves to whether it existed. */
  async remove(name: string, scope: AccountKeyScope): Promise<boolean> {
    const { deleted } = await this.send<{ deleted: boolean }>(
      "DELETE",
      scope,
      `/${encodeURIComponent(name)}`,
    );
    return deleted;
  }

  /** Remove everything and unbind the thread. */
  async clear(scope: AccountKeyScope): Promise<void> {
    await this.send("DELETE", scope);
  }

  private send<T>(
    method: string,
    { thread, clientId }: AccountKeyScope,
    suffix = "",
    body?: unknown,
  ): Promise<T> {
    const query =
      clientId && body === undefined
        ? `?${new URLSearchParams({ client_id: clientId })}`
        : "";
    return this.request<T>(`/v1/account/keys${suffix}${query}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Session-Id": thread,
        "X-Thread-Id": thread,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
}
