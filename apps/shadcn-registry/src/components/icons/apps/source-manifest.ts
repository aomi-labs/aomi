/** Reviewed sources for locally bundled app marks. */
export const appIconSources = {
  across: "https://across.to/",
  aave: "https://github.com/aave-dao/aave-brand-kit/tree/main/Logo",
  binance:
    "https://raw.githubusercontent.com/0xa3k5/web3icons/64e21e68cc6eaa36ff9d0a135ca2c809a759ccd6/raw-svgs/exchanges/mono/binance.svg",
  birdeye: "https://birdeye.so/favicon.ico",
  bybit:
    "https://raw.githubusercontent.com/0xa3k5/web3icons/64e21e68cc6eaa36ff9d0a135ca2c809a759ccd6/raw-svgs/exchanges/mono/bybit.svg",
  cambrian: "https://www.cambrian.org/redesign/cambrian-hexagon.svg",
  coingecko:
    "https://api.iconify.design/arcticons:coingecko.svg (Arcticons CC-BY-SA-4.0)",
  cow: "https://cow.fi/learn/press",
  defillama: "https://github.com/DefiLlama/defillama-app",
  dune: "https://dune.com/about",
  dydx: "https://www.dydx.foundation/brand",
  etherscan: "https://etherscan.io/assets/svg/logos/logo-etherscan.svg",
  github:
    "https://raw.githubusercontent.com/simple-icons/simple-icons/777807a262bb7384ff406fd4b35fdcd02e9514c3/icons/github.svg",
  gmx: "https://gmx.io/",
  hyperliquid: "https://hyperfoundation.org/media",
  jupiter: "https://developers.jup.ag/docs/resources/brand-kit",
  kaito: "https://www.kaito.ai/",
  kalshi: "https://kalshi.com/brand",
  khalani: "https://khalani.network/",
  krexa: "https://krexa.xyz/images/krexa-logo.webp",
  lifi: "https://li.fi/brand-guidelines",
  limitless: "https://limitless.exchange/",
  linear:
    "https://raw.githubusercontent.com/simple-icons/simple-icons/777807a262bb7384ff406fd4b35fdcd02e9514c3/icons/linear.svg",
  manifold: "https://manifold.markets/",
  marinade:
    "https://raw.githubusercontent.com/0xa3k5/web3icons/64e21e68cc6eaa36ff9d0a135ca2c809a759ccd6/raw-svgs/tokens/mono/MNDE.svg",
  molinar: "apps/landing/public/assets/logos/molinar.svg",
  morpho: "https://morpho.org/",
  neynar: "https://neynar.com/",
  notion:
    "https://raw.githubusercontent.com/simple-icons/simple-icons/777807a262bb7384ff406fd4b35fdcd02e9514c3/icons/notion.svg",
  okx: "https://raw.githubusercontent.com/0xa3k5/web3icons/64e21e68cc6eaa36ff9d0a135ca2c809a759ccd6/raw-svgs/exchanges/mono/okx.svg",
  oneinch: "https://1inch.com/press-room",
  para: "https://www.getpara.com/press-kit",
  pelagos: "https://www.pelagos.capital/",
  polymarket: "https://polymarket.com/",
  slack:
    "https://api.iconify.design/simple-icons:slack.svg (Simple Icons CC0 snapshot)",
  solscan: "https://solscan.io/favicon.ico",
  stablefx:
    "https://cdn.prod.website-files.com/668c08d1b8a9330bd1d786ad/669a20df8ac2810a6dd50e67_favicon-256.svg",
  uniswap:
    "https://raw.githubusercontent.com/0xa3k5/web3icons/64e21e68cc6eaa36ff9d0a135ca2c809a759ccd6/raw-svgs/exchanges/mono/uniswap.svg",
  vaultsfyi:
    "https://mintcdn.com/vaultsfyi/LV19mJjFpALwuFJ6/images/icon_blue.png",
  x: "https://raw.githubusercontent.com/simple-icons/simple-icons/777807a262bb7384ff406fd4b35fdcd02e9514c3/icons/x.svg",
  yearn: "https://yearn.fi/",
  zerox: "https://0x.org/about",
  zora: "https://zora.co/",
} as const;

/** Curated variants which intentionally share their parent brand mark. */
export const appIconBrandAliases = {
  "morpho-vaults": "morpho",
  "para-consumer": "para",
  "polymarket-rewards": "polymarket",
} as const;

/** Built-in modes and generic integrations use semantic local marks. */
export const appIconSemanticSources = {
  default: "AllAppsIcon",
  auto: "AutoModeIcon",
  orchestrator: "AutoModeIcon",
  svm: "SolanaIcon",
  "svm-transfer": "SolanaIcon",
  "world-markets": "Globe2Icon",
} as const;
