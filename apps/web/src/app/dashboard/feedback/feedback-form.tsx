'use client';

import Link from 'next/link';
import { useState } from 'react';

import { clientApi } from '@/lib/client-api';

type FeedbackType = 'feature_request' | 'bug_report';

interface FeedbackResponse {
  id: string;
  message: string;
}

interface Props {
  userEmail: string | null;
}

export function FeedbackForm({ userEmail }: Props) {
  const [selectedType, setSelectedType] = useState<FeedbackType | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState(userEmail ?? '');
  const [useCustomEmail, setUseCustomEmail] = useState(false);
  const [shareEmail, setShareEmail] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const isSignedIn = userEmail !== null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedType) return;

    setSubmitting(true);
    setError(null);

    try {
      const resolvedEmail = !shareEmail
        ? null
        : isSignedIn && !useCustomEmail
          ? userEmail
          : email || null;

      await clientApi<FeedbackResponse>('/feedback', {
        method: 'POST',
        json: {
          type: selectedType,
          title: title.trim(),
          description: description.trim(),
          email: resolvedEmail?.trim() || null,
        },
      });

      setSubmittedEmail(resolvedEmail?.trim() || null);
      setSuccess(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setSelectedType(null);
    setTitle('');
    setDescription('');
    setEmail(userEmail ?? '');
    setUseCustomEmail(false);
    setShareEmail(true);
    setError(null);
    setSuccess(false);
    setSubmittedEmail(null);
  };

  // -- Success state --
  if (success) {
    return (
      <div className="flex flex-col items-center py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft">
          <svg
            className="h-8 w-8 text-accent"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.5 12.75l6 6 9-13.5"
            />
          </svg>
        </div>

        <h2 className="mt-6 font-serif text-2xl text-ink">
          Thanks for your feedback!
        </h2>

        {submittedEmail ? (
          <p className="mt-3 text-base text-ink-muted">
            We&apos;ll get back to you at{' '}
            <span className="font-medium text-ink">{submittedEmail}</span>
          </p>
        ) : (
          <p className="mt-3 text-base text-ink-muted">
            We read every submission.
          </p>
        )}

        <div className="mt-8 flex items-center gap-4">
          <button
            onClick={handleReset}
            className="rounded-md border border-rule px-4 py-2 text-sm font-medium text-ink hover:bg-paper-soft"
          >
            Submit another
          </button>
          <Link
            href="/"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Back to app
          </Link>
        </div>
      </div>
    );
  }

  // -- Type selection cards --
  if (!selectedType) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <button
          onClick={() => setSelectedType('feature_request')}
          className="group rounded-lg border border-rule bg-white p-6 text-left transition-all hover:border-accent hover:shadow-sm"
        >
          <div className="text-3xl">&#x1f4a1;</div>
          <h3 className="mt-3 text-lg font-semibold text-ink">
            Request a feature
          </h3>
          <p className="mt-1 text-sm text-ink-muted">
            Tell us what would make MyEtAl better for your research
          </p>
        </button>

        <button
          onClick={() => setSelectedType('bug_report')}
          className="group rounded-lg border border-rule bg-white p-6 text-left transition-all hover:border-accent hover:shadow-sm"
        >
          <div className="text-3xl">&#x1f41b;</div>
          <h3 className="mt-3 text-lg font-semibold text-ink">
            Report an issue
          </h3>
          <p className="mt-1 text-sm text-ink-muted">
            Something broken or not working as expected?
          </p>
        </button>
      </div>
    );
  }

  // -- Form --
  const typeLabel =
    selectedType === 'feature_request' ? 'Feature request' : 'Bug report';
  const typeIcon =
    selectedType === 'feature_request' ? '\u{1f4a1}' : '\u{1f41b}';
  const titlePlaceholder =
    selectedType === 'feature_request'
      ? 'What would you like?'
      : 'What went wrong?';
  const descPlaceholder =
    selectedType === 'feature_request'
      ? 'Describe the feature and how it would help your workflow...'
      : 'Steps to reproduce, what you expected, and what happened instead...';

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Type badge + change button */}
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-sm font-medium text-accent">
          {typeIcon} {typeLabel}
        </span>
        <button
          type="button"
          onClick={() => setSelectedType(null)}
          className="text-sm text-ink-muted underline underline-offset-2 hover:text-ink"
        >
          Change
        </button>
      </div>

      {/* Title */}
      <div>
        <label
          htmlFor="feedback-title"
          className="block text-sm font-medium text-ink"
        >
          Title
        </label>
        <input
          id="feedback-title"
          type="text"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={titlePlaceholder}
          className="mt-1.5 w-full rounded-md border border-rule bg-white px-3 py-2 text-base text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <p className="mt-1 text-right text-xs text-ink-faint">
          {title.length}/200
        </p>
      </div>

      {/* Description */}
      <div>
        <label
          htmlFor="feedback-desc"
          className="block text-sm font-medium text-ink"
        >
          Description
        </label>
        <textarea
          id="feedback-desc"
          required
          maxLength={2000}
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={descPlaceholder}
          className="mt-1.5 w-full resize-y rounded-md border border-rule bg-white px-3 py-2 text-base text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <p className="mt-1 text-right text-xs text-ink-faint">
          {description.length}/2000
        </p>
      </div>

      {/* Email */}
      <div>
        {isSignedIn ? (
          <div className="space-y-3">
            {/* Opt-in / opt-out toggle */}
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={shareEmail}
                onChange={(e) => setShareEmail(e.target.checked)}
                className="h-4 w-4 rounded border-rule text-accent accent-accent focus:ring-accent"
              />
              <span className="text-sm text-ink">
                Share my email for follow-up
              </span>
            </label>

            {shareEmail ? (
              !useCustomEmail ? (
                <div className="flex items-center gap-2 rounded-md bg-accent-soft px-3 py-2.5">
                  <svg
                    className="h-4 w-4 text-accent"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4.5 12.75l6 6 9-13.5"
                    />
                  </svg>
                  <span className="text-sm text-ink">
                    We&apos;ll reply to{' '}
                    <span className="font-medium">{userEmail}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setUseCustomEmail(true)}
                    className="ml-auto text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
                  >
                    Use a different email
                  </button>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="feedback-email"
                      className="block text-sm font-medium text-ink"
                    >
                      Email for follow-up
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setUseCustomEmail(false);
                        setEmail(userEmail ?? '');
                      }}
                      className="text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
                    >
                      Use {userEmail}
                    </button>
                  </div>
                  <input
                    id="feedback-email"
                    type="email"
                    maxLength={320}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="mt-1.5 w-full rounded-md border border-rule bg-white px-3 py-2 text-base text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              )
            ) : (
              <p className="text-xs text-ink-faint">
                Your feedback will be anonymous — we won&apos;t be able to
                follow up.
              </p>
            )}
          </div>
        ) : (
          <div>
            <label
              htmlFor="feedback-email"
              className="block text-sm font-medium text-ink"
            >
              Want a reply? Leave your email{' '}
              <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <input
              id="feedback-email"
              type="email"
              maxLength={320}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="mt-1.5 w-full rounded-md border border-rule bg-white px-3 py-2 text-base text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <p className="mt-1.5 text-xs text-ink-faint">
              Without an email, we can&apos;t follow up — but we still read
              every submission.
            </p>
            {email ? (
              <p className="mt-1 flex items-center gap-1 text-xs text-accent">
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4.5 12.75l6 6 9-13.5"
                  />
                </svg>
                You&apos;ll hear back from us.
              </p>
            ) : (
              <p className="mt-1 text-xs text-ink-faint">
                Anonymous — no reply possible.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={submitting || !title.trim() || !description.trim()}
        className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Sending...' : 'Submit feedback'}
      </button>
    </form>
  );
}
