# GitHub Actions — Node 20 deprecation cleanup

**Status:** Backlog — quick task, soft deadline
**Created:** 2026-05-09
**Owner:** James
**Effort estimate:** ~10-20 min

---

## TL;DR

GitHub is forcing all Actions to Node 24 by **June 2nd, 2026** (default switch) and removing Node 20 entirely on **September 16th, 2026**. Two of our actions still run on Node 20:

- `actions/checkout@v4`
- `astral-sh/setup-uv@v3`

Surfaced as a CI warning on the staging deploy at 2026-05-09. Not breaking yet — just noisy.

---

## What to do

Pin both to the latest major versions (`v5` for both, last I checked) across all workflow files:

- `.github/workflows/api-image.yml`
- `.github/workflows/api-tests.yml`
- `.github/workflows/deploy-staging.yml`

Verify the new versions still work end-to-end on a staging push (one round-trip). No code changes elsewhere needed — these are GHA-only.

---

## Why deferred

- Not breaking until June 2026 default-switch (and Sept 2026 removal)
- Three workflow files, ~5 lines each
- Easy to bundle with the next "I have 15 min between tasks" gap

If a workflow break happens before this is done, the temporary opt-out is `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true` in the env block — but no reason to leave it that way long-term.

---

## Other deprecations to watch in the same sweep

Quick check at upgrade time:

- `docker/setup-qemu-action@v3` — verify still current
- `docker/setup-buildx-action@v3` — same
- `docker/login-action@v3` — same
- `docker/build-push-action@v6` — same
- `appleboy/ssh-action@v1.2.0` — same (used in deploy-staging)
- `twingate/github-action@v1` — same

Bump any of these that have a v-major bump available, but only if release notes say "no breaking changes for our usage." Don't blanket-upgrade.
