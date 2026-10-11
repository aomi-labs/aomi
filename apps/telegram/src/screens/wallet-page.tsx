import { Providers } from "@/providers";
import { WalletClient } from "./wallet-client";

export default function WalletPage() {
  return (
    <Providers>
      <WalletClient />
    </Providers>
  );
}
