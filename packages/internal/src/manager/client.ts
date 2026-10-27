/**
 * The manager (Aomi platform control plane) client. Each operation in
 * ENDPOINTS is a method of the same name; every one goes through `send`, which
 * carries the client's one bearer and turns any failure into a BackendError.
 */
import { BackendError, BrowserEnvironmentError } from "@aomi-labs/deploy";

import { ENDPOINTS, required, type Endpoints, type ManagerRequest, type Raw } from "./endpoints";

export type ManagerClientOptions = {
  /** The manager's base URL. */
  url: string;
  /** The service bearer every request carries. */
  bearer: string;
  fetch?: (input: Request | string | URL, init?: RequestInit) => Promise<Response>;
};

type Operation = keyof Endpoints;
type Output<K extends Operation> = ReturnType<Endpoints[K]> extends ManagerRequest<infer O> ? O : never;

export type ManagerMethods = {
  [K in Operation]: (...input: Parameters<Endpoints[K]>) => Promise<Output<K>>;
};

const WITH_BODY = new Set(["POST", "PUT", "PATCH"]);

export interface ManagerClient extends ManagerMethods {}

export class ManagerClient {
  private readonly url: string;
  private readonly bearer: string;
  private readonly fetchImpl: NonNullable<ManagerClientOptions["fetch"]>;

  constructor(options: ManagerClientOptions) {
    assertServerOnly();
    this.url = required(options.url, "url").replace(/\/+$/, "");
    this.bearer = required(options.bearer, "bearer");
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    for (const operation of Object.keys(ENDPOINTS) as Operation[]) {
      Object.defineProperty(this, operation, {
        value: (...input: never[]) => this.call(operation, ...(input as Parameters<Endpoints[typeof operation]>)),
      });
    }
  }

  /** Run one operation by name. Its input is checked before anything is sent. */
  async call<K extends Operation>(operation: K, ...input: Parameters<Endpoints[K]>): Promise<Output<K>> {
    const endpoint = ENDPOINTS[operation] as (...input: Parameters<Endpoints[K]>) => ManagerRequest<Output<K>>;
    const request = endpoint(...input);
    return request.read(await this.send(request));
  }

  private async send({ op, method = "GET", path, query, body, headers }: ManagerRequest<unknown>): Promise<Raw> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value != null && value !== "") params.set(key, String(value));
    }
    const payload = body ?? (WITH_BODY.has(method) ? {} : undefined);
    const search = params.toString() ? `?${params}` : "";
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.url}${path}${search}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.bearer}`,
          ...headers,
          ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
    } catch (cause) {
      throw new BackendError(op, 0, `${op} request failed`, undefined, { cause });
    }
    const text = await response.text();
    if (!response.ok) throw new BackendError(op, response.status, `${op} failed (${response.status})`, text);
    if (!text.trim()) return {};
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (cause) {
      throw new BackendError(op, response.status, `${op} returned invalid JSON`, text, { cause });
    }
    return json && typeof json === "object" && !Array.isArray(json) ? (json as Raw) : {};
  }
}

/** The client holds a service bearer, so it refuses to run in a browser. */
export function assertServerOnly(): void {
  const g = globalThis as Record<string, unknown>;
  if (g.__AOMI_ALLOW_BROWSER__ === true) return;
  if (typeof g.window !== "undefined" && typeof g.document !== "undefined") {
    throw new BrowserEnvironmentError(
      "the manager client is server-only: it holds a service bearer and must never run in a browser.",
    );
  }
}
