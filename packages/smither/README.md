# @aomi-labs/smither

Smither composes package generation, tool curation, human questions and
validation into a resumable terminal workflow. Sources live under
`packages/<name>/` in the selected SDK checkout.

Use `aomi-smither --package <name> --sdk-root <path> --dry-run` to review the
plan. The `aomi-build new-package` command discovers a spec, generates the
client and tools, and builds the WASI component. Validation targets the
package's own Cargo manifest. The output includes the source tree and a crate
tarball for review.

Composed plans support compute and agent steps, clarify and approval gates,
validation loops, parallel branches and external signals. Publishing and
promotion use the separate `aomi release` commands and numbered package
releases or agent configs.
