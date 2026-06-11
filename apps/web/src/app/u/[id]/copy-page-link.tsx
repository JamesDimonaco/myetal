'use client';

import { toast } from 'sonner';

/** Copy-to-clipboard affordance for the researcher page's permanent URL. */
export function CopyPageLink({ url }: { url: string }) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      toast.error("Couldn't copy — copy from the address bar");
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-rule bg-paper px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-paper-soft"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <rect
          x="3.5"
          y="3.5"
          width="7"
          height="7"
          rx="1"
          stroke="currentColor"
          strokeWidth="1.25"
        />
        <path
          d="M2 7V2.5A.5.5 0 0 1 2.5 2H7"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </svg>
      Copy link
    </button>
  );
}
