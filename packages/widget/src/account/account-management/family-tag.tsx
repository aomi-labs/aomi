import { StatusPill } from "@/ui/aomi/status-pill";
import type { WalletFamily } from "@/wallet/types";
import { familyTag } from "./wallet-model";

export function FamilyTag({ family }: { family: WalletFamily }) {
  return (
    <StatusPill className="font-mono">
      {familyTag(family)}
    </StatusPill>
  );
}
