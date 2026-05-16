'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { AdminDailyBucket } from '@/types/admin';

/**
 * 90-day daily-view timeline for the admin share-detail page.
 *
 * Reuses the same SR-only summary pattern as the Stage 1 GrowthCharts:
 * wrap recharts in a `<figure>` + `<figcaption>` with a one-sentence
 * total/peak summary so a SR user gets the headline even on platforms
 * that ignore `aria-label` on SVG.
 */
export function ViewTimeline({
  data,
  label,
}: {
  data: AdminDailyBucket[];
  label: string;
}) {
  const formatted = data.map((d) => {
    const [, m, day] = d.date.split('-');
    return { ...d, label: `${m}/${day}` };
  });

  const total = data.reduce((sum, d) => sum + d.count, 0);
  const peak = data.reduce(
    (acc, d) => (d.count > acc.count ? d : acc),
    { date: '', count: 0 },
  );
  const summary = peak.count
    ? `${label}: ${total} total, peak ${peak.count} on ${peak.date}.`
    : `${label}: no views in window.`;

  return (
    <figure className="h-full w-full" role="group" aria-label={label}>
      <figcaption className="sr-only">{summary}</figcaption>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={formatted}
          margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
          accessibilityLayer
          role="img"
          aria-label={summary}
        >
          <CartesianGrid
            stroke="var(--color-rule)"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: 'var(--color-rule)' }}
            tick={{ fill: 'var(--color-ink-muted)', fontSize: 10 }}
            interval="preserveStartEnd"
            minTickGap={20}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-rule)' }}
            tick={{ fill: 'var(--color-ink-muted)', fontSize: 10 }}
            width={28}
          />
          <Tooltip
            cursor={{ fill: 'var(--color-paper-soft)' }}
            contentStyle={{
              background: 'var(--color-paper)',
              border: '1px solid var(--color-rule)',
              borderRadius: 4,
              fontSize: 12,
              padding: '6px 10px',
            }}
            labelFormatter={(_label, payload) => {
              const entry = payload?.[0]?.payload as
                | (AdminDailyBucket & { label: string })
                | undefined;
              return entry?.date ?? '';
            }}
          />
          <Bar dataKey="count" fill="var(--color-accent)" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}
