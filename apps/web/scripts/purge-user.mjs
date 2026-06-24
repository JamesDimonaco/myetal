#!/usr/bin/env node
/**
 * Dev helper: wipe a user's ORCID-OAuth state (or the whole user row)
 * so you can re-test the ORCID sign-in flow against a clean slate
 * without an admin UI.
 *
 * Usage:
 *
 *   # Default: clear the OAuth account row + session(s) so the next
 *   # ORCID sign-in re-runs as if for the first time. Keeps the user
 *   # row + their data + audit history intact. Use this for iterating
 *   # on the email-backfill / link-existing-user flow.
 *   pnpm purge-user --orcid 0009-0001-7329-1342
 *   pnpm purge-user --email user@example.com
 *
 *   # `--mode=claim`: also clear users.orcid_id so the next sign-in
 *   # falls into the "no user row claims this iD" branch (new-user
 *   # creation path). User row + data preserved.
 *   pnpm purge-user --orcid 0009-... --mode=claim
 *
 *   # `--mode=hard`: delete the user row entirely. Cascades sessions,
 *   # accounts, shares, user_papers, orcid_sync_runs. Leaves
 *   # share_paper.uploaded_by / share_view.viewer_user_id / share_report.*
 *   # NULL (FK is SET NULL). Will fail if admin_audit has rows where
 *   # this user is `admin_user_id` (FK is RESTRICT, NOT NULL) — pass
 *   # --force-audit to delete those audit rows first.
 *   pnpm purge-user --email james@... --mode=hard --force-audit
 *
 *   # `--yes`: skip confirmation prompt (CI / scripts).
 *
 *   # Environment: requires DATABASE_URL. Pull from Vercel first:
 *   #   vercel env pull --environment=preview .env.purge
 *   #   set -a; source .env.purge; set +a
 *   #   pnpm purge-user --orcid ...
 *
 * Safety: prints what will be affected, prompts for confirmation,
 * wraps the destructive work in a transaction. Operates only on the
 * single user resolved by the lookup arg. Not designed to be called
 * from server code.
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout, argv, env, exit } from 'node:process';

import pg from 'pg';

function parseArgs(rawArgv) {
  const out = { mode: 'oauth', yes: false, forceAudit: false };
  for (let i = 0; i < rawArgv.length; i++) {
    const a = rawArgv[i];
    if (a === '--orcid' || a === '--email') {
      out[a.slice(2)] = rawArgv[++i];
    } else if (a === '--mode') {
      out.mode = rawArgv[++i];
    } else if (a === '--yes' || a === '-y') {
      out.yes = true;
    } else if (a === '--force-audit') {
      out.forceAudit = true;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    } else {
      console.error(`Unknown arg: ${a}`);
      exit(2);
    }
  }
  return out;
}

const HELP = `purge-user — dev helper for ORCID sign-in testing

  --orcid <id>        ORCID iD to target (e.g. 0009-0001-7329-1342)
  --email <addr>      Email to target (alternative to --orcid)
  --mode <m>          oauth (default) | claim | hard
                       oauth — drop account+session, keep user + orcid_id
                       claim — also clear users.orcid_id
                       hard  — delete the user row entirely (cascades)
  --force-audit       With --mode=hard: also DELETE admin_audit rows
                       where this user is admin_user_id (otherwise
                       RESTRICT FK blocks the user delete)
  --yes, -y           Skip confirmation prompt
  -h, --help          Show this help

  env DATABASE_URL    Required. Pull via 'vercel env pull' first.
`;

const args = parseArgs(argv.slice(2));

if (args.help) {
  console.log(HELP);
  exit(0);
}

if (!args.orcid && !args.email) {
  console.error('Need --orcid <id> OR --email <addr>. See --help.');
  exit(2);
}
if (!['oauth', 'claim', 'hard'].includes(args.mode)) {
  console.error(`--mode must be one of: oauth, claim, hard (got: ${args.mode})`);
  exit(2);
}

const rawUrl = env.DATABASE_URL;
if (!rawUrl) {
  console.error(
    'DATABASE_URL is not set. Pull it first:\n' +
      '  vercel env pull --environment=preview .env.purge\n' +
      '  set -a; source .env.purge; set +a',
  );
  exit(2);
}
// Tolerate the SQLAlchemy URL form the API uses.
const connectionString = rawUrl.replace(/^postgresql\+asyncpg:\/\//, 'postgresql://');

const pool = new pg.Pool({ connectionString });

function shortHost(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}/${u.pathname.slice(1)}`;
  } catch {
    return '<unparseable>';
  }
}

async function lookupUser(client) {
  if (args.orcid) {
    const r = await client.query(
      'SELECT id, email, name, orcid_id, created_at FROM users WHERE orcid_id = $1',
      [args.orcid],
    );
    return r.rows[0] ?? null;
  }
  const r = await client.query(
    'SELECT id, email, name, orcid_id, created_at FROM users WHERE email = $1',
    [args.email],
  );
  return r.rows[0] ?? null;
}

async function confirm(prompt) {
  if (args.yes) return true;
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question(`${prompt} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === 'y' || answer === 'yes';
}

async function main() {
  console.log(`DB: ${shortHost(connectionString)}`);
  console.log(`Mode: ${args.mode}${args.forceAudit ? ' (+force-audit)' : ''}`);

  const client = await pool.connect();
  try {
    const user = await lookupUser(client);
    if (!user) {
      console.error(
        `No user found for ${args.orcid ? `orcid_id=${args.orcid}` : `email=${args.email}`}.`,
      );
      exit(1);
    }
    console.log('\nTarget user:');
    console.log(`  id:        ${user.id}`);
    console.log(`  email:     ${user.email}`);
    console.log(`  name:      ${user.name}`);
    console.log(`  orcid_id:  ${user.orcid_id ?? '(null)'}`);
    console.log(`  created:   ${user.created_at?.toISOString?.() ?? user.created_at}`);

    // Count what will be affected.
    const counts = await client.query(
      `SELECT
        (SELECT COUNT(*) FROM account WHERE user_id = $1) AS accounts,
        (SELECT COUNT(*) FROM session WHERE user_id = $1) AS sessions,
        (SELECT COUNT(*) FROM admin_audit WHERE admin_user_id = $1) AS audit_as_actor`,
      [user.id],
    );
    const c = counts.rows[0];
    console.log(
      `\nAttached: ${c.accounts} account row(s), ${c.sessions} session(s), ${c.audit_as_actor} admin_audit row(s) (as actor)`,
    );

    let plan;
    if (args.mode === 'oauth') {
      plan = [
        ['DELETE FROM account WHERE user_id = $1', [user.id]],
        ['DELETE FROM session WHERE user_id = $1', [user.id]],
      ];
    } else if (args.mode === 'claim') {
      plan = [
        ['DELETE FROM account WHERE user_id = $1', [user.id]],
        ['DELETE FROM session WHERE user_id = $1', [user.id]],
        ['UPDATE users SET orcid_id = NULL, last_orcid_sync_at = NULL WHERE id = $1', [user.id]],
      ];
    } else {
      // hard
      plan = [];
      if (args.forceAudit && Number(c.audit_as_actor) > 0) {
        plan.push(['DELETE FROM admin_audit WHERE admin_user_id = $1', [user.id]]);
      }
      plan.push(['DELETE FROM users WHERE id = $1', [user.id]]);
    }

    console.log('\nWill execute:');
    for (const [sql] of plan) {
      console.log(`  ${sql}`);
    }

    if (!(await confirm('\nProceed?'))) {
      console.log('Aborted.');
      exit(0);
    }

    await client.query('BEGIN');
    try {
      for (const [sql, params] of plan) {
        const r = await client.query(sql, params);
        console.log(`  ${sql.split(' ')[0]} ${sql.match(/(FROM|UPDATE)\s+(\w+)/i)?.[2]}: ${r.rowCount} row(s)`);
      }
      await client.query('COMMIT');
      console.log('\nDone.');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('\nFailed; transaction rolled back:', err.message);
      if (args.mode === 'hard' && !args.forceAudit && /admin_audit/.test(err.message)) {
        console.error(
          '  Hint: this user is referenced by admin_audit.admin_user_id ' +
            '(FK is RESTRICT). Re-run with --force-audit to delete those ' +
            'audit rows first.',
        );
      }
      exit(1);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
