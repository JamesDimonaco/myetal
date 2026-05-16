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
 * Daily-bucket bar chart for the admin overview.
 *
 * Recharts is a chunky import; isolating it in a client component
 * keeps the server-rendered overview shell HTML lean. Style with
 * MyEtAl's design tokens via CSS custom properties — recharts reads
 * raw colour strings, not class names, so we accept a `fill` prop and
 * leave token resolution to the caller.
 */
export function GrowthCharts({
  data,
  fill,
  label,
}: {
  data: AdminDailyBucket[];
  fill: string;
  /** Short SR-only summary of what the chart shows. The caller already
   *  renders a visible heading; this is read INSTEAD of silence for
   *  screen-reader users since recharts emits unlabelled SVG. */
  label: string;
}) {
  // Show only month-day on the x-axis to keep ticks readable in the small
  // chart frame. The full date is in the tooltip.
  const formatted = data.map((d) => {
    const [, m, day] = d.date.split('-');
    return { ...d, label: `${m}/${day}` };
  });

  // Compose a one-sentence summary for the SR fallback: total, peak, and
  // when the peak landed. recharts ≥2.12 honours `accessibilityLayer` +
  // `role` / `aria-label` props directly on chart components, which we
  // pass below. The figcaption is the belt to the accessibilityLayer
  // braces — guarantees SR users get the data even on older Safari /
  // screen-reader combos that don't read `aria-label` on SVG.
  const total = data.reduce((sum, d) => sum + d.count, 0);
  const peak = data.reduce(
    (acc, d) => (d.count > acc.count ? d : acc),
    { date: '', count: 0 },
  );
  const summary = peak.count
    ? `${label}: ${total} total, peak ${peak.count} on ${peak.date}.`
    : `${label}: no activity in window.`;

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
        <CartesianGrid stroke="var(--color-rule)" strokeDasharray="3 3" vertical={false} />
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
          <Bar dataKey="count" fill={fill} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}
