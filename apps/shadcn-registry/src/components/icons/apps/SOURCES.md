# App icon provenance

Every curated app mark is bundled locally and rendered through `currentColor`.
The app registry never fetches a favicon or logo at runtime. Protocols which
also exist as skills reuse the corrected skill component, including Aave,
Jupiter, Krexa, LI.FI, Marinade, Morpho, Uniswap, Yearn, Zora, and Circle CCTP
for StableFX.

The three PNG sources are publisher favicons or publisher artwork. They remain
raster sources because no trustworthy original vector was available. The SVG
component applies each image as a per-instance alpha/luminance mask, so the
rendered mark still follows `currentColor` in light and dark themes. Cambrian
uses the symbol geometry from its published SVG with brand paint removed.

Exact source URLs and intentional shared/semantic identities live in
`source-manifest.ts`. `MolinarIcon` uses the existing publisher-supplied SVG in
the repository. `World Markets` has no verified external brand identity and
uses a globe; Aomi's built-in `default`, `auto`, and `orchestrator` modes use
semantic Aomi glyphs.

The CoinGecko outline comes from [Arcticons](https://github.com/Arcticons-Team/Arcticons),
licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
It is used without geometry changes; the wrapper raises the inherited stroke
width for legibility at the Portal's 20px size. Simple Icons sources are CC0.
The Web3 Icons exchange sources retain their upstream MIT notice in the
adjacent skills asset directory.
