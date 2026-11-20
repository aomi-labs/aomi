---
"@aomi-labs/client": minor
"@aomi-labs/widget": minor
"@aomi-labs/cli": minor
"@aomi-labs/deploy": minor
---

One word per thing: a mention is an agent, package, chain or wallet. `CapabilityKind` drops `skill`; a saved message's `skill` mention or "Preferred skill ids" line is read back as a package, and the widget still draws its old `✦` tag as a package. The "@" picker lists packages only. `AomiPackage.live.release` and `envelope.hash` are `null` for a host package, and the Library hides the release line for it. Trace chips: `ToolChip.attribution` is `"agent" | "skill"` (was `"toolset"`). The CLI's `aomi pipeline` takes `--agent` and `--package` (was `--toolset`, `--skill`) and lists with `agents`, `packages` and `package <name>` (was `toolsets`, `skills`, `skill`). Transaction cards keep titles to four words, with the full label on hover. `@aomi-labs/deploy` drops the unused `ScaffoldInput` template type.
