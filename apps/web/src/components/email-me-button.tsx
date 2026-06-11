'use client';

import { useState } from 'react';

import { ApiError } from '@/lib/api';
import { clientApi } from '@/lib/client-api';

/**
 * "Email me this collection" — the poster-session memory aid. Visitors scan
 * a QR, get pulled away, and forget; this sends them the link in one tap
 * with no account. POSTs to the anon `/public/c/{code}/email` endpoint via
 * the same-origin proxy (ReportButton precedent). The address is sent,
 * mailed to, and dropped — never stored.
 */
export function EmailMeButton({ shortCode }: { shortCode: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await clientApi<void>(
        `/public/c/${encodeURIComponent(shortCode)}/email`,
        { method: 'POST', json: { email: email.trim() } },
      );
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Too many requests right now — try again in a little while.');
      } else if (err instanceof ApiError && err.status === 422) {
        setError("That doesn't look like an email address.");
      } else {
        setError("Couldn't send just now. Try again in a moment.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <p className="text-sm text-ink-muted" role="status">
        Sent — check your inbox.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-rule bg-paper px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-paper-soft"
      >
        <MailIcon />
        Email me this collection
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-md flex-col gap-2 sm:flex-row"
    >
      <label htmlFor="email-me-address" className="sr-only">
        Your email address
      </label>
      <input
        id="email-me-address"
        type="email"
        required
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@university.edu"
        className="min-h-[44px] flex-1 rounded-md border border-rule bg-paper px-3 py-2.5 text-base text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
      />
      <button
        type="submit"
        disabled={submitting || !email.trim()}
        className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-60"
      >
        {submitting ? 'Sending…' : 'Send link'}
      </button>
      {error ? (
        <p className="text-xs text-danger sm:w-full" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden>
      <rect
        x="2"
        y="3.5"
        width="14"
        height="11"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M2.5 4.5l6.5 5 6.5-5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
