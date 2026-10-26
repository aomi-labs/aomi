import type { FC } from "react";
import { Wallet } from "lucide-react";
import { AGENT_WALLET } from "@/account/account-management/wallet-model";
import { AomiMark } from "@/ui/aomi-mark";
import { WalletMark, resolveWalletBrandKey } from "@/wallet/wallet-brands";

type PickerIcon = FC<{ className?: string }>;

const icons = new Map<string, PickerIcon>();

/**
 * A wallet app's own logo in the text color, like the other picker icons, so
 * a tagged wallet takes the tag's color: the agent wallet is the Aomi mark and
 * an unknown app is the generic wallet. One component per app, so rows keep
 * their identity.
 */
export function walletPickerIcon(app: string): PickerIcon {
  const brand = app === AGENT_WALLET ? "agent" : resolveWalletBrandKey(app);
  const key = brand ?? "wallet";
  let Icon = icons.get(key);
  if (!Icon) {
    Icon = function WalletPickerIcon({ className }) {
      return brand === "agent" ? (
        <AomiMark size={14} className={className} />
      ) : brand ? (
        <WalletMark
          name={brand}
          className={className}
          style={{ color: "inherit" }}
        />
      ) : (
        <Wallet aria-hidden className={className} />
      );
    };
    icons.set(key, Icon);
  }
  return Icon;
}
