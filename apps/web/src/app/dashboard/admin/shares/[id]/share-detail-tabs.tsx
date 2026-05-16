'use client';

import Link from 'next/link';
import { useState } from 'react';

import { formatRelativeTime } from '@/lib/format';
import type {
  AdminAuditEntry,
  AdminShareDetail,
  AdminShareItemOut,
  AdminShareReport,
  AdminSimilarShareSnapshot,
} from '@/types/admin';

type Tab = 'items' | 'tags' | 'reports' | 'similar' | 'audit';

const AUDIT_LABELS: Record<string, string> = {
  tombstone_share: 'Tombstoned',
  restore_share: 'Restored',
  unpublish_share: 'Unpublished',
  rebuild_similar_for_share: 'Recomputed precompute',
  action_report: 'Actioned report',
};

export function ShareDetailTabs({ detail }: { detail: AdminShareDetail }) {
  const [tab, setTab] = useState<Tab>('items');

  return (
    <div>
      <div className="flex flex-wrap gap-1 border-b border-rule">
        <TabButton
          active={tab === 'items'}
          onClick={() => setTab('items')}
          label={`Items (${detail.items.length})`}
        />
        <TabButton
          active={tab === 'tags'}
          onClick={() => setTab('tags')}
          label={`Tags (${detail.tags.length})`}
        />
        <TabButton
          active={tab === 'reports'}
          onClick={() => setTab('reports')}
          label={`Reports (${detail.reports.length})`}
        />
        <TabButton
          active={tab === 'similar'}
          onClick={() => setTab('similar')}
          label={`Similar (${detail.similar_snapshot.length})`}
        />
        <TabButton
          active={tab === 'audit'}
          onClick={() => setTab('audit')}
          label={`Audit (${detail.audit.length})`}
        />
      </div>

      <div className="mt-6">
        {tab === 'items' ? <ItemsTab items={detail.items} /> : null}
        {tab === 'tags' ? <TagsTab tags={detail.tags} /> : null}
        {tab === 'reports' ? (
          <ReportsTab reports={detail.reports} />
        ) : null}
        {tab === 'similar' ? (
          <SimilarTab snapshot={detail.similar_snapshot} />
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
      aria-pressed={active}
      className={`relative px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
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

function ItemsTab({ items }: { items: AdminShareItemOut[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-ink-faint">No items in this share.</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li
          key={item.id}
          className="rounded-md border border-rule bg-paper p-3"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium text-ink">{item.title}</p>
            <span className="rounded-sm bg-paper-soft px-2 py-0.5 text-xs font-medium text-ink-muted">
              {item.kind}
            </span>
          </div>
          {item.subtitle ? (
            <p className="mt-1 text-sm text-ink-muted">{item.subtitle}</p>
          ) : null}
          {item.doi ? (
            <p className="mt-1 text-xs">
              <span className="text-ink-faint">DOI: </span>
              <a
                href={`https://doi.org/${item.doi}`}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent hover:underline"
              >
                {item.doi}
              </a>
            </p>
          ) : null}
          {item.url ? (
            <p className="mt-1 text-xs">
              <span className="text-ink-faint">URL: </span>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer noopener"
                className="break-all text-accent hover:underline"
              >
                {item.url}
              </a>
            </p>
          ) : null}
          {item.file_url ? (
            <div className="mt-2 rounded-sm bg-paper-soft p-2">
              <p className="text-xs font-medium text-ink">
                PDF (admin-only link)
              </p>
              <a
                href={item.file_url}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1 block break-all text-xs text-accent hover:underline"
              >
                {item.file_url}
              </a>
              <p className="mt-1 text-xs text-ink-faint">
                {item.file_mime ?? 'unknown mime'}
                {item.file_size_bytes
                  ? ` · ${formatBytes(item.file_size_bytes)}`
                  : ''}
                {item.copyright_ack_at
                  ? ` · uploader ACK'd ${formatRelativeTime(item.copyright_ack_at)}`
                  : ''}
              </p>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function TagsTab({ tags }: { tags: { slug: string; label: string }[] }) {
  if (tags.length === 0) {
    return <p className="text-sm text-ink-faint">No tags.</p>;
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {tags.map((t) => (
        <li key={t.slug}>
          <Link
            href={`/browse?tag=${encodeURIComponent(t.slug)}`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-block rounded-full bg-paper-soft px-3 py-1 text-xs font-medium text-ink hover:bg-paper"
          >
            #{t.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ReportsTab({ reports }: { reports: AdminShareReport[] }) {
  if (reports.length === 0) {
    return <p className="text-sm text-ink-faint">No reports.</p>;
  }
  return (
    <ul className="space-y-2 text-sm">
      {reports.map((r) => (
        <li
          key={r.id}
          className="rounded-md border border-rule bg-paper p-3"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium text-ink">{r.reason}</span>
            <span
              className={`rounded-sm px-2 py-0.5 text-xs font-medium ${
                r.status === 'open'
                  ? 'bg-danger/10 text-danger'
                  : r.status === 'actioned'
                    ? 'bg-accent-soft text-accent'
                    : 'bg-paper-soft text-ink-muted'
              }`}
            >
              {r.status}
            </span>
          </div>
          {r.details ? (
            <p className="mt-1 text-xs text-ink-muted">{r.details}</p>
          ) : null}
          <p className="mt-1 text-xs text-ink-faint">
            Submitted {formatRelativeTime(r.created_at)}
            {r.actioned_at
              ? ` · actioned ${formatRelativeTime(r.actioned_at)}`
              : ''}
          </p>
        </li>
      ))}
    </ul>
  );
}

function SimilarTab({
  snapshot,
}: {
  snapshot: AdminSimilarShareSnapshot[];
}) {
  if (snapshot.length === 0) {
    return (
      <p className="text-sm text-ink-faint">
        No similar-share rows. Click &quot;Rebuild similar/trending&quot; in
        the action panel if you expect this share to have neighbours.
      </p>
    );
  }
  return (
    <ul className="space-y-2 text-sm">
      {snapshot.map((sim) => (
        <li
          key={sim.similar_share_id}
          className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-rule bg-paper p-3"
        >
          <Link
            href={`/c/${sim.short_code}`}
            target="_blank"
            rel="noreferrer noopener"
            className="min-w-0 flex-1 truncate text-ink hover:underline"
          >
            <span className="font-medium">{sim.name}</span>
            <span className="ml-2 text-xs text-ink-faint">
              /c/{sim.short_code}
            </span>
          </Link>
          <span className="text-xs text-ink-muted">
            {sim.papers_in_common} paper
            {sim.papers_in_common === 1 ? '' : 's'} in common · refreshed{' '}
            {formatRelativeTime(sim.refreshed_at)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function AuditTab({ entries }: { entries: AdminAuditEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-ink-faint">
        No admin actions recorded against this share yet.
      </p>
    );
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
            <pre
              tabIndex={0}
              role="region"
              aria-label="Audit details payload"
              className="mt-2 max-h-32 overflow-auto rounded-sm bg-paper-soft p-2 text-xs text-ink-muted"
            >
              {JSON.stringify(a.details, null, 2)}
            </pre>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(
    units.length - 1,
    Math.floor(Math.log(n) / Math.log(1024)),
  );
  const value = n / 1024 ** exp;
  const formatted =
    value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${formatted} ${units[exp]}`;
}
