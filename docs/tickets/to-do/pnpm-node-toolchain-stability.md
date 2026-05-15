# pnpm + Node toolchain stability

**Status:** Backlog — small but worth doing before next major version bump
**Created:** 2026-05-15
**Owner:** James
**Effort estimate:** ~30-60 min focused work, plus a couple of follow-up bumps when the ecosystem catches up

---

## TL;DR

This session burned ~30 min of cutover-day attention on toolchain drift: pnpm 9 → 11 (by accident) → 11.1.2 incompatible with CI Node 20 → 11 hard-fails on unapproved postinstalls → settled on pnpm 10.16.1 + Node 22. Most of the churn was caused by no single source of truth for which pnpm / Node combo we support, plus a local `pnpm install` rewriting `packageManager` without anyone noticing.

The current commit sequence that resolved it:

| Commit | What |
|---|---|
| `1fbccf0` | bump packageManager pnpm@9.12.0 → 11.1.2 (oops, by accident) |
| `7d39b3e` | bump CI Node 20 → 22 (so pnpm 11 can run) |
| (this commit) | revert pnpm to 10.16.1 + add `pnpm-workspace.yaml::allowBuilds` to suppress pnpm 10's stricter postinstall-approval errors |

Net result is fine; the path to get there cost time we didn't have. This ticket captures the long-term cleanup.

---

## Why this kept happening

1. **`packageManager` is a moving target.** Each `pnpm install` from a different local pnpm version will overwrite the field to itself. The repo had it pinned to `9.12.0` originally; a local install from a Mac with pnpm 11.1.2 silently bumped it, breaking CI.
2. **CI Node version wasn't tied to pnpm version.** pnpm 11 quietly added a `node:sqlite` import that requires Node ≥ 22.13. CI was on Node 20. There's no `engines.node` matrix check before install.
3. **pnpm 10+ tightened postinstall approval into a fatal error.** Existing repos that didn't have an `allowBuilds` block suddenly fail to install. The default error message says "run `pnpm approve-builds`" — that's an interactive command unsuited to CI.
4. **No single doc explains "the toolchain":** node version, pnpm version, where builds are approved, and how to upgrade. Each cutover meeting starts from scratch.

---

## The proper fix (post-prod-bake)

### 1. Add a `.tool-versions` (asdf) + `.nvmrc` (nvm)

Single source of truth for the Node version. Both files are common in JS land; many local dev tools auto-pick them up.

```
# .nvmrc
22.13.0

# .tool-versions
nodejs 22.13.0
pnpm 10.16.1
```

CI workflow reads from these via `actions/setup-node@v4` `node-version-file: .nvmrc` and `pnpm/action-setup` `package_json_file: package.json`.

### 2. Lock the install-time approval list

Move all postinstall approvals into `pnpm-workspace.yaml::allowBuilds` (done in this commit) and **never** rely on the interactive `pnpm approve-builds` command. Document this in `apps/web/AGENTS.md` so future contributors know to add new entries there when a new dep with a postinstall script lands.

### 3. CI prelude assertion

Add a first step to `api-tests.yml` and any future workflow:

```yaml
- name: Assert toolchain
  run: |
    node --version | grep -E '^v22\.' || { echo "Need Node 22"; exit 1; }
    corepack enable
    pnpm --version
```

Fails fast with a clear message if Node and the workflow drift apart, instead of pnpm crashing several steps later.

### 4. Codeowners on `package.json` + `pnpm-lock.yaml` + workflows

Once there's a team, require review for any change to:
- `package.json` `packageManager` field
- `pnpm-lock.yaml`
- `.github/workflows/*.yml`

Until then (solo owner): mental note — eyeball any `packageManager` diff in `git status` before committing.

### 5. Bump cadence policy

Don't follow pnpm major versions until they're at least one minor release in. Pnpm 11.0/11.1 had a hard Node bump that wasn't documented prominently; waiting a few weeks would have caught it.

---

## When to pick this up

- **Cheap moment**: while waiting for a prod deploy to bake, or as a Friday-afternoon-30-min task.
- **Forcing function**: next time a contributor runs `pnpm install` and gets a "Cannot proceed with the frozen installation" error in CI. That's the third strike — act on it.
- **Hard deadline**: before any major dependency bump (Next.js 17, React 20, pnpm 11+ when we want it back).

---

## Out of scope

- Vendoring pnpm itself via corepack — corepack works but `actions/setup-node@v4`'s `cache: pnpm` flag is well-trodden.
- Switching package manager to bun / npm. Pnpm works; the issue is governance, not the tool.
- Renovate / Dependabot auto-bumps. Not running today; not the bottleneck.

---

## Acceptance

- [ ] `.nvmrc` and `.tool-versions` exist and agree with each other.
- [ ] `pnpm-workspace.yaml::allowBuilds` contains every dep with a postinstall.
- [ ] All workflows reference Node via `node-version-file: .nvmrc`.
- [ ] CI prelude asserts the Node major matches the file.
- [ ] `apps/web/AGENTS.md` (or root `CLAUDE.md`) has a "Toolchain" section: how to bump Node, how to bump pnpm, how to add a postinstall approval, how the lockfile is regenerated.

### Stale Node 20 references to clean up (sub-acceptance)

These exist in the repo today and need to be brought in line with the new Node 22 baseline:

- [ ] `apps/web/package.json:42` — `"@types/node": "^20"` → bump to `"^22"`. Types-only, no runtime risk; the gain is accurate typings for Node 22-only APIs (`node:sqlite`, `fetch` flags, etc.).
- [ ] `docs/tickets/to-do/prod-env-setup-checklist.md:33` — currently reads `"Node version = >= 20"`. Update to `>= 22` so the prod-cutover dry-run doesn't suggest pinning Vercel to 20.x. (Done inline with this ticket — minor.)
- [ ] `docs/tickets/to-do/gha-node20-deprecation.md` → per INDEX.md, status is "done in commit `a9f84e8`" but the file is still in `to-do/`. `git mv` to `done/`. (Done inline with this ticket — minor.)
- [ ] Audit Vercel project settings → Node Version → confirm it follows `engines.node` (it should pick up `>=22.13` automatically; sanity-check the build log for a `Detected Node.js version: 22.x` line on next deploy).
- [ ] Audit Railway service settings → Build → Node Version (if exposed; Python service so likely irrelevant — but the api-image workflow building the Docker image runs Node in the worker, so any cached image must use Node 22+).
- [ ] Audit `apps/mobile` Expo SDK 54 minimum Node — Expo 54 requires Node 20, supports 22. No bump needed but confirm the dev-build agent uses 22+ when it next runs.

---

## Triggers to revisit

- Pnpm 11.x lands in a stable form OR Node 22 becomes universal across our infra (Vercel, Railway, GHA defaults). At that point, re-evaluate.
- A new dep is added with a postinstall script and the install starts failing again — we know what to do (add to `allowBuilds`), but it should be one-line + a comment, not a 30-min detour.
