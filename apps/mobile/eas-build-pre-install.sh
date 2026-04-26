#!/usr/bin/env bash
set -euo pipefail

# EAS Build's worker image ships with pnpm 8.7.5; our root package.json
# pins "engines.pnpm: >=9" + "packageManager: pnpm@9.12.0". pnpm 8 sees
# the engines field and refuses to install with ERR_PNPM_UNSUPPORTED_ENGINE.
#
# Use corepack (bundled with Node 16+) to download and activate the pnpm
# version pinned in packageManager. This runs before EAS's own
# `pnpm install --frozen-lockfile` step.
corepack enable
corepack prepare pnpm@9.12.0 --activate

echo "[eas-build-pre-install] activated pnpm $(pnpm -v)"
