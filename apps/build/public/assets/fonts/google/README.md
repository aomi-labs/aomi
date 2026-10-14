# Host fonts

These unchanged Google Fonts WOFF2 subsets preserve the typography supplied by
`next/font/google` in Portal and Build at commit
`9ab669efcfa9572ef6166e71588ae00d089c55d3`. They were copied from that
checkout's local Next font cache. Geist latin, Geist Mono latin, and PT Serif
400/700 latin reuse the byte-identical files already committed in Landing.
Each app carries its own files, so deployment does not depend on another app.
`SHA256SUMS` records the exact bytes; `LICENSE.txt` contains the OFL 1.1 notices.

The accompanying CSS preserves every cached Unicode subset, normal style,
Geist/Geist Mono variable weights 100–900, PT Serif weights 400 and 700,
Source Serif 4 weight 600, `swap` display, and Next's adjusted fallback metrics.
The five latin faces remain preloaded. Portal sets variables on body; Build
sets them on html, matching their previous host layouts.

Licenses: [Geist](https://github.com/google/fonts/blob/main/ofl/geist/OFL.txt),
[Geist Mono](https://github.com/google/fonts/blob/main/ofl/geistmono/OFL.txt),
[PT Serif](https://github.com/google/fonts/blob/main/ofl/ptserif/OFL.txt),
[Source Serif 4](https://github.com/google/fonts/blob/main/ofl/sourceserif4/OFL.txt).
