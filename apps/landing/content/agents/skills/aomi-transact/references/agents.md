# Agents and packages

A chat target is one canonical agent slug, such as `aomi/main`.

```bash
aomi chat "Find lending rates for USDC" --agent aomi/main
```

The main agent uses its own tools and enabled packages. List the agents with
Pipeline operations with `aomi pipeline agents`, and the packages with
`aomi pipeline packages`; `aomi pipeline ops --agent <name>` shows an agent's
operations.
The account's Library lists packages and their enablement. An agent key resolves
one private agent; never put a key in the message body or URL.

Use the returned simulation and confirmation before approving a transaction.
A refusal is a boundary: changing targets does not bypass it. Build a package
with the companion `aomi-build` skill when a new integration is needed.
