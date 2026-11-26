import type { WalletFamily } from "@/wallet/types";
import { Tag } from "@/ui/aomi/status-pill";
import { familyTag } from "./wallet-model";

export function FamilyTag({ family }: { family: WalletFamily }) {
  return <Tag>{familyTag(family)}</Tag>;
}
