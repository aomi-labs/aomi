# App names and logos in the Portal

Reviewed in `portal-ui-local` on 2026-09-07 after the skill artwork correction.
App installation and routing identifiers are unchanged by this work.

## Implemented

The Library now uses the same local app icon map as the composer, Direct
selector, and mentions. Google favicon requests and colored DECOR tiles have
been removed. A shared app identity resolver supplies curated names, aliases,
and brand keys; all 39 apps observed in the live catalog are included, together
with the larger curated catalog. Integration variants retain distinct names
(e.g. Morpho Vaults and Polymarket Rewards). Wire names and application IDs
remain untouched and raw names remain searchable.

Explicitly private descriptors keep the publisher’s nonblank label and an
empty brand key, so a private app named `github` cannot borrow GitHub artwork.
Unknown apps use a clean label or a humanized ID and a neutral monogram.
There is no supported publisher-icon field in the current typed API; adding
scoped, validated publisher artwork remains future catalog work.

`/dev/app-identities` is a development-only audit page showing the entire
curated/live union at Library and inline sizes in light and dark themes,
including private-name collision fixtures.

The sections below record the original investigation and design rationale.

## Previous behavior

The Library calls the account catalog (`GET /api/account/apps`) through
`packages-api.ts`, normalizes each descriptor, and passes it to
`toCatalogPackage` in `packages-catalog.ts`. The typed descriptor has `name`,
`label`, `applicationId`, `platform`, release/status/visibility fields, secret
slots, and chain IDs. It has no supported icon or brand metadata field.
The Rust `AppSpec` does have an optional unstructured `metadata: Value` field;
the descriptor normalizer preserves unknown fields at runtime, but the typed
client contract and these UI components do not interpret it for presentation.
An explicit contract can use this existing metadata channel rather than adding
another parallel bag of fields.

The Library adds its own hardcoded `DECOR` table. A name in that table gets a
pretty label, background/foreground colors, category, copy, and usually an
`iconDomain`. `PackageIcon` displays that domain's Google favicon as a CSS
background image at 68% of the tile. There are currently no `iconUrl` values in
DECOR. The existing optional URL mechanism is also local decoration, not an
icon supplied by the catalog. There is no image-load fallback in this CSS path.
Unknown entries get a monogram.

The composer and Direct app selector use another system: `app-metadata.ts`
provides names/categories/aliases and `icons/app-map.tsx` provides locally
bundled SVG components. Mentions use this same app icon lookup. Those assets
already exist, but the production Library's `PackageIcon` does not use them.

Naming precedence differs too:

| Surface                    | Name precedence                                   |
| -------------------------- | ------------------------------------------------- |
| Library                    | DECOR override → descriptor label → raw wire name |
| Composer / Direct selector | descriptor label → getAppInfo display name        |
| getAppInfo fallback        | split hyphens/underscores and title-case the ID   |

Concrete examples of drift: `default` is “Aomi Core” in Library decoration and
“Basic” in app metadata. `lifi` has “LI.FI” and a local SVG in composer metadata,
but no Library decoration, so its Library appearance depends on the backend
label and otherwise falls back to the raw `lifi` ID and a monogram. Alias
handling also differs: metadata recognizes `polymarket_rewards`, while the icon
map only explicitly includes the hyphenated variant. `getAppIcon` does not trim
or lowercase input even though the name resolver does.

## Design rationale and future catalog contract

Use one shared app identity resolver and one visual component in the Library,
composer, Direct selector, mentions, and other app surfaces. Resolve the
canonical brand key once; derive the display name and icon from that same key.
Preserve `applicationId`, platform, and wire name for installation and routing.
A display-name cleanup must never rename those identifiers.

For the curated official apps, use local reviewed SVG marks, just as with the
skills. Reuse the same brand asset when an app and a skill belong to the same
protocol. Keep one source file and attribution record per brand, then generate
bundled components for the widget and registry. Do not duplicate another set
of logos under Portal public assets. Normalize optical size, padding, and theme
treatment; reuse the skill identity tile's restrained background and border.

Replace the favicon path with the local mark for known apps. For a custom app,
use publisher-provided display metadata when available, with a monogram fallback
for a missing or failed image. A source-backed high-resolution raster is a valid
exception when a publisher has no SVG; an automatic trace or an SVG wrapper is
not equivalent to original vector artwork. Do not force multicolor artwork
into monochrome if doing so destroys the mark.

Use concise brand names such as “LI.FI”, “1inch”, “CoW Protocol”, and “DefiLlama”.
Show integration variants as secondary text when users need to distinguish
them. Use a curated label for official apps, a nonblank publisher label for
custom apps, and a humanized ID only as the last fallback. Keep the raw ID
searchable. One canonical alias table should serve both names and logos.

Longer term, add an explicit presentation contract to the app catalog: display
name, short description, brand key, optional light/dark icon assets, and icon
version/hash. Scope custom metadata by application identity (application ID or
platform + wire name), rather than assuming that every matching name is the
same published app. Cache publisher images and verify their load/fallback
behavior. The current frontend-only table can cover the curated catalog without
waiting for this API change.

## Relevant implementation

- `apps/portal/src/components/shell/packages-api.ts`
- `apps/portal/src/components/shell/packages-catalog.ts`
- `apps/portal/src/components/shell/package-row.tsx`
- `apps/shadcn-registry/src/components/control-bar/app-metadata.ts`
- `apps/shadcn-registry/src/components/icons/app-map.tsx`
- `apps/shadcn-registry/src/components/control-bar/app-select.tsx`
- `apps/shadcn-registry/src/components/assistant-ui/capability-composer.tsx`
- `apps/shadcn-registry/src/components/assistant-ui/capability-message-text.tsx`
- `packages/client/src/types.ts` (`AomiAppDescriptor`)
- `packages/client/src/app-descriptor.ts` (`normalizeAppDescriptor`)
