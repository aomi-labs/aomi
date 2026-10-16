import type { WalletFamily } from "@/wallet/types";
import { familyTag } from "./wallet-model";

export function FamilyTag({ family }: { family: WalletFamily }) {
  return (
    <span className="border-aomi-border text-aomi-muted inline-flex h-4 items-center rounded-[5px] border px-1 font-mono text-[10px] font-medium leading-none">
      {familyTag(family)}
    </span>
  );
}
