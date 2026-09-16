"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getSettingsSessionId } from "./lib/settings-api";
import { SkillCatalogTransportContext } from "../../lib/capabilities/skill-catalog";
import type { GetAccountBearer } from "@aomi-labs/client";

export type ShellRequest = <T>(
  path: string,
  options?: RequestInit,
) => Promise<T>;

export function createShellTransport(
  baseUrl = "",
  getBearer?: GetAccountBearer,
) {
  const origin = baseUrl.replace(/\/+$/, "");
  const request = async (path: string, options: RequestInit = {}) => {
    if (!path.startsWith("/api/") && !path.startsWith("/v1/")) {
      throw new Error("Unsupported account API path");
    }
    const publicRead =
      (!options.method || options.method === "GET") &&
      (path === "/api/thread/apps" || path.startsWith("/api/resource/skills"));
    const send = async (forceRefresh: boolean) => {
      const headers = new Headers(options.headers);
      if (path.startsWith("/api/thread/")) {
        const sessionId = getSettingsSessionId();
        headers.set("X-Thread-Id", sessionId);
        headers.set("X-Session-Id", sessionId);
      }
      if (options.body && !headers.has("Content-Type"))
        headers.set("Content-Type", "application/json");
      if (getBearer && !publicRead) {
        const bearer = await getBearer({ forceRefresh });
        if (!bearer) throw new Error("Sign in to access your account");
        headers.set("Authorization", `Bearer ${bearer}`);
      }
      return fetch(`${origin}${path}`, {
        ...options,
        headers,
        credentials: origin ? "omit" : "same-origin",
        cache: "no-store",
      });
    };
    const response = await send(false);
    return response.status === 401 && getBearer ? send(true) : response;
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
  const [themeRoot, setThemeRoot] = useState<HTMLDivElement | null>(null);
  const api = useMemo(
    () => createShellTransport(baseUrl, getBearer),
    [baseUrl, getBearer],
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
