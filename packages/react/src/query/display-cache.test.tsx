import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  DisplayCacheProvider,
  useAomiDisplayCache,
  useDisplayQuery,
  type DisplayCache,
} from "./display-cache";

function Read({
  fetcher,
}: {
  fetcher: (signal: AbortSignal) => Promise<string>;
}) {
  const query = useDisplayQuery({ resource: "profile", fetcher });
  return <span>{query.data ?? "pending"}</span>;
}
describe("the runtime's display queries", () => {
  afterEach(() => focusManager.setFocused(undefined));
  it("refreshes stale profiles on focus while fresh profiles and credits stay cached", async () => {
    let cache!: DisplayCache;
    const profile = vi.fn(async () => "profile");
    const credits = vi.fn(async () => "credits");
    function Readers() {
      cache = useAomiDisplayCache()!;
      const a = useDisplayQuery({ resource: "profile", fetcher: profile });
      const b = useDisplayQuery({ resource: "credits", fetcher: credits });
      return (
        <span>
          {a.data}/{b.data}
        </span>
      );
    }
    render(
      <DisplayCacheProvider
        backendUrl="/focus"
        account={{ kind: "user", id: "a" }}
        persistence="none"
      >
        <Readers />
      </DisplayCacheProvider>,
    );
    await screen.findByText("profile/credits");
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(profile).toHaveBeenCalledOnce();
    act(() => {
      cache.client.setQueryData(cache.key("profile"), "profile", {
        updatedAt: Date.now() - 5 * 60_000 - 1,
      });
      cache.client.setQueryData(cache.key("credits"), "credits", {
        updatedAt: Date.now() - 60_001,
      });
    });
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(profile).toHaveBeenCalledTimes(2));
    expect(credits).toHaveBeenCalledOnce();
  });
  it("mounts a standalone reader's client for TanStack focus refresh", async () => {
    const fetcher = vi.fn(async () => "standalone");
    function Standalone() {
      const query = useDisplayQuery({
        resource: "profile",
        fetcher,
        staleTime: 0,
      });
      return <span>{query.data ?? "pending"}</span>;
    }
    render(<Standalone />);
    await screen.findByText("standalone");
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });
  it("shares one read between readers, keeps it across remounts, and ignores host defaults", async () => {
    const fetcher = vi.fn(async () => "account-a");
    const host = new QueryClient({
      defaultOptions: {
        queries: {
          queryFn: () => Promise.reject(new Error("host policy")),
          staleTime: 0,
        },
      },
    });
    function Frame({ second }: { second: boolean }) {
      return (
        <QueryClientProvider client={host}>
          <DisplayCacheProvider
            backendUrl="/a"
            account={{ kind: "user", id: "a" }}
            persistence="none"
          >
            <Read fetcher={fetcher} />
            {second && <Read fetcher={fetcher} />}
          </DisplayCacheProvider>
        </QueryClientProvider>
      );
    }
    const view = render(<Frame second />);
    await waitFor(() =>
      expect(screen.getAllByText("account-a")).toHaveLength(2),
    );
    expect(fetcher).toHaveBeenCalledOnce();
    view.rerender(<Frame second={false} />);
    view.rerender(<Frame second />);
    expect(screen.getAllByText("account-a")).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(host.getQueryCache().getAll()).toHaveLength(0);
  });
  it("cancels the previous account's read and ignores its late result", async () => {
    let finish!: (value: string) => void;
    let oldSignal!: AbortSignal;
    const old = vi.fn((signal: AbortSignal) => {
      oldSignal = signal;
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    });
    const next = vi.fn(async () => "account-b");
    const mounts = vi.fn();
    function Shell({
      fetcher,
    }: {
      fetcher: (signal: AbortSignal) => Promise<string>;
    }) {
      useEffect(() => {
        mounts();
      }, []);
      return <Read fetcher={fetcher} />;
    }
    const view = render(
      <DisplayCacheProvider
        backendUrl="/a"
        account={{ kind: "user", id: "a" }}
        persistence="none"
      >
        <Shell fetcher={old} />
      </DisplayCacheProvider>,
    );
    view.rerender(
      <DisplayCacheProvider
        backendUrl="/a"
        account={{ kind: "user", id: "b" }}
        persistence="none"
      >
        <Shell fetcher={next} />
      </DisplayCacheProvider>,
    );
    expect(oldSignal.aborted).toBe(true);
    expect(mounts).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByText("account-b")).toBeVisible());
    await act(async () => finish("account-a"));
    expect(screen.queryByText("account-a")).toBeNull();
  });
  it("keeps two widgets' keys and values isolated", () => {
    const caches: DisplayCache[] = [];
    function Capture() {
      caches.push(useAomiDisplayCache()!);
      return null;
    }
    render(
      <>
        <DisplayCacheProvider
          backendUrl="/one"
          applicationId={8}
          account={{ kind: "user", id: "a" }}
          persistence="none"
        >
          <Capture />
        </DisplayCacheProvider>
        <DisplayCacheProvider
          backendUrl="/two"
          applicationId={8}
          account={{ kind: "user", id: "a" }}
          persistence="none"
        >
          <Capture />
        </DisplayCacheProvider>
      </>,
    );
    caches[0].client.setQueryData(caches[0].key("profile"), "one");
    expect(
      caches[1].client.getQueryData(caches[1].key("profile")),
    ).toBeUndefined();
    expect(caches[0].key("profile")).toEqual([
      "aomi",
      "/one",
      "8",
      { kind: "user", id: "a" },
      "profile",
    ]);
  });
  it("keeps public catalogs and drops the previous account's data when the account changes", async () => {
    let cache!: DisplayCache;
    const models = vi.fn(async () => ["model"]);
    const profile = vi.fn(async () => "profile");
    function Readers() {
      cache = useAomiDisplayCache()!;
      useDisplayQuery({ resource: "models", fetcher: models });
      const account = useDisplayQuery({
        resource: "profile",
        fetcher: profile,
      });
      return <span>{account.data ?? "none"}</span>;
    }
    const frame = (account?: { kind: "user"; id: string } | null) => (
      <DisplayCacheProvider
        backendUrl="/a"
        account={account}
        persistence="none"
      >
        <Readers />
      </DisplayCacheProvider>
    );
    const view = render(frame(undefined));
    await waitFor(() => expect(models).toHaveBeenCalledOnce());
    const signedOutProfile = cache.key("profile");
    view.rerender(frame({ kind: "user", id: "a" }));
    await screen.findByText("profile");
    expect(cache.client.getQueryData(signedOutProfile)).toBeUndefined();
    const accountProfile = cache.key("profile");
    view.rerender(frame(null));
    expect(cache.client.getQueryData(accountProfile)).toBeUndefined();
    expect(cache.client.getQueryData(cache.key("models"))).toEqual(["model"]);
    expect(models).toHaveBeenCalledOnce();
  });
});
