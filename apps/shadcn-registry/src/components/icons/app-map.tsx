import type { FC, SVGProps } from "react";
import { Globe2Icon } from "lucide-react";

import { canonicalAppId } from "../../lib/apps/app-identity";

import { AutoModeIcon } from "./auto-mode";
import {
  AllAppsIcon,
  BinanceIcon,
  BirdeyeIcon,
  BybitIcon,
  CambrianIcon,
  CoinGeckoIcon,
  CowIcon,
  DefillamaIcon,
  DuneIcon,
  DydxIcon,
  EtherscanIcon,
  GitHubIcon,
  GmxIcon,
  HyperliquidIcon,
  KaitoIcon,
  KalshiIcon,
  KhalaniIcon,
  LimitlessIcon,
  LinearIcon,
  ManifoldIcon,
  MolinarIcon,
  NeynarIcon,
  NotionIcon,
  OkxIcon,
  ParaIcon,
  PelagosIcon,
  PolymarketIcon,
  SlackIcon,
  SolscanIcon,
  VaultsFyiIcon,
  XIcon,
  ZeroxIcon,
} from "./apps";
import { SolanaIcon } from "./chains";
import {
  AaveSkillIcon,
  AcrossSkillIcon,
  CctpSkillIcon,
  JupiterSkillIcon,
  KrexaSkillIcon,
  LifiSkillIcon,
  MarinadeSkillIcon,
  MorphoSkillIcon,
  OneInchSkillIcon,
  UniswapSkillIcon,
  YearnSkillIcon,
  ZoraSkillIcon,
} from "./skills";

type AppIcon = FC<SVGProps<SVGSVGElement>>;

function WorldMarketsIcon(props: SVGProps<SVGSVGElement>) {
  return <Globe2Icon aria-hidden="true" {...props} />;
}

/** One canonical key maps to one reviewed local mark. */
const APP_ICONS: Readonly<Record<string, AppIcon>> = {
  default: AllAppsIcon,
  auto: AutoModeIcon,
  orchestrator: AutoModeIcon,
  across: AcrossSkillIcon,
  aave: AaveSkillIcon,
  binance: BinanceIcon,
  birdeye: BirdeyeIcon,
  bybit: BybitIcon,
  cambrian: CambrianIcon,
  coingecko: CoinGeckoIcon,
  cow: CowIcon,
  defillama: DefillamaIcon,
  dune: DuneIcon,
  dydx: DydxIcon,
  etherscan: EtherscanIcon,
  github: GitHubIcon,
  gmx: GmxIcon,
  hyperliquid: HyperliquidIcon,
  jupiter: JupiterSkillIcon,
  kaito: KaitoIcon,
  kalshi: KalshiIcon,
  khalani: KhalaniIcon,
  krexa: KrexaSkillIcon,
  lifi: LifiSkillIcon,
  limitless: LimitlessIcon,
  linear: LinearIcon,
  manifold: ManifoldIcon,
  marinade: MarinadeSkillIcon,
  molinar: MolinarIcon,
  morpho: MorphoSkillIcon,
  "morpho-vaults": MorphoSkillIcon,
  neynar: NeynarIcon,
  notion: NotionIcon,
  okx: OkxIcon,
  oneinch: OneInchSkillIcon,
  para: ParaIcon,
  "para-consumer": ParaIcon,
  pelagos: PelagosIcon,
  polymarket: PolymarketIcon,
  "polymarket-rewards": PolymarketIcon,
  slack: SlackIcon,
  solscan: SolscanIcon,
  stablefx: CctpSkillIcon,
  svm: SolanaIcon,
  "svm-transfer": SolanaIcon,
  uniswap: UniswapSkillIcon,
  vaultsfyi: VaultsFyiIcon,
  "world-markets": WorldMarketsIcon,
  x: XIcon,
  yearn: YearnSkillIcon,
  zerox: ZeroxIcon,
  zora: ZoraSkillIcon,
};

export function getAppIcon(
  appId: string | null | undefined,
): AppIcon | undefined {
  const canonicalId = canonicalAppId(appId);
  return Object.hasOwn(APP_ICONS, canonicalId)
    ? APP_ICONS[canonicalId]
    : undefined;
}
