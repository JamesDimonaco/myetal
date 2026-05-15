import { SignOutButton } from '@/components/sign-out-button';

export function ProfileActions() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <SignOutButton
        className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-rule bg-paper px-4 py-2 text-sm font-medium text-ink transition hover:bg-paper-soft disabled:opacity-60"
      />
    </div>
  );
}
