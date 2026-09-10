/**
 * Provenance for skill marks. Keep unsupported entries explicit so a future
 * contributor does not silently substitute an invented protocol logo.
 */
export const skillIconSources = {
  cctp: "https://cdn.prod.website-files.com/668c08d1b8a9330bd1d786ad/669a20df8ac2810a6dd50e67_favicon-256.svg",

  krexa: "https://krexa.xyz/images/krexa-logo.webp",
  meteora: "https://www.meteora.ag/icons/v2.svg",
  marinade:
    "https://raw.githubusercontent.com/0xa3k5/web3icons/64e21e68cc6eaa36ff9d0a135ca2c809a759ccd6/raw-svgs/tokens/mono/MNDE.svg",
  mantle_staked_eth: "https://www.methprotocol.xyz/logo/meth-black.svg",
  lido: "https://raw.githubusercontent.com/0xa3k5/web3icons/64e21e68cc6eaa36ff9d0a135ca2c809a759ccd6/raw-svgs/tokens/mono/LDO.svg",
  kelp: "https://kelpdao.xyz/",
  eigenlayer: "https://www.eigenlayer.xyz/",
  drift:
    "https://cdn.prod.website-files.com/6310e7dee49f0866da8eed4c/69b12f86f598d941e5937599_D-logo.svg",
  debridge:
    "https://raw.githubusercontent.com/0xa3k5/web3icons/64e21e68cc6eaa36ff9d0a135ca2c809a759ccd6/raw-svgs/tokens/mono/DBR.svg",
  avantis: "https://www.avantisfi.com/images/avantis-logo.svg",
  aave: "https://github.com/aave-dao/aave-brand-kit/tree/main/Logo",
  across: "https://across.to/",
  aerodrome: "https://aerodrome.finance/svg/AERO/favicon.svg",
  arbitrum_bridge: "https://arbitrum.io/brand-kit",
  base_native: "https://base.org/brand",
  compound: "https://compound.finance/images/compound-logo.svg",
  convex: "https://www.convexfinance.com/logos/convex-white.svg",
  curve: "https://www.convexfinance.com/static/icons/svg/crv.svg",
  etherfi: "https://www.ether.fi/assets/etherfi-logo.svg",
  jupiter: "https://developers.jup.ag/docs/resources/brand-kit",
  kamino: "https://kamino.com/assets/app-common.1788795681.js",
  lifi_swap: "https://li.fi/brand-guidelines",
  morpho: "https://morpho.org/",
  oneinch: "https://1inch.com/press-room",
  openbook:
    "https://raw.githubusercontent.com/openbook-dex/resources/main/brand/OpenBook-Logomark.svg",
  optimism_native: "https://www.optimism.io/brand",
  pendle:
    "https://raw.githubusercontent.com/0xa3k5/web3icons/64e21e68cc6eaa36ff9d0a135ca2c809a759ccd6/raw-svgs/tokens/mono/PENDLE.svg",
  raydium:
    "https://raw.githubusercontent.com/0xa3k5/web3icons/64e21e68cc6eaa36ff9d0a135ca2c809a759ccd6/raw-svgs/tokens/mono/RAY.svg",
  renzo: "https://www.renzoprotocol.com/",
  robinhood_stocks: "https://robinhood.com/us/en/about-us/",
  rocket_pool:
    "https://raw.githubusercontent.com/0xa3k5/web3icons/64e21e68cc6eaa36ff9d0a135ca2c809a759ccd6/raw-svgs/tokens/mono/RPL.svg",
  sanctum: "https://www.sanctum.so/",
  squads:
    "https://raw.githubusercontent.com/0xa3k5/web3icons/64e21e68cc6eaa36ff9d0a135ca2c809a759ccd6/raw-svgs/wallets/mono/squads.svg",
  stargate:
    "https://raw.githubusercontent.com/0xa3k5/web3icons/64e21e68cc6eaa36ff9d0a135ca2c809a759ccd6/raw-svgs/tokens/mono/STG.svg",
  sushiswap:
    "https://raw.githubusercontent.com/0xa3k5/web3icons/64e21e68cc6eaa36ff9d0a135ca2c809a759ccd6/raw-svgs/exchanges/mono/sushiswap.svg",
  uniswap:
    "https://raw.githubusercontent.com/0xa3k5/web3icons/64e21e68cc6eaa36ff9d0a135ca2c809a759ccd6/raw-svgs/exchanges/mono/uniswap.svg",
  yearn: "https://yearn.fi/",
  zksync_era_native:
    "https://raw.githubusercontent.com/0xa3k5/web3icons/64e21e68cc6eaa36ff9d0a135ca2c809a759ccd6/raw-svgs/networks/mono/zksync.svg",
  zora: "https://zora.co/",
} as const;

/** Generic marks reused for skills whose semantics are the asset itself. */
export const skillIconGenericAliases = {
  dummy: "FlaskConicalIcon",
  common_erc20: "CoinsIcon",
} as const;

/** Built-in skills with no confidently attributable mark in this package. */
export const skillIconFallbacks = [] as const;
