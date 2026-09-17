# Skill artwork

The SVG files in this directory are the reviewed local artwork used by the
Portal's Library, picker, mentions, trace, and activity rail. Exact retrieval
URLs are in `sources.json`; the complete built-in catalog (including reused
app/chain icons) is in `../source-manifest.ts`.

Run `node scripts/generate-skill-marks.mjs` from the repository root after edits.
The generated `../sourced-marks.ts` bundles the SVG geometry into the widget and
shadcn registry without depending on a Portal public directory or network fetch.
Use `--check` to verify that generated output matches its sources.

## Presentation

Preserve the source paths. Crop complete standalone symbols from wordmarks;
never keep the first few letters or sketch a substitute logo. The curated
assets use a square 24px canvas with balanced clear space and `currentColor`.
Where facets matter (Curve and Aerodrome), opacity preserves the source's tonal
separation. The Library gives these detailed symbols 20px in rows and 28px in
the inspector. Review `/dev/skill-icons` at 14px, 20px, and 32px in both themes.

Specific extractions:

- Avantis: the two symbol paths before the wordmark.
- Kamino: the complete standalone K from the site's `SvgKmnoLogo` component,
  without its containing token tile. The previous icon included the letter a.
- Ether.fi, Convex, Kelp, and EigenLayer/EigenCloud: complete symbol paths only.
- OpenBook: official logomark, without the black background.
- Sanctum: cloud symbol, without the blue containing tile or wordmark.
- Curve: original faceted torus from the CRV asset, with faces grouped by
  monochrome opacity. Geometry is retained, with coordinates rounded to 3dp.
- CCTP: Circle's own mark, rather than a generic dollar glyph.
- mETH: mETH's own mark, rather than the unrelated network or ETH icon.
- Zora: the existing Zorb geometry and grayscale gradient, with a unique paint
  server ID for every rendered instance. No invented Z overlay.

Common ERC-20 uses the shared coin glyph; Dummy uses a laboratory flask because
it is a developer testing capability, not a protocol brand. Unknown custom
skills continue to use the caller's neutral fallback.

Krexa is a documented raster exception: its published transparent 120px WebP
symbol is embedded locally as an alpha mask in `KrexaSkillIcon`, so it follows
`currentColor` in both themes without retaining its original blue color.
Preserve it until the publisher
provides vector artwork; wrapping a bitmap in SVG does not make it a vector.
Source: https://krexa.xyz/images/krexa-logo.webp

## Attribution

Some monochrome assets are vendored from the MIT-licensed Web3 Icons project
(https://github.com/0xa3k5/web3icons); upstream license declaration and attribution are retained here. Other marks
come from the protocols' own sites and brand repositories, as recorded in
`sources.json`. Brand names and artwork remain their owners' trademarks.
