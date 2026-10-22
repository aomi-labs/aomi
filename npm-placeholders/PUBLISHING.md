# Publishing placeholders (maintainers)

Reserve the six unscoped npm names to defend against name-squatting and fake-MCP malware. These packages are intentionally empty and contain no install scripts.

Official Aomi packages live under the `@aomi-labs` scope. See `docs/topics/security/official-install-paths.md`.

Commands:

```bash
# 1) Publish the scoped skills meta-package
cd npm-packages/aomi-labs-skills
npm publish --access public

# 2) Publish each unscoped placeholder
for name in aomi aomi-mcp aomi-cli aomi-sdk aomi-skills aomi-transact; do
  (cd ../npm-placeholders/$name && npm publish --access public)
done
```

Notes:
- These are one-time reservations; do not add code or postinstall hooks.
- If a name is already taken, do not publish under a slightly different name — update docs to point at the official scoped packages instead.

