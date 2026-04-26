import { ShareEditor } from '@/components/share-editor';

export const metadata = { title: 'New share' };
export const dynamic = 'force-dynamic';

export default function NewSharePage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-widest text-ink-muted">
          New
        </p>
        <h1 className="mt-1 font-serif text-3xl tracking-tight text-ink sm:text-4xl">
          Create a share
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          One QR code, one collection. Add as many papers as you like.
        </p>
      </header>
      <ShareEditor />
    </div>
  );
}
