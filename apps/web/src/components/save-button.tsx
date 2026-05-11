'use client';

import { useSavedShares } from '@/hooks/useSavedShares';

interface SaveButtonProps {
  shortCode: string;
  name: string;
  description: string | null;
  type: string;
  ownerName: string | null;
  itemCount: number;
}

export function SaveButton({ shortCode, name, description, type, ownerName, itemCount }: SaveButtonProps) {
  const { isSaved, save, unsave } = useSavedShares();
  const saved = isSaved(shortCode);

  const handleClick = () => {
    if (saved) {
      unsave(shortCode);
    } else {
      save({
        short_code: shortCode,
        name,
        description,
        type,
        owner_name: ownerName,
        item_count: itemCount,
      });
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`inline-flex min-h-[40px] items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition ${
        saved
          ? 'border-accent/30 bg-accent/10 text-accent'
          : 'border-ink/20 text-ink-muted hover:border-ink/40 hover:text-ink'
      }`}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={saved ? 0 : 1.5} className="h-4 w-4">
        <path d="M5 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v14l-5-3.5L5 18V4Z" />
      </svg>
      {saved ? 'Saved' : 'Save'}
    </button>
  );
}
