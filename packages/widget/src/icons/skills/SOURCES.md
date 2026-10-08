# Skill icon provenance

These marks are rendered as `currentColor` SVGs in the same 24px icon slot as
the app and chain registry. Existing registry marks are wrapped rather than
copied (`1inch`, `Optimism`, `Robinhood`, `Yearn`, and `Zora`). The remaining
protocol marks are compact symbol-only redraws based on the projects' own
brand or documentation pages so the UI can apply one neutral Aomi color.

Official sources consulted:

- [Aave brand kit](https://github.com/aave-dao/aave-brand-kit/tree/main/Logo)
- [Compound logo SVG](https://compound.finance/images/compound-logo.svg)
- [Convex Finance](https://www.convexfinance.com/)
- [Curve branding](https://resources.curve.finance/glossary-branding/branding/)
- [ether.fi](https://www.ether.fi/)
- [Jupiter brand kit](https://developers.jup.ag/docs/resources/brand-kit)
- [Kamino logo SVG](https://kamino.com/assets/logo.1788494054.svg)
- [OpenBook](https://github.com/openbook-dex)
- [Optimism](https://www.optimism.io/brand)
- [Pendle brand guide](https://www.pendle.finance/brand-guide/)
- [Raydium brand kit](https://docs.raydium.io/resources/brand-kit)
- [Renzo brand kit](https://docs.renzoprotocol.com/docs/resources/brand-kit)
- [Robinhood](https://robinhood.com/us/en/about-us/)
- [Rocket Pool](https://rocketpool.net/)
- [Sanctum](https://www.sanctum.so/)
- [Squads](https://squads.so/)
- [Stargate](https://stargate.finance/)
- [Sushi](https://www.sushi.com/)
- [Uniswap](https://uniswap.org/)
- [Yearn](https://yearn.fi/)
- [zkSync](https://zksync.io/)
- [Zora](https://zora.co/)

`white` is used only as a knockout inside a mark and is opacity-limited; no
brand color, gradient, external image, or remote reference is embedded.

The Curve, Convex, and ether.fi marks were adapted from the supplied SVG
attachments; Compound and Kamino use only the symbol portions of the supplied
official wordmark SVGs. Jupiter uses the supplied official mark paths with its
gradient fills reduced to one `currentColor` plus opacity layers.
