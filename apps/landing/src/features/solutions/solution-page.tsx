import type {LandingMetadata as Metadata} from "@/lib/metadata";
import { notFound } from "@tanstack/react-router";
import { solutionPages } from "./solution-data";
import { solutions } from "@/features/marketing/site";
import { DefiPage } from "./defi-page";
import { FintechPage } from "./fintech-page";
import { NftPage } from "./nft-page";
import { TradingPage } from "./trading-page";
import { WalletsPage } from "./wallets-page";



export function getPageMetadata(slug: string): Metadata {
  const solution = solutionPages[slug as keyof typeof solutionPages];
  if (slug === "trading") {
    return {
      title: "Trading | Aomi",
      description:
        "Aomi gives trading products ready-to-go integrations and a broader action space while keeping authority, policy, and signing explicit.",
      robots: { index: false, follow: false },
    };
  }
  if (slug === "defi") {
    return {
      title: "DeFi | Aomi",
      description:
        "The universal DeFi executor. 40+ protocols on EVM and Solana, every action they expose, compiled into one simulated, signable transaction.",
      robots: { index: false, follow: false },
    };
  }
  if (slug === "wallets") {
    return {
      title: "Wallets | Aomi",
      description:
        "Keep your own agent. Aomi exposes the Agent and Pipeline APIs underneath: fork-simulated, policy-checked Actions for the signer your wallet already runs.",
      robots: { index: false, follow: false },
    };
  }
  return solution
    ? {
        title: `${solutions.find((item) => item.slug === slug)?.title ?? "Solution"} | Aomi`,
        description: solution.lede,
        robots: { index: false, follow: false },
      }
    : { title: "Solution not found" };
}

export default function SolutionPage({slug}: {slug: string}) {
  const solution = solutionPages[slug as keyof typeof solutionPages];
  if (!solution) throw notFound();
  if (slug === "defi") return <DefiPage />;
  if (slug === "fintech") return <FintechPage solution={solution} />;
  if (slug === "trading") return <TradingPage />;
  if (slug === "nft") return <NftPage solution={solution} />;
  if (slug === "wallets") return <WalletsPage />;
  throw notFound();
}
