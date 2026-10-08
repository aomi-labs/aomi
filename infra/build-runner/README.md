# /build sandbox runner image

The golden image `/build` sandbox runs boot from. One Vercel Sandbox per build run; the BFF
dispatches `aomi-smither run-plan` inside it; all run state lands in the
shared Postgres the web tier reads.

## Build & push to Vercel Container Registry

Sandbox only boots images with a `linux/amd64` manifest (anything else shows
as `Unoptimized` in VCR and is rejected), so always build via buildx with an
explicit platform — a plain `docker build` on an Apple Silicon Mac produces
arm64. Vercel recommends zstd compression for VCR pushes.

```bash
# from the repo root (see vercel.com/docs/container-registry for login)
docker buildx build \
  --platform linux/amd64 \
  --build-arg AOMI_SDK_REF=<released aomi-sdk sha> \
  --build-arg AOMI_REF=<aomi sha with the smither package> \
  --secret id=gh_token,env=GH_TOKEN \
  --output "type=image,name=vcr.vercel.com/<team>/<project>/build-runner:v1,push=true,oci-mediatypes=true,compression=zstd,compression-level=3,force-compression=true" \
  infra/build-runner
```

After the push, wait for the repository to report `Ready` in VCR (it prepares
an optimized image first); `Sandbox.create()` returns `image_not_ready` until
then.

Rebuild on aomi-sdk releases (pin `AOMI_SDK_REF` to the release sha — image
releases are the freshness mechanism; runs execute with
`AOMI_ALLOW_STALE_SDK=1` and never `git fetch`).

## Wiring the web app (staging first)

| Env | Value |
| --- | --- |
| `AOMI_BUILD_RUNNER` | `vercel-sandbox` |
| `AOMI_RUNNER_IMAGE` | `build-runner:v1` (or fully-qualified VCR URL) |
| `SMITHER_DATABASE_URL` | shared Postgres for run state |
| `SMITHER_OPENROUTER_API_KEY` | OpenRouter key billed for curate/repair agents (default path — cheap Kimi via OpenRouter's Anthropic-compatible endpoint) |
| `SMITHER_OPENROUTER_MODEL` | optional, default `moonshotai/kimi-k2.7-code` |
| `SMITHER_ANTHROPIC_API_KEY` | Anthropic key — backup billing path, used only when the OpenRouter key is absent |
| `AOMI_SANDBOX_VCPUS` | optional, default 4 |
| `AOMI_SANDBOX_SDK_ROOT` | optional, default `/workspace/aomi-sdk` |
| `AOMI_SANDBOX_SMITHER_DIR` | optional, default `/workspace/aomi/packages/smither` |

Sandbox auth is ambient on Vercel (OIDC); local testing of the dispatch path
needs `vercel link` + `vercel env pull` for a dev OIDC token.

## Lifecycle notes

- Sandboxes are created at the 5-minute ceiling and extended lazily from the
  page's poll path. An abandoned run lets its sandbox lapse; re-creating the
  same app resumes the run (same run id) in a fresh sandbox from store state.
- Cancel = durable store write (the in-sandbox engine polls it); stopping the
  sandbox is best-effort cleanup.
- Known gaps until Phase 4: the Files panel and crate download read the
  server's local filesystem, so they're empty for sandbox runs (fix: read the
  tree via `sandbox.readFile`/store artifacts); per-user quotas and the
  `build_runs` registry (cross-instance sandbox extend/stop) need the
  registry-table decision.
