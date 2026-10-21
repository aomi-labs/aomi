"use client";

import { BadgeCheck } from "lucide-react";
import { ListGroup, ListRow } from "@/ui/aomi/list-group";
import { Switch } from "@/ui/aomi/switch";

/**
 * "Can approve trades": whether a connection may approve its own Ask trades
 * (the CLI's `aomi tx approve`, an AI app's `aomi_approve`, a bot's card).
 * Off, they wait for the owner on Aomi.
 */
export function CanApproveTrades({
  name,
  checked,
  here,
  disabled,
  onCheckedChange,
}: {
  name: string;
  checked: boolean;
  /** How this kind of connection approves, shown while on. */
  here: string;
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
        description={checked ? here : "Ask trades wait for you on Aomi"}
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
