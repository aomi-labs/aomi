---
name: aomi-build
description: Build an Aomi package from API documentation, a spec, or a product requirement.
---

# Aomi Build

A package is a WASI component built with `aomi-sdk`. Its `aomi.toml` declares
identity, secret slots, network hosts, capabilities and limits. Tools implement
`Tool` with typed `Args` and return an `Outcome`. Export them with
`aomi_sdk::package!(ToolName)`.

Start with `aomi build init <dir> --publisher <slug>`, or
`aomi-build new-package <name>` for an OpenAPI source. Sources live under `packages/<name>/`. Build the
component for `wasm32-wasip2`; validate locally with mock upstreams. Package
publishing and promotion use numbered releases, and agent configuration lists
the packages it uses. A package never chooses wallets or bypasses host policy.
