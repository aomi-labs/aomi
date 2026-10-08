"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getSettingsSessionId } from "./settings-api";
import { SkillCatalogTransportContext } from "../composer/capabilities/skill-catalog";
import {
  AomiClient,
  createScopedStorage,
  type GetAccountBearer,
  type AomiHttpMethod,
  type ScopedStorage,
} from "@aomi-labs/client";
import { useWidgetStorage } from "../lib/widget-storage";

export type ShellRequest = <T>(
  path: string,
  options?: RequestInit,
) => Promise<T>;

export function createShellTransport(
  baseUrl = "",
  getBearer?: GetAccountBearer,
  storage: ScopedStorage = createScopedStorage({ backendUrl: baseUrl }),
) {
  const origin = baseUrl.replace(/\/+$/, "");
  const fetchWithPolicy: typeof fetch = (input, init) =>
    globalThis.fetch(input, {
      ...init,
      credentials: origin ? "omit" : "same-origin",
      cache: "no-store",
    });
  const publicClient = new AomiClient({
    baseUrl: origin,
    fetch: fetchWithPolicy,
  });
  const requiredBearer: GetAccountBearer | undefined = getBearer
    ? Object.assign(
        (options?: Parameters<GetAccountBearer>[0]) => getBearer(options),
        { required: true },
      )
    : undefined;
  const client = new AomiClient({
    baseUrl: origin,
    fetch: fetchWithPolicy,
    getAccountBearer: requiredBearer,
  });
  const request = async (path: string, options: RequestInit = {}) => {
    if (!path.startsWith("/api/") && !path.startsWith("/v1/"))
      throw new Error("Unsupported account API path");
    const publicRead =
      (!options.method || options.method === "GET") &&
      (path === "/api/thread/apps" || path.startsWith("/api/resource/skills"));
    const headers = new Headers(options.headers);
    if (path.startsWith("/api/thread/")) {
      const sessionId = getSettingsSessionId(storage);
      if (!headers.has("X-Thread-Id")) headers.set("X-Thread-Id", sessionId);
      if (!headers.has("X-Session-Id")) headers.set("X-Session-Id", sessionId);
    }
    if (options.body && typeof options.body !== "string")
      throw new TypeError("Account requests require a JSON body");
    return (publicRead ? publicClient : client).requestResponse(
      (options.method ?? "GET") as AomiHttpMethod,
      path,
      {
        headers,
        signal: options.signal ?? undefined,
        body: options.body ? JSON.parse(options.body) : undefined,
      },
    );
  };
  const json: ShellRequest = async <T,>(
    path: string,
    options?: RequestInit,
  ) => {
    const response = await request(path, options);
    if (!response.ok)
      throw new Error(
        (await response.text()) || `Request failed: ${response.status}`,
      );
    return response.json() as Promise<T>;
  };
  return {
    fetch: request,
    json,
    embedded: Boolean(origin),
    themeRoot: null as HTMLElement | null,
    storage,
    client,
  };
}
const defaultTransport = createShellTransport();
const ShellTransportContext = createContext(defaultTransport);
export const useShellTransport = () => useContext(ShellTransportContext);

export function ShellTransportProvider({
  baseUrl,
  getBearer,
  children,
}: {
  baseUrl: string;
  getBearer?: GetAccountBearer;
  children: ReactNode;
}) {
  const storage = useWidgetStorage();
  const [themeRoot, setThemeRoot] = useState<HTMLDivElement | null>(null);
  const api = useMemo(
    () => createShellTransport(baseUrl, getBearer, storage),
    [baseUrl, getBearer, storage],
  );
  const transport = useMemo(() => ({ ...api, themeRoot }), [api, themeRoot]);
  return (
    <ShellTransportContext.Provider value={transport}>
      <div ref={setThemeRoot} style={{ display: "contents" }}>
        <SkillCatalogTransportContext.Provider value={api.json}>
          {children}
        </SkillCatalogTransportContext.Provider>
      </div>
    </ShellTransportContext.Provider>
  );
}
