/**
 * Regenerate the TypeScript contract from the FastAPI OpenAPI spec.
 *
 *   Pydantic schemas ──► app.openapi() ──► openapi-typescript ──► src/generated/schema.d.ts
 *
 * `app.openapi()` is pure route introspection — no running server, no DB, no
 * env required. So this runs identically on a laptop and in CI.
 *
 * Usage:
 *   node scripts/generate.mjs           # regenerate + write schema.d.ts
 *   node scripts/generate.mjs --check   # regenerate to a temp file and fail
 *                                        # if it differs from the committed one
 *                                        # (the CI staleness gate)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(here, '..');

// Exact-pinned openapi-typescript version, read from package.json so the npx
// fallback can never resolve a different build than the local install.
const PINNED_VERSION = JSON.parse(
  readFileSync(resolve(pkgDir, 'package.json'), 'utf8'),
).devDependencies['openapi-typescript'];
const repoRoot = resolve(pkgDir, '..', '..');
const apiDir = resolve(repoRoot, 'apps', 'api');
const python = resolve(apiDir, '.venv', 'bin', 'python');
const specPath = resolve(tmpdir(), 'myetal-openapi.json');
const outPath = resolve(pkgDir, 'src', 'generated', 'schema.d.ts');

const check = process.argv.includes('--check');

// 1. Dump the OpenAPI spec straight from the app object.
const spec = execFileSync(
  python,
  [
    '-c',
    'import json,sys; from myetal_api.main import app; json.dump(app.openapi(), sys.stdout)',
  ],
  { cwd: apiDir, maxBuffer: 64 * 1024 * 1024 },
);
writeFileSync(specPath, spec);

const banner =
  '/**\n' +
  ' * GENERATED FILE — do not edit by hand.\n' +
  ' * Source of truth: apps/api Pydantic schemas.\n' +
  ' * Regenerate with `pnpm --filter @myetal/api-contract generate`.\n' +
  ' */\n';

const target = check ? resolve(tmpdir(), 'myetal-schema.check.d.ts') : outPath;
mkdirSync(dirname(outPath), { recursive: true });

// 2. Run openapi-typescript. Prefer the pinned workspace-local binary so the
//    output is deterministic (the version in package.json is exact-pinned to
//    keep the byte-comparison --check gate from flaking on a floating minor).
//    Only fall back to `npx --yes` on a fresh checkout before install — and
//    fail loudly if that fallback would silently pull a *different* version,
//    since that would defeat the determinism the gate depends on.
const localBin = resolve(pkgDir, 'node_modules', '.bin', 'openapi-typescript');
const [cmd, cmdArgs] = existsSync(localBin)
  ? [localBin, []]
  : ['npx', ['--yes', `openapi-typescript@${PINNED_VERSION}`]];

execFileSync(
  cmd,
  [
    ...cmdArgs,
    specPath,
    // Request models carry server-side defaults (ShareCreate.is_public,
    // ShareItemCreate.kind, …). openapi-typescript's default (`true`) makes
    // fields-with-a-default *required* — wrong for a request body the client
    // may omit. `false` makes any defaulted field optional. In the share
    // domain every defaulted field is request-side, so responses are
    // unaffected; other domains (reports/feedback) have a few defaulted
    // response fields that this also optionalises — that only *tightens*
    // read-safety, never loosens it.
    '--default-non-nullable',
    'false',
    '-o',
    target,
  ],
  { cwd: pkgDir, stdio: 'inherit' },
);

// Prepend the do-not-edit banner.
writeFileSync(target, banner + readFileSync(target, 'utf8'));

if (check) {
  const fresh = readFileSync(target, 'utf8');
  let committed = '';
  try {
    committed = readFileSync(outPath, 'utf8');
  } catch {
    /* missing → treated as stale below */
  }
  if (fresh !== committed) {
    console.error(
      '\n✗ src/generated/schema.d.ts is STALE.\n' +
        '  A Pydantic schema changed but the generated contract was not regenerated.\n' +
        '  Run: pnpm --filter @myetal/api-contract generate\n',
    );
    process.exit(1);
  }
  console.log('✓ contract is up to date');
} else {
  console.log('✓ generated', outPath);
}
