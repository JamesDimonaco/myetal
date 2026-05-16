'use client';

import Link from 'next/link';
import { useState } from 'react';

import { formatRelativeTime } from '@/lib/format';
import type {
  AdminActivityEvent,
  AdminAuditEntry,
  AdminUserDetail,
  AdminUserShareRow,
} from '@/types/admin';

type Tab = 'shares' | 'library' | 'activity' | 'audit';

const ACTIVITY_LABELS: Record<string, string> = {
  signup: 'Signed up',
  sign_in: 'Signed in',
  share_create: 'Created share',
  share_publish: 'Published share',
  feedback_submit: 'Submitted feedback',
  report_submit: 'Submitted report',
  item_add: 'Added item',
};

const AUDIT_LABELS: Record<string, string> = {
  force_sign_out: 'Force-signed out',
  toggle_admin: 'Toggled admin',
  verify_email: 'Marked email verified',
  soft_delete_user: 'Soft-deleted',
  send_password_reset: 'Sent password-reset email',
  action_report: 'Actioned report',
};

export function UserTabs({ detail }: { detail: AdminUserDetail }) {
  const [tab, setTab] = useState<Tab>('shares');

  return (
    <div>
      <div className="flex flex-wrap gap-1 border-b border-rule">
        <TabButton
          active={tab === 'shares'}
          onClick={() => setTab('shares')}
          label={`Shares (${detail.shares.length})`}
        />
        <TabButton
          active={tab === 'library'}
          onClick={() => setTab('library')}
          label={`Library (${detail.library_paper_count})`}
        />
        <TabButton
          active={tab === 'activity'}
          onClick={() => setTab('activity')}
          label={`Activity (${detail.activity.length})`}
        />
        <TabButton
          active={tab === 'audit'}
          onClick={() => setTab('audit')}
          label={`Audit (${detail.audit.length})`}
        />
      </div>

      <div className="mt-6">
        {tab === 'shares' ? <SharesTab shares={detail.shares} /> : null}
        {tab === 'library' ? <LibraryTab detail={detail} /> : null}
        {tab === 'activity' ? (
          <ActivityTab events={detail.activity} />
        ) : null}
        {tab === 'audit' ? <AuditTab entries={detail.audit} /> : null}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative px-3 py-2 text-sm font-medium transition ${
        active ? 'text-ink' : 'text-ink-muted hover:text-ink'
      }`}
    >
      {label}
      {active ? (
        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-ink" />
      ) : null}
    </button>
  );
}

function SharesTab({ shares }: { shares: AdminUserShareRow[] }) {
  if (shares.length === 0) {
    return <p className="text-sm text-ink-faint">No shares.</p>;
  }
  return (
    <ul className="space-y-2">
      {shares.map((s) => (
        <li
          key={s.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rule bg-paper p-3"
        >
          <div className="min-w-0 flex-1">
            <Link
              href={`/c/${s.short_code}`}
              target="_blank"
              rel="noreferrer noopener"
              className="block truncate font-medium text-ink hover:underline"
            >
              {s.name}
            </Link>
            <p className="truncate text-xs text-ink-faint">
              /c/{s.short_code} · {s.item_count} item
              {s.item_count === 1 ? '' : 's'} · created{' '}
              {formatRelativeTime(s.created_at)}
            </p>
          </div>
          <div className="flex gap-1">
            {s.deleted_at ? (
              <span className="rounded-sm bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                Deleted
              </span>
            ) : s.published_at ? (
              <span className="rounded-sm bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                Published
              </span>
            ) : (
              <span className="rounded-sm bg-paper-soft px-2 py-0.5 text-xs font-medium text-ink-muted">
                Draft
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function LibraryTab({ detail }: { detail: AdminUserDetail }) {
  return (
    <div className="rounded-md border border-rule bg-paper p-4 text-sm">
      <p className="text-ink">
        {detail.library_paper_count.toLocaleString()} paper
        {detail.library_paper_count === 1 ? '' : 's'} in library.
      </p>
      {detail.last_orcid_sync_at ? (
        <p className="mt-1 text-xs text-ink-muted">
          Last ORCID sync {formatRelativeTime(detail.last_orcid_sync_at)}
        </p>
      ) : (
        <p className="mt-1 text-xs text-ink-faint">
          ORCID never synced for this user.
        </p>
      )}
    </div>
  );
}

function ActivityTab({ events }: { events: AdminActivityEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-ink-faint">No recorded activity.</p>;
  }
  return (
    <ul className="space-y-2 text-sm">
      {events.map((ev, i) => {
        const inner = (
          <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-rule bg-paper px-3 py-2">
            <div className="min-w-0 flex-1">
              <span className="font-medium text-ink">
                {ACTIVITY_LABELS[ev.kind] || ev.kind}
              </span>
              {ev.detail ? (
                <span className="ml-2 text-ink-muted">{ev.detail}</span>
              ) : null}
            </div>
            <span className="text-xs text-ink-faint">
              {formatRelativeTime(ev.at)}
            </span>
          </div>
        );
        if (ev.link) {
          return (
            <li key={`${ev.kind}-${i}`}>
              <a
                href={ev.link}
                target="_blank"
                rel="noreferrer noopener"
                className="block hover:opacity-90"
              >
                {inner}
              </a>
            </li>
          );
        }
        return <li key={`${ev.kind}-${i}`}>{inner}</li>;
      })}
    </ul>
  );
}

function AuditTab({ entries }: { entries: AdminAuditEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-ink-faint">No admin actions yet.</p>;
  }
  return (
    <ul className="space-y-2 text-sm">
      {entries.map((a) => (
        <li
          key={a.id}
          className="rounded-md border border-rule bg-paper px-3 py-2"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium text-ink">
              {AUDIT_LABELS[a.action] || a.action}
            </span>
            <span className="text-xs text-ink-faint">
              {formatRelativeTime(a.created_at)}
            </span>
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            by {a.admin_email ?? a.admin_user_id}
          </p>
          {a.details ? (
            <pre className="mt-2 max-h-32 overflow-auto rounded-sm bg-paper-soft p-2 text-xs text-ink-muted">
              {JSON.stringify(a.details, null, 2)}
            </pre>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
