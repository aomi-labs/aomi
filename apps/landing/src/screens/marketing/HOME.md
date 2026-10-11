# Landing homepage

The `/` homepage is served directly by `route.ts` from the files under
`public/assets/landing/home/`. Product, solution, pricing, and resource pages
use the React marketing layout.

The homepage bundle contains:

- `index.html` — the page markup and local font declarations;
- `component-source.js` — the homepage interaction state machine;
- `resources.js` — semantic asset-name mappings used by the state machine;
- `fonts/`, `logos/`, and `vendor/` — named, cacheable runtime dependencies.

The bundle is production source. Keep dependencies named, retain only the
Latin font subsets used by the English site, and compare `/` at desktop and
mobile widths after changing markup, styles, assets, or interactions.
