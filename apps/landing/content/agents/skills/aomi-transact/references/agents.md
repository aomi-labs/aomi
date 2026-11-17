# Agents and toolsets

A chat target is one canonical agent slug, such as `aomi/main`.

```bash
aomi chat "Find lending rates for USDC" --agent aomi/main
```

The main agent uses built-in toolsets (`default`, `svm`, and `svm-*`) and enabled
packages. Discover the current Pipeline toolsets with `aomi pipeline toolsets`;
use `aomi pipeline ops --toolset default` to inspect their operations.
The account's Library lists packages and their enablement. An agent key resolves
one private agent; never put a key in the message body or URL.

Use the returned simulation and confirmation before approving a transaction.
A refusal is a boundary: changing targets does not bypass it. Build a package
with the companion `aomi-build` skill when a new integration is needed.
