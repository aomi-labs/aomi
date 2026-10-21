"use client";

import { BadgeCheck } from "lucide-react";
import type { AomiAccountConnection } from "@aomi-labs/client";
import { ListGroup, ListRow } from "@/ui/aomi/list-group";
import { Switch } from "@/ui/aomi/switch";

/** How each kind of connection approves, shown while it may. */
const APPROVES_WITH = {
  cli: "With aomi tx approve",
  ai: "With its aomi_approve tool",
  app: "From the app or SDK",
  telegram: "With the bot's Approve button",
};

/**
 * "Can approve trades": whether a connection may approve its own Ask trades
 * (the CLI's `aomi tx approve`, an AI app's `aomi_approve`, a bot's card).
 * Off, they wait for the owner on Aomi.
 */
export function CanApproveTrades({
  name,
  kind,
  checked,
  disabled,
  onCheckedChange,
}: {
  name: string;
  kind: Exclude<AomiAccountConnection["kind"], "portal">;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <ListGroup>
      <ListRow
        leading={
          <span className="flex size-8 shrink-0 items-center justify-center">
            <BadgeCheck className="text-aomi-muted size-4" />
          </span>
        }
        title={<span className="text-[13.5px]">Can approve trades</span>}
        description={
          checked ? APPROVES_WITH[kind] : "Ask trades wait for you on Aomi"
        }
        trailing={
          <Switch
            aria-label={`${name} can approve trades`}
            checked={checked}
            disabled={disabled}
            onCheckedChange={onCheckedChange}
          />
        }
      />
    </ListGroup>
  );
}
