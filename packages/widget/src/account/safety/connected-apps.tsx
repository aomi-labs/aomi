"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AomiAccountConnections,
  AomiClient,
  AomiConnectionKind,
  AomiOAuthConnection,
} from "@aomi-labs/client";
import { AomiButton } from "@/ui/aomi/button";
import { ListGroup, ListRow } from "@/ui/aomi/list-group";
import { SectionHeader } from "@/ui/aomi/section-header";
import { StatusPill } from "@/ui/aomi/status-pill";
import { useConfirmDialog } from "@/ui/aomi/confirm-dialog";

const KIND_LABELS: Record<AomiConnectionKind, string> = {
  mcp: "MCP",
  api: "API",
  cli: "CLI",
};

function connectedOn(seconds: number | null): string | undefined {
  if (seconds === null) return undefined;
  return `Connected ${new Date(seconds * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

/**
 * The OAuth clients acting for this account (AI clients over MCP, scripts,
 * the CLI) with Disconnect, and the linked Telegram user once.
 */
export function ConnectedApps({
  client,
  onLoad,
}: {
  client: AomiClient;
  onLoad?: () => void;
}) {
  const [connections, setConnections] = useState<AomiAccountConnections>();
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const { confirm, dialog } = useConfirmDialog();

  const load = useCallback(async () => {
    try {
      setConnections(await client.account.connections.list());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      onLoad?.();
    }
  }, [client, onLoad]);
  useEffect(() => {
    void load();
  }, [load]);

  const disconnect = async (app: AomiOAuthConnection) => {
    if (
      pending ||
      !(await confirm({
        title: `Disconnect ${app.name}?`,
        description:
          "It can no longer refresh its access. A token it already holds works until it expires.",
        confirmLabel: "Disconnect",
        tone: "danger",
      }))
    )
      return;
    setPending(app.client_id);
    setError(undefined);
    try {
      await client.account.connections.disconnectOAuth(app.client_id);
      await load();
    } catch {
      setError(`Couldn't disconnect ${app.name}. Try again.`);
    } finally {
      setPending(undefined);
    }
  };

  const telegram = connections?.telegram;
  const empty = connections && !connections.oauth.length && !telegram;
  return (
    <section
      aria-labelledby="connected-apps-heading"
      className="flex flex-col gap-2"
    >
      <SectionHeader
        id="connected-apps-heading"
        title="Connected apps"
        help="Apps you signed in with Aomi. Disconnect stops an app from acting for you."
      />
      {failed ? (
        <p className="type-meta text-aomi-muted px-0.5">
          Couldn’t load connected apps.
        </p>
      ) : connections ? (
        <ListGroup>
          {connections.oauth.map((app) => (
            <ListRow
              key={app.client_id}
              className="min-h-0 py-2.5"
              title={app.name}
              description={connectedOn(app.connected_at)}
              trailing={
                <>
                  <StatusPill>{KIND_LABELS[app.kind]}</StatusPill>
                  <AomiButton
                    variant="danger"
                    size="sm"
                    disabled={Boolean(pending)}
                    onClick={() => void disconnect(app)}
                  >
                    {pending === app.client_id
                      ? "Disconnecting…"
                      : "Disconnect"}
                  </AomiButton>
                </>
              }
            />
          ))}
          {telegram ? (
            <ListRow
              className="min-h-0 py-2.5"
              title={
                telegram.bots.length
                  ? `Your Telegram account · used in ${telegram.bots.map((bot) => bot.label).join(", ")}`
                  : "Your Telegram account"
              }
            />
          ) : null}
          {empty ? (
            <p className="type-meta text-aomi-muted px-3.5 py-3">
              No apps connected.
            </p>
          ) : null}
        </ListGroup>
      ) : null}
      {connections && !telegram ? (
        <p className="type-meta text-aomi-muted px-0.5">
          Use Aomi in Telegram? Send /link to any Aomi app bot to add it here.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="type-meta text-aomi-danger px-0.5">
          {error}
        </p>
      ) : null}
      {dialog}
    </section>
  );
}
